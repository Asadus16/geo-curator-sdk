/**
 * Config-Driven Ops Engine
 *
 * Reads a BountyConfig + JSON data files and produces an Op[] array
 * ready to publish. Handles:
 *   - Custom schema creation (types + properties)
 *   - Enum entity creation
 *   - Entity creation with typed values
 *   - Relation linking (by name reference across sources)
 *   - Text blocks with position ordering
 *   - Avatar image uploads
 */

import * as fs from "fs";
import path from "node:path";
import { Graph, Position, type Op, ContentIds } from "@geoprotocol/geo-sdk";
import type { BountyConfig, EntitySourceConfig } from "./config";
import { ROOT_TYPES, ROOT_PROPERTIES, VALUE_TYPE_MAP } from "./constants";

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
    images: number;
  };
}

// ─── Main Engine ─────────────────────────────────────────────────────────────

export async function buildOps(
  config: BountyConfig,
  dataDir: string
): Promise<BuildResult> {
  const ops: Op[] = [];
  const stats = { properties: 0, types: 0, enums: 0, entities: 0, relations: 0, blocks: 0, images: 0 };

  // Resolved property IDs: key → ID (merging root properties + custom)
  const propertyIds = new Map<string, string>();
  // Resolved type IDs: key → ID
  const typeIds = new Map<string, string>();
  // Resolved enum IDs: name → ID
  const enumIds = new Map<string, string>();
  // Entity IDs per source: sourceName → Map<entityName, entityId>
  const entityIdsBySource: Record<string, Map<string, string>> = {};

  // ── Step 1: Register root space properties by key ────────────────────────
  // These are always available for use in configs without declaring them
  for (const [key, id] of Object.entries(ROOT_PROPERTIES)) {
    propertyIds.set(key, id);
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
      stats.properties++;
      console.log(`    + Property: "${prop.name}" (${prop.dataType}) → ${prop.id || id}`);
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
      console.log(`    + Type: "${type.name}" → ${type.id || id}`);
    }
  }

  // ── Step 4: Create enum entities ─────────────────────────────────────────
  if (config.enums && config.enums.length > 0) {
    console.log("\n  Creating enum entities...");
    for (const enumDef of config.enums) {
      const enumTypeId = typeIds.get(enumDef.type);
      if (!enumTypeId) {
        console.warn(`    ! Skipping enum "${enumDef.name}" — type "${enumDef.type}" not found`);
        continue;
      }

      const createArgs: any = { name: enumDef.name, types: [enumTypeId] };
      if (enumDef.id) createArgs.id = enumDef.id;

      const { id, ops: enumOps } = Graph.createEntity(createArgs);
      ops.push(...enumOps);
      enumIds.set(enumDef.name, enumDef.id || id);
      stats.enums++;
      console.log(`    + Enum: "${enumDef.name}" (${enumDef.type}) → ${enumDef.id || id}`);
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
      console.warn(`\n  ! Skipping source "${sourceName}" — file not found: ${filePath}`);
      continue;
    }

    const data: any[] = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!entityIdsBySource[sourceName]) {
      entityIdsBySource[sourceName] = new Map();
    }
    const idMap = entityIdsBySource[sourceName];

    const entityTypeId = typeIds.get(source.type);
    if (!entityTypeId) {
      console.warn(`\n  ! Skipping source "${sourceName}" — type "${source.type}" not found`);
      continue;
    }

    console.log(`\n  Processing "${sourceName}" (${data.length} items from ${source.file})...`);

    for (const item of data) {
      if (!item.name) {
        console.warn(`    ! Skipping item without name`);
        continue;
      }

      // Skip if already exists (from existingEntities)
      if (idMap.has(item.name)) {
        continue;
      }

      // Build typed values from valueFields mapping
      const values = buildValues(item, source, propertyIds);

      // Build relations from relationFields mapping
      const relations = buildRelations(item, source, propertyIds, entityIdsBySource, enumIds);

      const { id, ops: entityOps } = Graph.createEntity({
        name: item.name,
        description: item.description,
        types: [entityTypeId],
        values,
        relations,
      });
      ops.push(...entityOps);
      idMap.set(item.name, id);
      stats.entities++;
      console.log(`    + ${item.name} → ${id}`);
    }

    // ── Text Blocks ────────────────────────────────────────────────────────
    if (source.blocksField) {
      const lastPos: Record<string, string> = {};
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

          const pos = Position.generateBetween(lastPos[parentId] ?? null, null);
          lastPos[parentId] = pos;

          const { ops: relOps } = Graph.createRelation({
            fromEntity: parentId,
            toEntity: blockId,
            type: ROOT_PROPERTIES.blocks,
            position: pos,
          });
          ops.push(...relOps);
          stats.blocks++;
        }
      }
    }

    // ── Avatar Images ──────────────────────────────────────────────────────
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
          type: ContentIds.AVATAR_PROPERTY,
        });
        ops.push(...attachOps);
        stats.images++;
        console.log(`      Image: ${imageId} (CID: ${cid})`);
      }
    }
  }

  // Count total relations from ops
  stats.relations = ops.filter((op) => op.type === "createRelation").length;

  return { ops, entityIdsBySource, stats };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildValues(
  item: Record<string, any>,
  source: EntitySourceConfig,
  propertyIds: Map<string, string>
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

    // Look up the property config to determine the value type
    const valueType = getValueType(propKey, propertyIds);
    values.push({ property: propId, type: valueType, value: val });
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

    // Handle array of names (many relations) or single name
    const names = Array.isArray(val) ? val : [val];
    const targets: { toEntity: string }[] = [];

    for (const name of names) {
      // Check entity sources first, then enum IDs
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

/** Infer SDK value type from property key name conventions */
function getValueType(propKey: string, _propertyIds: Map<string, string>): string {
  const key = propKey.toLowerCase();
  if (key.includes("date") || key.includes("_date") || key === "birth_date" || key === "date_founded") return "date";
  if (key.includes("bool") || key.startsWith("is_") || key.startsWith("is")) return "boolean";
  if (key.includes("float") || key.includes("finding") || key.includes("score") || key.includes("rating")) return "float64";
  if (key.includes("int") || key.includes("count") || key.includes("number")) return "int64";
  return "text";
}
