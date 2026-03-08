/**
 * Geo Curator SDK — Delete / Cleanup Entities
 *
 * Two modes:
 *   1. Reverse a previous publish (from saved ops file)
 *   2. Delete a specific entity by ID (queries its data from the API)
 *
 * Usage:
 *   npx tsx --env-file=.env delete.ts                           # reverse last publish
 *   npx tsx --env-file=.env delete.ts <entityId>                # delete specific entity
 *   npx tsx --env-file=.env delete.ts <entityId> <spaceId>      # delete in specific space
 */

import * as fs from "fs";
import path from "node:path";
import { Graph, type Op } from "@geoprotocol/geo-sdk";
import { gql, publishOps, saveOps, printOpsSummary } from "./src/client";

const PRIVATE_KEY = process.env["PRIVATE_KEY"] as `0x${string}`;
const SPACE_ID = process.env["SPACE_ID"] as string;

if (!PRIVATE_KEY) { console.error("Error: PRIVATE_KEY not set in .env"); process.exit(1); }
if (!SPACE_ID) { console.error("Error: SPACE_ID not set in .env"); process.exit(1); }

// ─── Mode 1: Reverse from saved ops file ────────────────────────────────────

function deleteFromOpsFile(filePath: string): Op[] {
  if (!fs.existsSync(filePath)) {
    console.error(`  File not found: ${filePath}`);
    console.error("  Run publish.ts first to generate ops.");
    process.exit(1);
  }

  const savedOps = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  console.log(`  Read ${savedOps.length} ops from ${filePath}`);

  const deleteOps: Op[] = [];

  // Unset values from created entities
  const createEntityOps = savedOps.filter((op: any) => op.type === "createEntity");
  const entityIds = [...new Set(createEntityOps.map((op: any) => op.id))] as string[];

  for (const entityId of entityIds) {
    const entityOp = createEntityOps.find((op: any) => op.id === entityId);
    const properties = (entityOp?.values ?? [])
      .map((v: any) => v.property)
      .filter(Boolean);

    if (properties.length > 0) {
      const { ops } = Graph.updateEntity({
        id: entityId,
        unset: properties.map((p: string) => ({ property: p })),
      });
      deleteOps.push(...ops);
    }
  }

  // Delete relations
  const relationOps = savedOps.filter((op: any) => op.type === "createRelation");
  const relationIds = [...new Set(relationOps.map((op: any) => op.id))] as string[];

  for (const relationId of relationIds) {
    const { ops } = Graph.deleteRelation({ id: relationId });
    deleteOps.push(...ops);
  }

  console.log(`  Generated ${deleteOps.length} delete ops`);
  console.log(`    Entity unsets: ${entityIds.length}, Relation deletes: ${relationIds.length}`);
  return deleteOps;
}

// ─── Mode 2: Delete entity by ID ────────────────────────────────────────────

async function deleteEntityById(entityId: string, spaceId: string): Promise<Op[]> {
  console.log(`  Querying entity ${entityId} in space ${spaceId}...`);

  const data = await gql(`{
    values(filter: {
      entityId: { is: "${entityId}" }
      spaceId: { is: "${spaceId}" }
    }) {
      propertyId
      propertyEntity { name }
    }
    relations(filter: {
      fromEntityId: { is: "${entityId}" }
      spaceId: { is: "${spaceId}" }
    }) {
      id typeId
      typeEntity { name }
      toEntity { name }
    }
  }`);

  const values = data.values ?? [];
  const relations = data.relations ?? [];
  const uniqueProps = [...new Set(values.map((v: any) => v.propertyId))] as string[];

  console.log(`  Found ${uniqueProps.length} properties, ${relations.length} relations`);

  const deleteOps: Op[] = [];

  if (uniqueProps.length > 0) {
    const { ops } = Graph.updateEntity({
      id: entityId,
      unset: uniqueProps.map((p) => ({ property: p })),
    });
    deleteOps.push(...ops);
  }

  for (const r of relations) {
    const { ops } = Graph.deleteRelation({ id: r.id });
    deleteOps.push(...ops);
  }

  return deleteOps;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Geo Curator SDK — Delete / Cleanup");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const entityId = process.argv[2];
  const targetSpaceId = process.argv[3] || SPACE_ID;
  let deleteOps: Op[];

  if (entityId) {
    console.log("  Mode: Delete entity by ID");
    deleteOps = await deleteEntityById(entityId, targetSpaceId);
  } else {
    console.log("  Mode: Reverse previous publish");
    deleteOps = deleteFromOpsFile(path.join("data_to_delete", "publish_ops.json"));
  }

  if (deleteOps.length === 0) {
    console.log("\n  Nothing to delete.");
    return;
  }

  printOpsSummary(deleteOps);
  saveOps(deleteOps, "data_to_delete", "delete_ops.json");

  console.log("\n  Publishing delete operations...");
  const result = await publishOps(deleteOps, "Curator SDK: cleanup", targetSpaceId, PRIVATE_KEY);

  if (!result.success) {
    console.error("\n  Delete failed:", result.error);
    process.exit(1);
  }

  console.log("\n  Deleted successfully!");
  console.log(`    TX: ${result.transactionHash}`);
  console.log(`\n  Verify at: https://geobrowser.io/space/${targetSpaceId}`);
}

main().catch((err) => {
  console.error("\nError:", err);
  process.exit(1);
});
