/**
 * Config-Driven Ops Engine
 *
 * Reads a BountyConfig + JSON data files and produces an Op[] array
 * ready to publish. Handles:
 *   - Custom schema creation (types + properties)
 *   - Enum entity creation
 *   - Entity creation with typed values (proper dataType -> value type mapping)
 *   - Relation linking (by name reference across sources)
 *   - Text blocks with position ordering and view support
 *   - Query data blocks and collection data blocks with views
 *   - Avatar and cover image uploads
 *   - Runtime duplicate checking via API
 */

import * as fs from "fs";
import path from "node:path";
import { Graph, Position, type Op } from "@geoprotocol/geo-sdk";
import type { BountyConfig, EntitySourceConfig } from "./config";
import {
  ROOT_TYPES, ROOT_PROPERTIES, VALUE_TYPE_MAP, ROOT_PROPERTY_TYPES,
  QUERY_DATA_SOURCE, COLLECTION_DATA_SOURCE, VIEWS,
} from "./constants";
import { queryEntityByName } from "./client";

// ─── Build Result ────────────────────────────────────────────────────────────

export interface BuildResult {
  ops: Op[];
  entityIdsBySource: Record<string, Map<string, string>>;
  stats: {
    properties: number;
    types: number;
    enums: number;
    entities: number;
    relations: number;
    blocks: number;
    dataBlocks: number;
    images: number;
  };
}

// ─── Main Engine ─────────────────────────────────────────────────────────────

export async function buildOps(
  config: BountyConfig,
  dataDir: string
): Promise<BuildResult> {
  const ops: Op[] = [];
  const stats = {
    properties: 0, types: 0, enums: 0, entities: 0,
    relations: 0, blocks: 0, dataBlocks: 0, images: 0,
  };

  // Resolved property IDs: key -> ID
  const propertyIds = new Map<string, string>();
  // Resolved property dataTypes: key -> GeoDataType string (e.g. "TEXT", "BOOLEAN")
  const propertyDataTypes = new Map<string, string>();
  // Resolved type IDs: key -> ID
  const typeIds = new Map<string, string>();
  // Resolved enum IDs: name -> ID
  const enumIds = new Map<string, string>();
  // Entity IDs per source: sourceName -> Map<entityName, entityId>
  const entityIdsBySource: Record<string, Map<string, string>> = {};
  // Track last block position per parent entity
  const lastPosByEntity: Record<string, string> = {};

  // ── Step 1: Register root space properties + types ───────────────────────
  for (const [key, id] of Object.entries(ROOT_PROPERTIES)) {
    propertyIds.set(key, id);
  }
  for (const [key, dataType] of Object.entries(ROOT_PROPERTY_TYPES)) {
    propertyDataTypes.set(key, dataType);
  }
  for (const [key, id] of Object.entries(ROOT_TYPES)) {
    typeIds.set(key, id);
  }

  // ── Step 2: Create custom properties ─────────────────────────────────────
  if (config.properties) {
    console.log("\n  Creating custom properties...");
    for (const [key, prop] of Object.entries(config.properties)) {
      const createArgs: any = { name: prop.name, dataType: prop.dataType };
      if (prop.id) createArgs.id = prop.id;

      const { id, ops: propOps } = Graph.createProperty(createArgs);
      ops.push(...propOps);
      propertyIds.set(key, prop.id || id);
      propertyDataTypes.set(key, prop.dataType);
      stats.properties++;
      console.log(`    + Property: "${prop.name}" (${prop.dataType}) -> ${prop.id || id}`);
    }
  }

  // ── Step 3: Create custom types ──────────────────────────────────────────
  if (config.types) {
    console.log("\n  Creating custom types...");
    for (const [key, type] of Object.entries(config.types)) {
      const propIds = type.properties
        .map((pKey) => propertyIds.get(pKey))
        .filter(Boolean) as string[];

      const createArgs: any = { name: type.name, properties: propIds };
      if (type.id) createArgs.id = type.id;

      const { id, ops: typeOps } = Graph.createType(createArgs);
      ops.push(...typeOps);
      typeIds.set(key, type.id || id);
      stats.types++;
      console.log(`    + Type: "${type.name}" -> ${type.id || id}`);
    }
  }

  // ── Step 4: Create enum entities ─────────────────────────────────────────
  if (config.enums && config.enums.length > 0) {
    console.log("\n  Creating enum entities...");
    for (const enumDef of config.enums) {
      const enumTypeId = typeIds.get(enumDef.type);
      if (!enumTypeId) {
        console.warn(`    ! Skipping enum "${enumDef.name}" -- type "${enumDef.type}" not found`);
        continue;
      }

      const createArgs: any = { name: enumDef.name, types: [enumTypeId] };
      if (enumDef.id) createArgs.id = enumDef.id;

      const { id, ops: enumOps } = Graph.createEntity(createArgs);
      ops.push(...enumOps);
      enumIds.set(enumDef.name, enumDef.id || id);
      stats.enums++;
      console.log(`    + Enum: "${enumDef.name}" (${enumDef.type}) -> ${enumDef.id || id}`);
    }
  }

  // ── Step 5: Load existing entities ───────────────────────────────────────
  if (config.existingEntities) {
    for (const [sourceName, entities] of Object.entries(config.existingEntities)) {
      if (!entityIdsBySource[sourceName]) {
        entityIdsBySource[sourceName] = new Map();
      }
      for (const [name, id] of Object.entries(entities)) {
        entityIdsBySource[sourceName].set(name, id);
      }
    }
  }

  // ── Step 6: Process entity sources (sorted by order) ─────────────────────
  const sortedSources = Object.entries(config.sources).sort(
    ([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0)
  );

  for (const [sourceName, source] of sortedSources) {
    const filePath = path.join(dataDir, source.file);
    if (!fs.existsSync(filePath)) {
      console.warn(`\n  ! Skipping source "${sourceName}" -- file not found: ${filePath}`);
      continue;
    }

    const data: any[] = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!entityIdsBySource[sourceName]) {
      entityIdsBySource[sourceName] = new Map();
    }
    const idMap = entityIdsBySource[sourceName];

    // Type is optional (entities without types are allowed)
    const entityTypeId = source.type ? typeIds.get(source.type) : undefined;
    if (source.type && !entityTypeId) {
      console.warn(`\n  ! Skipping source "${sourceName}" -- type "${source.type}" not found`);
      continue;
    }

    console.log(`\n  Processing "${sourceName}" (${data.length} items from ${source.file})...`);

    for (const item of data) {
      if (!item.name) {
        console.warn(`    ! Skipping item without name`);
        continue;
      }

      // Skip if already in our map (from existingEntities)
      if (idMap.has(item.name)) {
        continue;
      }

      // Runtime duplicate checking via API
      if (source.checkDuplicates) {
        const existingId = await queryEntityByName(item.name);
        if (existingId) {
          console.log(`    ~ "${item.name}" already exists (${existingId}), reusing`);
          idMap.set(item.name, existingId);
          continue;
        }
      }

      // Build typed values using dataType from config (NOT heuristics)
      const values = buildValues(item, source, propertyIds, propertyDataTypes);

      // Build relations from relationFields
      const relations = buildRelations(item, source, propertyIds, entityIdsBySource, enumIds);

      const createArgs: any = {
        name: item.name,
        description: item.description,
        values,
        relations,
      };
      if (entityTypeId) createArgs.types = [entityTypeId];

      const { id, ops: entityOps } = Graph.createEntity(createArgs);
      ops.push(...entityOps);
      idMap.set(item.name, id);
      stats.entities++;
      console.log(`    + ${item.name} -> ${id}`);
    }

    // ── Text Blocks ──────────────────────────────────────────────────────
    if (source.blocksField) {
      for (const item of data) {
        const blocks = item[source.blocksField];
        if (!blocks || !Array.isArray(blocks) || blocks.length === 0) continue;

        const parentId = idMap.get(item.name);
        if (!parentId) continue;

        console.log(`    Adding ${blocks.length} text blocks to "${item.name}"...`);
        for (const line of blocks) {
          const { id: blockId, ops: blockOps } = Graph.createEntity({
            types: [ROOT_TYPES.text_block],
            values: [{ property: ROOT_PROPERTIES.markdown_content, type: "text", value: line }],
          });
          ops.push(...blockOps);

          const pos = Position.generateBetween(lastPosByEntity[parentId] ?? null, null);
          lastPosByEntity[parentId] = pos;

          const relArgs: any = {
            fromEntity: parentId,
            toEntity: blockId,
            type: ROOT_PROPERTIES.blocks,
            position: pos,
          };

          // Set view on blocks relation if specified
          if (source.blocksView) {
            const viewId = VIEWS[source.blocksView];
            if (viewId) {
              relArgs.entityRelations = {
                [ROOT_PROPERTIES.view]: { toEntity: viewId },
              };
            }
          }

          const { ops: relOps } = Graph.createRelation(relArgs);
          ops.push(...relOps);
          stats.blocks++;
        }
      }
    }

    // ── Query Data Blocks ────────────────────────────────────────────────
    if (source.queryDataBlocks) {
      for (const qdb of source.queryDataBlocks) {
        const filterTypeId = typeIds.get(qdb.filterType);
        if (!filterTypeId) {
          console.warn(`    ! Skipping query data block "${qdb.name}" -- type "${qdb.filterType}" not found`);
          continue;
        }

        // Attach to all entities in this source
        for (const item of data) {
          const parentId = idMap.get(item.name);
          if (!parentId) continue;

          const queryFilter = JSON.stringify({
            spaceId: { in: [process.env["SPACE_ID"]] },
            filter: { [ROOT_PROPERTIES.types]: { is: filterTypeId } },
          });

          const { id: blockId, ops: blockOps } = Graph.createEntity({
            name: qdb.name,
            types: [ROOT_TYPES.data_block],
            values: [{ property: ROOT_PROPERTIES.filter, type: "text", value: queryFilter }],
            relations: {
              [ROOT_PROPERTIES.data_source_type]: { toEntity: QUERY_DATA_SOURCE },
            },
          });
          ops.push(...blockOps);

          const pos = Position.generateBetween(lastPosByEntity[parentId] ?? null, null);
          lastPosByEntity[parentId] = pos;

          const relArgs: any = {
            fromEntity: parentId,
            toEntity: blockId,
            type: ROOT_PROPERTIES.blocks,
            position: pos,
          };
          if (qdb.view) {
            const viewId = VIEWS[qdb.view];
            if (viewId) {
              relArgs.entityRelations = {
                [ROOT_PROPERTIES.view]: { toEntity: viewId },
              };
            }
          }

          const { ops: relOps } = Graph.createRelation(relArgs);
          ops.push(...relOps);
          stats.dataBlocks++;
          console.log(`    + Query data block "${qdb.name}" on "${item.name}" (${qdb.view || "default"} view)`);
        }
      }
    }

    // ── Collection Data Blocks ───────────────────────────────────────────
    if (source.collectionDataBlocks) {
      for (const cdb of source.collectionDataBlocks) {
        const itemIds: { toEntity: string }[] = [];
        const sourceMap = entityIdsBySource[cdb.items.source];
        if (sourceMap) {
          for (const name of cdb.items.names) {
            const eid = sourceMap.get(name);
            if (eid) itemIds.push({ toEntity: eid });
          }
        }

        if (itemIds.length === 0) {
          console.warn(`    ! Skipping collection data block "${cdb.name}" -- no items found`);
          continue;
        }

        // Attach to all entities in this source
        for (const item of data) {
          const parentId = idMap.get(item.name);
          if (!parentId) continue;

          const { id: blockId, ops: blockOps } = Graph.createEntity({
            name: cdb.name,
            types: [ROOT_TYPES.data_block],
            relations: {
              [ROOT_PROPERTIES.data_source_type]: { toEntity: COLLECTION_DATA_SOURCE },
              [ROOT_PROPERTIES.collection_item]: itemIds,
            },
          });
          ops.push(...blockOps);

          const pos = Position.generateBetween(lastPosByEntity[parentId] ?? null, null);
          lastPosByEntity[parentId] = pos;

          const relArgs: any = {
            fromEntity: parentId,
            toEntity: blockId,
            type: ROOT_PROPERTIES.blocks,
            position: pos,
          };
          if (cdb.view) {
            const viewId = VIEWS[cdb.view];
            if (viewId) {
              relArgs.entityRelations = {
                [ROOT_PROPERTIES.view]: { toEntity: viewId },
              };
            }
          }

          const { ops: relOps } = Graph.createRelation(relArgs);
          ops.push(...relOps);
          stats.dataBlocks++;
          console.log(`    + Collection data block "${cdb.name}" on "${item.name}" (${itemIds.length} items, ${cdb.view || "default"} view)`);
        }
      }
    }

    // ── Avatar Images ────────────────────────────────────────────────────
    if (source.avatarField) {
      for (const item of data) {
        const avatarUrl = item[source.avatarField];
        if (!avatarUrl) continue;

        const parentId = idMap.get(item.name);
        if (!parentId) continue;

        console.log(`    Uploading avatar for "${item.name}"...`);
        const { id: imageId, ops: imageOps, cid } = await Graph.createImage({
          url: avatarUrl,
          name: `${item.name} Avatar`,
          network: "TESTNET",
        });
        ops.push(...imageOps);

        const { ops: attachOps } = Graph.createRelation({
          fromEntity: parentId,
          toEntity: imageId,
          type: ROOT_PROPERTIES.avatar,
        });
        ops.push(...attachOps);
        stats.images++;
        console.log(`      Avatar: ${imageId} (CID: ${cid})`);
      }
    }

    // ── Cover Images ─────────────────────────────────────────────────────
    if (source.coverField) {
      for (const item of data) {
        const coverUrl = item[source.coverField];
        if (!coverUrl) continue;

        const parentId = idMap.get(item.name);
        if (!parentId) continue;

        console.log(`    Uploading cover for "${item.name}"...`);
        const { id: imageId, ops: imageOps, cid } = await Graph.createImage({
          url: coverUrl,
          name: `${item.name} Cover`,
          network: "TESTNET",
        });
        ops.push(...imageOps);

        const { ops: attachOps } = Graph.createRelation({
          fromEntity: parentId,
          toEntity: imageId,
          type: ROOT_PROPERTIES.cover,
        });
        ops.push(...attachOps);
        stats.images++;
        console.log(`      Cover: ${imageId} (CID: ${cid})`);
      }
    }
  }

  // Count total relations from ops
  stats.relations = ops.filter((op) => op.type === "createRelation").length;

  return { ops, entityIdsBySource, stats };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build typed value array from JSON item fields.
 * Uses the property's dataType from config to determine the correct SDK value type string.
 * NO heuristics -- explicit mapping only via VALUE_TYPE_MAP.
 */
function buildValues(
  item: Record<string, any>,
  source: EntitySourceConfig,
  propertyIds: Map<string, string>,
  propertyDataTypes: Map<string, string>
): any[] {
  const values: any[] = [];
  if (!source.valueFields) return values;

  for (const [jsonField, propKey] of Object.entries(source.valueFields)) {
    const val = item[jsonField];
    if (val == null) continue;

    const propId = propertyIds.get(propKey);
    if (!propId) {
      console.warn(`      ! Property key "${propKey}" not found for field "${jsonField}"`);
      continue;
    }

    // Get the dataType from config, then map to SDK value type string
    const dataType = propertyDataTypes.get(propKey);
    if (!dataType) {
      console.warn(`      ! No dataType for property "${propKey}" -- defaulting to "text"`);
      values.push({ property: propId, type: "text", value: val });
      continue;
    }

    const valueType = VALUE_TYPE_MAP[dataType];
    if (!valueType) {
      if (dataType === "RELATION") {
        console.warn(`      ! Property "${propKey}" is RELATION -- use relationFields instead of valueFields`);
        continue;
      }
      console.warn(`      ! Unknown dataType "${dataType}" for property "${propKey}" -- defaulting to "text"`);
      values.push({ property: propId, type: "text", value: val });
      continue;
    }

    if (valueType === "int64" || valueType === "float64") {
      const num = Number(val);
      if (isNaN(num) || val === "") continue; // skip invalid numbers
      values.push({ property: propId, type: valueType, value: Math.floor(num) });
    } else {
      values.push({ property: propId, type: valueType, value: val });
    }
  }
  return values;
}

function buildRelations(
  item: Record<string, any>,
  source: EntitySourceConfig,
  propertyIds: Map<string, string>,
  entityIdsBySource: Record<string, Map<string, string>>,
  enumIds: Map<string, string>
): Record<string, any> {
  const relations: Record<string, any> = {};
  if (!source.relationFields) return relations;

  for (const [jsonField, relConfig] of Object.entries(source.relationFields)) {
    const val = item[jsonField];
    if (val == null) continue;

    const propId = propertyIds.get(relConfig.property);
    if (!propId) continue;

    const sourceMap = entityIdsBySource[relConfig.source];

    const names = Array.isArray(val) ? val : [val];
    const targets: { toEntity: string }[] = [];

    for (const name of names) {
      const entityId = sourceMap?.get(name) ?? enumIds.get(name);
      if (entityId) {
        targets.push({ toEntity: entityId });
      }
    }

    if (targets.length === 1) {
      relations[propId] = targets[0];
    } else if (targets.length > 1) {
      relations[propId] = targets;
    }
  }
  return relations;
}
