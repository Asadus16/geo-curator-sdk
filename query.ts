/**
 * Geo Curator SDK — Query & Verify Published Data
 *
 * Config-aware: reads bounty.config.json to know which types to query.
 * Also works without a config for general space exploration.
 *
 * Usage:
 *   npx tsx --env-file=.env query.ts                    # list all entities by type
 *   npx tsx --env-file=.env query.ts <entityId>         # inspect specific entity
 */

import * as fs from "fs";
import { gql } from "./src/client";
import { ROOT_SPACE_ID, ROOT_TYPES } from "./src/constants";
import type { BountyConfig } from "./src/config";

const SPACE_ID = process.env["SPACE_ID"] || ROOT_SPACE_ID;

// Try to load config for type-aware querying
let config: BountyConfig | null = null;
const configPath = "bounty.config.json";
if (fs.existsSync(configPath)) {
  config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function spaceInfo(spaceId: string) {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Space: ${spaceId}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  const data = await gql(`{
    space(id: "${spaceId}") {
      id type address
      page { name description }
    }
  }`);

  if (!data.space) { console.log("  Space not found.\n"); return; }
  console.log(`  Type: ${data.space.type}`);
  console.log(`  Address: ${data.space.address}`);
  if (data.space.page?.name) console.log(`  Name: ${data.space.page.name}`);
  if (data.space.page?.description) console.log(`  Description: ${data.space.page.description.slice(0, 100)}`);
  console.log();
}

async function listByType(spaceId: string, typeId: string, typeName: string) {
  console.log(`── ${typeName} ──`);

  const data = await gql(`{
    entities(
      spaceId: "${spaceId}"
      typeId: "${typeId}"
      first: 30
      filter: { name: { isNull: false } }
      orderBy: UPDATED_AT_DESC
    ) { id name description }
  }`);

  const entities = data.entities ?? [];
  if (entities.length === 0) { console.log("  (none)\n"); return; }

  for (const e of entities) {
    const desc = e.description ? ` — ${e.description.slice(0, 70)}` : "";
    console.log(`  ${e.name} (${e.id})${desc}`);
  }
  console.log(`  Count: ${entities.length}\n`);
}

async function inspectEntity(entityId: string, spaceId: string) {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Entity: ${entityId}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  const data = await gql(`{
    values(filter: {
      entityId: { is: "${entityId}" }
      spaceId: { is: "${spaceId}" }
    }) {
      propertyId text integer float boolean date datetime
      propertyEntity { name }
    }
    relations(filter: {
      fromEntityId: { is: "${entityId}" }
      spaceId: { is: "${spaceId}" }
    }, first: 50) {
      id typeId position
      typeEntity { name }
      toEntity { name }
    }
  }`);

  console.log("  Values:");
  for (const v of data.values ?? []) {
    const prop = v.propertyEntity?.name || v.propertyId;
    const val = v.text ?? v.integer ?? v.float ?? v.boolean ?? v.date ?? v.datetime ?? "(complex)";
    console.log(`    ${prop}: ${val}`);
  }

  console.log("\n  Relations:");
  for (const r of data.relations ?? []) {
    const type = r.typeEntity?.name || r.typeId;
    const to = r.toEntity?.name || "(unknown)";
    console.log(`    --[${type}]--> ${to}${r.position ? ` (pos: ${r.position})` : ""}`);
  }
  console.log();
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const entityId = process.argv[2];

  if (entityId && !entityId.endsWith(".json")) {
    await inspectEntity(entityId, SPACE_ID);
    return;
  }

  await spaceInfo(SPACE_ID);

  // If we have a bounty config, query its custom types
  if (config?.types) {
    console.log(`Querying types from: ${config.name}\n`);
    for (const [key, type] of Object.entries(config.types)) {
      const typeId = type.id;
      if (typeId) {
        await listByType(SPACE_ID, typeId, type.name);
      }
    }
  }

  // Always query standard root types
  console.log("Standard types:\n");
  await listByType(SPACE_ID, ROOT_TYPES.topic, "Topic");
  await listByType(SPACE_ID, ROOT_TYPES.person, "Person");
  await listByType(SPACE_ID, ROOT_TYPES.project, "Project");
  await listByType(SPACE_ID, ROOT_TYPES.company, "Company");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
