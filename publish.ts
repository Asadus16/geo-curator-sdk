/**
 * Geo Curator SDK — Publish Entities (Config-Driven)
 *
 * Reads bounty.config.json + JSON data files and publishes to a Geo space.
 * Each bounty is just a different config file — no code changes needed.
 *
 * Usage:
 *   npx tsx --env-file=.env publish.ts                    # uses bounty.config.json
 *   npx tsx --env-file=.env publish.ts my-bounty.json     # uses custom config
 */

import * as fs from "fs";
import type { BountyConfig } from "./src/config";
import { buildOps } from "./src/engine";
import { publishOps, saveOps, printOpsSummary } from "./src/client";

const PRIVATE_KEY = process.env["PRIVATE_KEY"] as `0x${string}`;
const SPACE_ID = process.env["SPACE_ID"] as string;

if (!PRIVATE_KEY) { console.error("Error: PRIVATE_KEY not set in .env"); process.exit(1); }
if (!SPACE_ID) { console.error("Error: SPACE_ID not set in .env"); process.exit(1); }

// Load config (default: bounty.config.json, or pass custom path as arg)
const configPath = process.argv[2] || "bounty.config.json";
if (!fs.existsSync(configPath)) {
  console.error(`Error: Config file not found: ${configPath}`);
  console.error("Create a bounty.config.json or pass the path as an argument.");
  process.exit(1);
}

const config: BountyConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
const dataDir = "./data_to_publish";

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Geo Curator SDK — ${config.name}`);
  console.log("═══════════════════════════════════════════════════════════════");

  // Build all ops from config + data
  const { ops, stats } = await buildOps(config, dataDir);

  if (ops.length === 0) {
    console.log("\n  No operations generated. Check your config and data files.");
    process.exit(1);
  }

  // Summary
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  Build Summary");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Properties created: ${stats.properties}`);
  console.log(`  Types created:      ${stats.types}`);
  console.log(`  Enums created:      ${stats.enums}`);
  console.log(`  Entities created:   ${stats.entities}`);
  console.log(`  Relations created:  ${stats.relations}`);
  console.log(`  Text blocks:        ${stats.blocks}`);
  console.log(`  Images uploaded:    ${stats.images}`);
  printOpsSummary(ops);

  // Save ops for potential rollback
  saveOps(ops, "data_to_delete", "publish_ops.json");

  // Publish
  console.log("\n  Publishing to the Geo knowledge graph...");
  const result = await publishOps(ops, config.editName, SPACE_ID, PRIVATE_KEY);

  if (!result.success) {
    console.error("\n  Publish failed:", result.error);
    process.exit(1);
  }

  console.log("\n  Published successfully!");
  console.log(`    Edit ID: ${result.editId}`);
  console.log(`    CID:     ${result.cid}`);
  console.log(`    TX:      ${result.transactionHash}`);
  console.log(`\n  Verify at: https://geobrowser.io/space/${SPACE_ID}`);
}

main().catch((err) => {
  console.error("\nError:", err);
  process.exit(1);
});
