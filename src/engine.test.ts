/**
 * Tests for the config-driven ops engine (engine.ts)
 *
 * Tests config loading, value building, relation building,
 * and end-to-end ops generation.
 */
import { describe, it, expect, vi } from "vitest";
import { buildOps } from "./engine";
import type { BountyConfig } from "./config";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock queryEntityByName to avoid real API calls
vi.mock("./client", () => ({
  queryEntityByName: vi.fn().mockResolvedValue(null),
}));

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "geo-engine-test-"));
}

function writeJson(dir: string, file: string, data: any) {
  fs.writeFileSync(path.join(dir, file), JSON.stringify(data));
}

// Minimal config for testing
function baseConfig(overrides?: Partial<BountyConfig>): BountyConfig {
  return {
    name: "Test Bounty",
    editName: "test-edit",
    sources: {},
    ...overrides,
  };
}

describe("buildOps", () => {
  it("returns empty ops when no sources configured", async () => {
    const tmpDir = makeTempDir();
    const result = await buildOps(baseConfig(), tmpDir);
    expect(result.ops).toHaveLength(0);
    expect(result.stats.entities).toBe(0);
  });

  it("creates custom properties", async () => {
    const tmpDir = makeTempDir();
    const config = baseConfig({
      properties: {
        testProp: { name: "Test property", dataType: "TEXT" },
      },
    });
    const result = await buildOps(config, tmpDir);
    expect(result.stats.properties).toBe(1);
    // Properties are created as entities in the SDK
    expect(result.ops.length).toBeGreaterThan(0);
  });

  it("creates custom types with properties", async () => {
    const tmpDir = makeTempDir();
    const config = baseConfig({
      properties: {
        testProp: { name: "Test property", dataType: "TEXT" },
      },
      types: {
        testType: { name: "Test type", properties: ["testProp", "name", "description"] },
      },
    });
    const result = await buildOps(config, tmpDir);
    expect(result.stats.types).toBe(1);
    expect(result.stats.properties).toBe(1);
  });

  it("creates entities from data file", async () => {
    const tmpDir = makeTempDir();
    writeJson(tmpDir, "items.json", [
      { name: "Entity A", description: "First entity" },
      { name: "Entity B", description: "Second entity" },
    ]);

    const config = baseConfig({
      sources: {
        items: { file: "items.json", order: 0 },
      },
    });

    const result = await buildOps(config, tmpDir);
    expect(result.stats.entities).toBe(2);
    expect(result.entityIdsBySource["items"]?.size).toBe(2);
  });

  it("skips items without name", async () => {
    const tmpDir = makeTempDir();
    writeJson(tmpDir, "items.json", [
      { name: "Valid" },
      { description: "no name field" },
    ]);

    const config = baseConfig({
      sources: {
        items: { file: "items.json" },
      },
    });

    const result = await buildOps(config, tmpDir);
    expect(result.stats.entities).toBe(1);
  });

  it("skips missing data files with warning", async () => {
    const tmpDir = makeTempDir();
    const config = baseConfig({
      sources: {
        missing: { file: "nonexistent.json" },
      },
    });

    const result = await buildOps(config, tmpDir);
    expect(result.ops).toHaveLength(0);
  });

  it("creates entities with typed values", async () => {
    const tmpDir = makeTempDir();
    writeJson(tmpDir, "contracts.json", [
      { name: "Contract A", website: "https://example.com" },
    ]);

    const config = baseConfig({
      properties: {
        contract_chain: { name: "Chain", dataType: "TEXT" },
      },
      sources: {
        contracts: {
          file: "contracts.json",
          valueFields: {
            website: "web_url",
          },
        },
      },
    });

    const result = await buildOps(config, tmpDir);
    expect(result.stats.entities).toBe(1);
    // Should have entity creation ops with proper value types
    const createEntityOps = result.ops.filter((op) => op.type === "createEntity");
    expect(createEntityOps.length).toBeGreaterThan(0);
  });

  it("builds relations across sources", async () => {
    const tmpDir = makeTempDir();
    writeJson(tmpDir, "protocols.json", [{ name: "Aave" }]);
    writeJson(tmpDir, "contracts.json", [
      { name: "AavePool", protocol: "Aave" },
    ]);

    const config = baseConfig({
      properties: {
        protocol_rel: { name: "Protocol", dataType: "RELATION" },
      },
      sources: {
        protocols: { file: "protocols.json", order: 0 },
        contracts: {
          file: "contracts.json",
          order: 1,
          relationFields: {
            protocol: { property: "protocol_rel", source: "protocols" },
          },
        },
      },
    });

    const result = await buildOps(config, tmpDir);
    expect(result.stats.entities).toBe(2);
    expect(result.stats.relations).toBeGreaterThan(0);
  });

  it("uses existingEntities instead of creating new ones", async () => {
    const tmpDir = makeTempDir();
    writeJson(tmpDir, "contracts.json", [
      { name: "AavePool", protocol: "Aave" },
    ]);

    const config = baseConfig({
      properties: {
        protocol_rel: { name: "Protocol", dataType: "RELATION" },
      },
      sources: {
        contracts: {
          file: "contracts.json",
          relationFields: {
            protocol: { property: "protocol_rel", source: "protocols" },
          },
        },
      },
      existingEntities: {
        protocols: { Aave: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6" },
      },
    });

    const result = await buildOps(config, tmpDir);
    // Only the contract should be created, not Aave
    expect(result.stats.entities).toBe(1);
    // Relation should point to the existing entity
    expect(result.stats.relations).toBeGreaterThan(0);
  });

  it("processes sources in order", async () => {
    const tmpDir = makeTempDir();
    writeJson(tmpDir, "first.json", [{ name: "First" }]);
    writeJson(tmpDir, "second.json", [{ name: "Second", ref: "First" }]);

    const config = baseConfig({
      properties: {
        ref_rel: { name: "Reference", dataType: "RELATION" },
      },
      sources: {
        second: {
          file: "second.json",
          order: 2,
          relationFields: {
            ref: { property: "ref_rel", source: "first" },
          },
        },
        first: { file: "first.json", order: 1 },
      },
    });

    const result = await buildOps(config, tmpDir);
    expect(result.stats.entities).toBe(2);
    // The relation should resolve because first is processed before second
    expect(result.stats.relations).toBeGreaterThan(0);
  });

  it("creates enum entities", async () => {
    const tmpDir = makeTempDir();
    const config = baseConfig({
      properties: {
        testProp: { name: "Test", dataType: "TEXT" },
      },
      types: {
        contractType: { name: "Contract type", properties: ["testProp"] },
      },
      enums: [
        { name: "Proxy", type: "contractType" },
        { name: "Token", type: "contractType" },
      ],
    });

    const result = await buildOps(config, tmpDir);
    expect(result.stats.enums).toBe(2);
  });

  it("resolves relations to enum entities", async () => {
    const tmpDir = makeTempDir();
    writeJson(tmpDir, "contracts.json", [
      { name: "TestContract", contractType: "Proxy" },
    ]);

    const config = baseConfig({
      properties: {
        contract_type_rel: { name: "Contract type", dataType: "RELATION" },
        testProp: { name: "Test", dataType: "TEXT" },
      },
      types: {
        contractType: { name: "Contract type", properties: ["testProp"] },
      },
      enums: [
        { name: "Proxy", type: "contractType" },
      ],
      sources: {
        contracts: {
          file: "contracts.json",
          relationFields: {
            contractType: { property: "contract_type_rel", source: "contractTypes" },
          },
        },
      },
    });

    const result = await buildOps(config, tmpDir);
    expect(result.stats.entities).toBe(1);
    expect(result.stats.enums).toBe(1);
    // Relation should resolve via enumIds fallback
    expect(result.stats.relations).toBeGreaterThan(0);
  });
});
