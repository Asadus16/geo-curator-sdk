# Geo Curator SDK

A config-driven toolkit for publishing structured data to the [Geo Knowledge Graph](https://geobrowser.io). Instead of writing custom code for each dataset, you define a single `bounty.config.json` that maps your JSON data files to entities, relations, types, and properties — then the SDK handles the rest.

Built for the **DeFi Protocols Bounty** on the Crypto space, this SDK currently publishes **420 entities** across smart contracts, audit reports, protocols, auditors, and licenses.

## How It Works

```
bounty.config.json          JSON data files
        │                        │
        ▼                        ▼
   ┌─────────────────────────────────┐
   │         validate.ts             │  ← validates addresses, URLs, dates
   └─────────────┬───────────────────┘
                 │
   ┌─────────────▼───────────────────┐
   │          engine.ts              │  ← builds Op[] from config + data
   │  (types, properties, entities,  │
   │   values, relations, blocks)    │
   └─────────────┬───────────────────┘
                 │
   ┌─────────────▼───────────────────┐
   │          client.ts              │  ← publishes to IPFS + on-chain
   │  (smart account, tx receipt)    │
   └─────────────────────────────────┘
```

1. **Validate** — checks contract addresses (EVM/Solana/TRON), chain names, URLs, dates, and cross-references before anything gets published
2. **Build** — reads the config and data files, creates schema (types + properties), resolves relations across sources, and generates an `Op[]` array
3. **Publish** — uploads ops to IPFS, submits the CID on-chain via smart account (gas-free), waits for the transaction receipt

## Quick Start

### Prerequisites

- Node.js 18+
- A Geo wallet (export your private key from [geobrowser.io/export-wallet](https://www.geobrowser.io/export-wallet))
- A Geo space ID (from the space URL on Geo Browser)

### Setup

```bash
git clone <your-repo-url>
cd geo-sdk
npm install
cp .env.example .env
```

Edit `.env` with your credentials:

```env
PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE
SPACE_ID=YOUR_SPACE_ID_HERE
```

### Publish

```bash
npm run publish
```

This will:
- Validate all data files
- Build operations from `bounty.config.json` + `data_to_publish/`
- Print a summary of what will be created
- Publish to the Geo knowledge graph
- Output the transaction hash and a link to verify

### Query

```bash
npm run query                    # show space info + entity counts
npm run query -- list            # list entities by type
npm run query -- inspect <id>    # inspect a specific entity
```

### Delete

```bash
npm run delete                   # reverse a previous publish using saved ops
npm run delete -- <entity-id>    # delete a specific entity by ID
```

### Tests

```bash
npm test
```

Runs 34 tests covering input validation (address formats, chain names, URLs, dates, cross-references) and the ops engine (config loading, value building, relation resolution, source ordering, enum handling).

### Type Check

```bash
npm run typecheck
```

## Project Structure

```
geo-sdk/
├── publish.ts                  # CLI entry — validate, build, publish
├── query.ts                    # CLI entry — query space entities
├── delete.ts                   # CLI entry — delete/rollback entities
├── bounty.config.json          # Config for DeFi Protocols bounty
├── data_to_publish/
│   ├── protocols.json          # 44 DeFi protocols
│   ├── auditors.json           # 44 security auditors
│   ├── licenses.json           # 3 open-source licenses
│   ├── audit_reports.json      # 122 audit reports
│   └── smart_contracts.json    # 207 smart contracts
├── src/
│   ├── engine.ts               # Config-driven ops builder
│   ├── client.ts               # GraphQL client + publishing helper
│   ├── validate.ts             # Input validation (addresses, URLs, dates)
│   ├── config.ts               # TypeScript interfaces for BountyConfig
│   ├── constants.ts            # Root space IDs, API URLs, value type map
│   ├── engine.test.ts          # Engine tests
│   └── validate.test.ts        # Validation tests
├── examples/
│   ├── simple.config.json      # Minimal config example (people + topics)
│   └── research-papers.config.json
├── .env.example
├── package.json
└── tsconfig.json
```

## Config Reference

The SDK is driven entirely by `bounty.config.json`. Here's what each section does:

### `properties`

Defines custom properties (columns) for your entity types. Each property has an ID, a display name, and a data type.

```json
{
  "contractAddress": {
    "id": "8ae1a76537064c32852dff8deccbf9f0",
    "name": "Contract address",
    "dataType": "TEXT"
  },
  "isVerified": {
    "id": "454ea1bc5d7b4a19b0da05d0d179afbe",
    "name": "Is verified",
    "dataType": "BOOLEAN"
  }
}
```

Supported data types: `TEXT`, `BOOLEAN`, `INTEGER`, `FLOAT`, `DATE`, `TIME`, `DATETIME`, `RELATION`

### `types`

Defines entity types and which properties belong to them.

```json
{
  "smartContract": {
    "id": "538c05539e3949899bc55346a224a769",
    "name": "Contract",
    "properties": ["contractAddress", "chain", "isVerified", "protocol"]
  }
}
```

### `sources`

Maps each JSON data file to entity creation. Controls field mapping, relation linking, and processing order.

```json
{
  "smartContracts": {
    "file": "smart_contracts.json",
    "type": "smartContract",
    "order": 4,
    "valueFields": {
      "contractAddress": "contractAddress",
      "chain": "chain",
      "isVerified": "isVerified"
    },
    "relationFields": {
      "protocol": { "property": "protocol", "source": "protocols" },
      "contractType": { "property": "contractType", "source": "contractTypes" }
    }
  }
}
```

**Key concepts:**
- `order` — sources with lower numbers are processed first (important when one source references another via relations)
- `valueFields` — maps JSON field names to property keys for typed values
- `relationFields` — maps JSON field names to relation properties, referencing entities from another source by name

### `existingEntities`

Pre-existing entities already on Geo that should be reused rather than re-created. Keyed by source name so that `relationFields` can reference them.

```json
{
  "protocols": {
    "Aave": "1cd40f2070c84c3ebb73cf0dba0cfed9",
    "Uniswap": "5cf6e95a73124c5faac7b2317b2dd207"
  },
  "contractTypes": {
    "Proxy": "e4bb72af16e548e09cb90c5a1e2f2fc5",
    "Token": "09e72c3d7aba44578e0c14eb34d01ff9"
  }
}
```

### `enums`

Simple named entities that serve as enum values (e.g., contract types like "Proxy", "Token", "DEX").

```json
[
  { "name": "Proxy", "type": "contractType", "id": "e4bb72af16e548e09cb90c5a1e2f2fc5" }
]
```

## Adapting for a New Bounty

1. Create a new config file (e.g., `my-bounty.config.json`)
2. Define your properties, types, and sources
3. Put your JSON data files in `data_to_publish/`
4. Run with:

```bash
npx tsx --env-file=.env publish.ts my-bounty.config.json
```

See `examples/simple.config.json` for a minimal starting point — just sources with root types (person, topic, project), no custom properties needed.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PRIVATE_KEY` | Yes | Wallet private key (hex, with or without 0x prefix) |
| `SPACE_ID` | Yes | Target Geo space ID |
| `API_URL` | No | GraphQL API endpoint (defaults to testnet) |
| `RPC_URL` | No | RPC endpoint (defaults to testnet) |

## Dependencies

- [`@geoprotocol/geo-sdk`](https://www.npmjs.com/package/@geoprotocol/geo-sdk) — Geo protocol SDK for building and publishing operations
- [`viem`](https://viem.sh) — Ethereum client library for smart account transactions
- [`vitest`](https://vitest.dev) — Test runner (dev only)
- [`tsx`](https://tsx.is) — TypeScript execution (dev only)

## License

MIT
