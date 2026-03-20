/**
 * Input Validation for data files before publishing.
 *
 * Validates contract addresses, chain names, URLs, and required fields
 * so garbage data doesn't get published silently.
 */

// ─── Valid Values ───────────────────────────────────────────────────────────

const VALID_CHAINS = new Set([
  "Ethereum", "Arbitrum", "Base", "BNB Chain", "Solana", "Polygon",
  "Avalanche", "Optimism", "TRON", "Blast", "Moonbeam", "dYdX Chain",
  "Gnosis", "Fantom", "Celo", "zkSync Era", "Linea", "Scroll",
  "Mantle", "Polygon zkEVM", "Starknet",
]);

// ─── Patterns ───────────────────────────────────────────────────────────────

/** EVM address: 0x followed by 40 hex chars */
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Solana address: base58, 32–44 chars */
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** TRON address: starts with T, 34 chars */
const TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

/** Basic URL pattern */
const URL_RE = /^https?:\/\/.+/;

/** ISO date: YYYY-MM-DD */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ValidationError {
  source: string;
  index: number;
  name: string;
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

// ─── Validators ─────────────────────────────────────────────────────────────

function isValidAddress(address: string, chain: string): boolean {
  if (chain === "Solana") return SOLANA_ADDRESS_RE.test(address);
  if (chain === "TRON") return TRON_ADDRESS_RE.test(address);
  return EVM_ADDRESS_RE.test(address);
}

function isValidUrl(url: string): boolean {
  return URL_RE.test(url);
}

function isValidDate(date: string): boolean {
  return DATE_RE.test(date);
}

// ─── Source Validators ──────────────────────────────────────────────────────

function validateSmartContracts(data: any[], existingProtocols: Set<string>): { errors: ValidationError[]; warnings: ValidationError[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    const name = item.name ?? `[index ${i}]`;

    // Required: name
    if (!item.name || typeof item.name !== "string" || item.name.trim() === "") {
      errors.push({ source: "smartContracts", index: i, name, field: "name", message: "Missing or empty name" });
    }

    // Required: contractAddress
    if (!item.contractAddress) {
      errors.push({ source: "smartContracts", index: i, name, field: "contractAddress", message: "Missing contract address" });
    } else if (item.chain && !isValidAddress(item.contractAddress, item.chain)) {
      errors.push({ source: "smartContracts", index: i, name, field: "contractAddress", message: `Invalid address format for ${item.chain}: ${item.contractAddress}` });
    }

    // Required: chain
    if (!item.chain) {
      errors.push({ source: "smartContracts", index: i, name, field: "chain", message: "Missing chain" });
    } else if (!VALID_CHAINS.has(item.chain)) {
      warnings.push({ source: "smartContracts", index: i, name, field: "chain", message: `Unknown chain: "${item.chain}"` });
    }

    // Optional URLs
    if (item.explorerUrl && !isValidUrl(item.explorerUrl)) {
      errors.push({ source: "smartContracts", index: i, name, field: "explorerUrl", message: `Invalid URL: ${item.explorerUrl}` });
    }
    if (item.githubUrl && !isValidUrl(item.githubUrl)) {
      errors.push({ source: "smartContracts", index: i, name, field: "githubUrl", message: `Invalid URL: ${item.githubUrl}` });
    }

    // Protocol reference check
    if (item.protocol && existingProtocols.size > 0 && !existingProtocols.has(item.protocol)) {
      warnings.push({ source: "smartContracts", index: i, name, field: "protocol", message: `Protocol "${item.protocol}" not found in protocols source` });
    }

    // Boolean fields
    for (const boolField of ["isVerified", "isUpgradeable", "isProxy"]) {
      if (item[boolField] != null && typeof item[boolField] !== "boolean") {
        warnings.push({ source: "smartContracts", index: i, name, field: boolField, message: `Expected boolean, got ${typeof item[boolField]}` });
      }
    }
  }

  return { errors, warnings };
}

function validateAuditReports(data: any[], existingProtocols: Set<string>, existingAuditors: Set<string>): { errors: ValidationError[]; warnings: ValidationError[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    const name = item.name ?? `[index ${i}]`;

    if (!item.name || typeof item.name !== "string" || item.name.trim() === "") {
      errors.push({ source: "auditReports", index: i, name, field: "name", message: "Missing or empty name" });
    }

    // Completed date
    if (!item.completed) {
      warnings.push({ source: "auditReports", index: i, name, field: "completed", message: "Missing completion date" });
    } else if (!isValidDate(item.completed)) {
      errors.push({ source: "auditReports", index: i, name, field: "completed", message: `Invalid date format: "${item.completed}" (expected YYYY-MM-DD)` });
    }

    // Report URL
    if (item.reportUrl && !isValidUrl(item.reportUrl)) {
      errors.push({ source: "auditReports", index: i, name, field: "reportUrl", message: `Invalid URL: ${item.reportUrl}` });
    }

    // Chain
    if (item.chain && !VALID_CHAINS.has(item.chain)) {
      warnings.push({ source: "auditReports", index: i, name, field: "chain", message: `Unknown chain: "${item.chain}"` });
    }

    // Integer findings
    for (const field of ["criticalFindings", "highFindings", "mediumFindings"]) {
      if (item[field] != null) {
        const num = Number(item[field]);
        if (isNaN(num) || num < 0) {
          errors.push({ source: "auditReports", index: i, name, field, message: `Invalid findings count: "${item[field]}"` });
        }
      }
    }

    // Project reference
    if (item.project && existingProtocols.size > 0 && !existingProtocols.has(item.project)) {
      warnings.push({ source: "auditReports", index: i, name, field: "project", message: `Project "${item.project}" not found in protocols source` });
    }

    // Auditor references
    if (item.auditors && Array.isArray(item.auditors)) {
      for (const auditor of item.auditors) {
        if (existingAuditors.size > 0 && !existingAuditors.has(auditor)) {
          warnings.push({ source: "auditReports", index: i, name, field: "auditors", message: `Auditor "${auditor}" not found in auditors source` });
        }
      }
    }
  }

  return { errors, warnings };
}

function validateProtocols(data: any[]): { errors: ValidationError[]; warnings: ValidationError[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    const name = item.name ?? `[index ${i}]`;

    if (!item.name || typeof item.name !== "string" || item.name.trim() === "") {
      errors.push({ source: "protocols", index: i, name, field: "name", message: "Missing or empty name" });
    }

    if (item.website && !isValidUrl(item.website)) {
      errors.push({ source: "protocols", index: i, name, field: "website", message: `Invalid URL: ${item.website}` });
    }
    if (item.githubUrl && !isValidUrl(item.githubUrl)) {
      errors.push({ source: "protocols", index: i, name, field: "githubUrl", message: `Invalid URL: ${item.githubUrl}` });
    }
  }

  return { errors, warnings };
}

// ─── Main Validate Function ─────────────────────────────────────────────────

export function validateDataFiles(dataDir: string): ValidationResult {
  const fs = require("fs");
  const path = require("path");
  const allErrors: ValidationError[] = [];
  const allWarnings: ValidationError[] = [];

  // Load data files
  const loadJson = (filename: string): any[] => {
    const filePath = path.join(dataDir, filename);
    if (!fs.existsSync(filePath)) return [];
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  };

  const protocols = loadJson("protocols.json");
  const smartContracts = loadJson("smart_contracts.json");
  const auditReports = loadJson("audit_reports.json");
  const auditors = loadJson("auditors.json");

  // Build lookup sets
  const protocolNames = new Set(protocols.map((p: any) => p.name));
  const auditorNames = new Set(auditors.map((a: any) => a.name));

  // Validate each source
  if (protocols.length > 0) {
    const { errors, warnings } = validateProtocols(protocols);
    allErrors.push(...errors);
    allWarnings.push(...warnings);
  }

  if (smartContracts.length > 0) {
    const { errors, warnings } = validateSmartContracts(smartContracts, protocolNames);
    allErrors.push(...errors);
    allWarnings.push(...warnings);
  }

  if (auditReports.length > 0) {
    const { errors, warnings } = validateAuditReports(auditReports, protocolNames, auditorNames);
    allErrors.push(...errors);
    allWarnings.push(...warnings);
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
  };
}
