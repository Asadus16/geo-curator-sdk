/**
 * Tests for input validation (validate.ts)
 */
import { describe, it, expect, beforeEach } from "vitest";
import { validateDataFiles } from "./validate";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "geo-test-"));
}

function writeJson(dir: string, file: string, data: any) {
  fs.writeFileSync(path.join(dir, file), JSON.stringify(data));
}

describe("validateDataFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  it("returns valid when no data files exist", () => {
    const result = validateDataFiles(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // ─── Smart Contracts ────────────────────────────────────────────────

  describe("smart contracts", () => {
    it("passes valid EVM contract", () => {
      writeJson(tmpDir, "smart_contracts.json", [
        {
          name: "TestContract",
          contractAddress: "0x64b761D848206f447Fe2dd461b0c635Ec39EbB27",
          chain: "Ethereum",
        },
      ]);
      const result = validateDataFiles(tmpDir);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("rejects missing name", () => {
      writeJson(tmpDir, "smart_contracts.json", [
        { contractAddress: "0x64b761D848206f447Fe2dd461b0c635Ec39EbB27", chain: "Ethereum" },
      ]);
      const result = validateDataFiles(tmpDir);
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe("name");
    });

    it("rejects missing contract address", () => {
      writeJson(tmpDir, "smart_contracts.json", [
        { name: "Test", chain: "Ethereum" },
      ]);
      const result = validateDataFiles(tmpDir);
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe("contractAddress");
    });

    it("rejects invalid EVM address", () => {
      writeJson(tmpDir, "smart_contracts.json", [
        { name: "Test", contractAddress: "0xINVALID", chain: "Ethereum" },
      ]);
      const result = validateDataFiles(tmpDir);
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe("contractAddress");
      expect(result.errors[0].message).toContain("Invalid address format");
    });

    it("validates Solana address format", () => {
      writeJson(tmpDir, "smart_contracts.json", [
        {
          name: "SolContract",
          contractAddress: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          chain: "Solana",
        },
      ]);
      const result = validateDataFiles(tmpDir);
      expect(result.valid).toBe(true);
    });

    it("validates TRON address format", () => {
      writeJson(tmpDir, "smart_contracts.json", [
        {
          name: "TronContract",
          contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
          chain: "TRON",
        },
      ]);
      const result = validateDataFiles(tmpDir);
      expect(result.valid).toBe(true);
    });

    it("rejects missing chain", () => {
      writeJson(tmpDir, "smart_contracts.json", [
        { name: "Test", contractAddress: "0x64b761D848206f447Fe2dd461b0c635Ec39EbB27" },
      ]);
      const result = validateDataFiles(tmpDir);
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe("chain");
    });

    it("warns on unknown chain", () => {
      writeJson(tmpDir, "smart_contracts.json", [
        {
          name: "Test",
          contractAddress: "0x64b761D848206f447Fe2dd461b0c635Ec39EbB27",
          chain: "UnknownChain",
        },
      ]);
      const result = validateDataFiles(tmpDir);
      expect(result.valid).toBe(true); // warning, not error
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].message).toContain("Unknown chain");
    });

    it("rejects invalid explorer URL", () => {
      writeJson(tmpDir, "smart_contracts.json", [
        {
          name: "Test",
          contractAddress: "0x64b761D848206f447Fe2dd461b0c635Ec39EbB27",
          chain: "Ethereum",
          explorerUrl: "not-a-url",
        },
      ]);
      const result = validateDataFiles(tmpDir);
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe("explorerUrl");
    });

    it("warns on non-boolean isVerified", () => {
      writeJson(tmpDir, "smart_contracts.json", [
        {
          name: "Test",
          contractAddress: "0x64b761D848206f447Fe2dd461b0c635Ec39EbB27",
          chain: "Ethereum",
          isVerified: "yes",
        },
      ]);
      const result = validateDataFiles(tmpDir);
      expect(result.warnings.some((w) => w.field === "isVerified")).toBe(true);
    });
  });

  // ─── Audit Reports ──────────────────────────────────────────────────

  describe("audit reports", () => {
    it("passes valid audit report", () => {
      writeJson(tmpDir, "audit_reports.json", [
        { name: "Audit 1", completed: "2023-06-01" },
      ]);
      const result = validateDataFiles(tmpDir);
      expect(result.valid).toBe(true);
    });

    it("rejects missing name", () => {
      writeJson(tmpDir, "audit_reports.json", [
        { completed: "2023-06-01" },
      ]);
      const result = validateDataFiles(tmpDir);
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe("name");
    });

    it("rejects invalid date format", () => {
      writeJson(tmpDir, "audit_reports.json", [
        { name: "Audit 1", completed: "June 2023" },
      ]);
      const result = validateDataFiles(tmpDir);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain("Invalid date format");
    });

    it("warns on missing completion date", () => {
      writeJson(tmpDir, "audit_reports.json", [
        { name: "Audit 1" },
      ]);
      const result = validateDataFiles(tmpDir);
      expect(result.valid).toBe(true); // warning, not error
      expect(result.warnings.some((w) => w.field === "completed")).toBe(true);
    });

    it("rejects invalid report URL", () => {
      writeJson(tmpDir, "audit_reports.json", [
        { name: "Audit 1", completed: "2023-01-01", reportUrl: "ftp://bad" },
      ]);
      const result = validateDataFiles(tmpDir);
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe("reportUrl");
    });

    it("rejects negative findings count", () => {
      writeJson(tmpDir, "audit_reports.json", [
        { name: "Audit 1", completed: "2023-01-01", criticalFindings: -1 },
      ]);
      const result = validateDataFiles(tmpDir);
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe("criticalFindings");
    });

    it("cross-references protocol names when protocols exist", () => {
      writeJson(tmpDir, "protocols.json", [{ name: "Aave" }]);
      writeJson(tmpDir, "audit_reports.json", [
        { name: "Audit 1", completed: "2023-01-01", project: "NonExistent" },
      ]);
      const result = validateDataFiles(tmpDir);
      expect(result.warnings.some((w) => w.field === "project")).toBe(true);
    });

    it("cross-references auditor names when auditors exist", () => {
      writeJson(tmpDir, "auditors.json", [{ name: "Trail of Bits" }]);
      writeJson(tmpDir, "audit_reports.json", [
        { name: "Audit 1", completed: "2023-01-01", auditors: ["UnknownAuditor"] },
      ]);
      const result = validateDataFiles(tmpDir);
      expect(result.warnings.some((w) => w.field === "auditors")).toBe(true);
    });
  });

  // ─── Protocols ──────────────────────────────────────────────────────

  describe("protocols", () => {
    it("passes valid protocol", () => {
      writeJson(tmpDir, "protocols.json", [
        { name: "Aave", website: "https://aave.com" },
      ]);
      const result = validateDataFiles(tmpDir);
      expect(result.valid).toBe(true);
    });

    it("rejects invalid website URL", () => {
      writeJson(tmpDir, "protocols.json", [
        { name: "Aave", website: "not-a-url" },
      ]);
      const result = validateDataFiles(tmpDir);
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe("website");
    });

    it("rejects invalid github URL", () => {
      writeJson(tmpDir, "protocols.json", [
        { name: "Aave", githubUrl: "github.com/aave" },
      ]);
      const result = validateDataFiles(tmpDir);
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe("githubUrl");
    });
  });
});
