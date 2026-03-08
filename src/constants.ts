/**
 * Well-known Entity IDs from the Geo Knowledge Graph Ontology (Root Space)
 *
 * These are system types, properties, views, and data source singletons
 * defined in the root space. Reuse these across all bounties for interoperability.
 */

export const ROOT_SPACE_ID = "a19c345ab9866679b001d7d2138d88a1";

// ─── Root Space Type IDs ─────────────────────────────────────────────────────

export const ROOT_TYPES = {
  type:       "e7d737c536764c609fa16aa64a8c90ad",
  property:   "808a04ceb21c4d888ad12e240613e5ca",
  person:     "7ed45f2bc48b419e8e4664d5ff680b0d",
  project:    "484a18c5030a499cb0f2ef588ff16d50",
  company:    "e059a29e6f6b437bbc15c7983d078c0d",
  topic:      "5ef5a5860f274d8e8f6c59ae5b3e89e2",
  text_block: "76474f2f00894e77a0410b39fb17d0bf",
  data_block: "b8803a8665de412bbb357e0c84adf473",
  image:      "ba4e41460010499da0a3caaa7f579d0e",
  video:      "06e527a31af94e47a5a26e22fded083d",
  pdf:        "a2b30b3ed1d74fd0abbc12c38b477036",
} as const;

// ─── Root Space Property IDs ─────────────────────────────────────────────────

export const ROOT_PROPERTIES = {
  // Core (auto-handled by Graph.createEntity)
  name:             "a126ca530c8e48d5b88882c734c38935",
  description:      "9b1f76ff9711404c861e59dc3fa7d037",
  types:            "8f151ba4de204e3c9cb499ddf96f48f1",

  // Common value properties
  web_url:          "eed38e74e67946bf8a42ea3e4f8fb5fb",
  birth_date:       "60f8b943d9a742109356fc108ee7212c",
  date_founded:     "41aa3d9847b64a97b7ec427e575b910e",

  // Common relation properties
  topics:           "458fbc070dbf4c928f5716f3fdde7c32",

  // Blocks & Content
  blocks:           "beaba5cba67741a8b35377030613fc70",
  markdown_content: "e3e363d1dd294ccb8e6ff3b76d99bc33",

  // Data Blocks
  data_source_type: "1f69cc9880d444abad493df6a7b15ee4",
  filter:           "14a46854bfd14b1882152785c2dab9f3",
  collection_item:  "a99f9ce12ffa4dac8c61f6310d46064a",
  view:             "1907fd1c81114a3ca378b1f353425b65",

  // Media
  ipfs_url:         "8aa0684bf2454c0e85a89561a455cfaf",
  width:            "67990b42a09749e7bf1fa67770ce8329",
  height:           "cbc2145b3a3d46fcab90f28497d4ea22",
  avatar:           "8a5bfe12e3c340058b7ce0a695632664",
  cover:            "e53e2d1e29b44e3b980a1ed1df2def67",
} as const;

// ─── Data Source Singletons ──────────────────────────────────────────────────

export const QUERY_DATA_SOURCE      = "3b069b04adbe4728917d1283fd4ac27e";
export const COLLECTION_DATA_SOURCE = "1295037a5d9c4d09b27c5502654b9177";

// ─── View Type IDs ───────────────────────────────────────────────────────────

export const VIEWS = {
  table:   "cba271cef7c140339047614d174c69f1",
  list:    "7d497dba09c249b8968f716bcf520473",
  gallery: "ccb70fc917f04a54b86e3b4d20cc7130",
  bullets: "0aaac6f7c916403eaf6d2e086dc92ada",
} as const;

// ─── API Configuration ───────────────────────────────────────────────────────

export const API_URL = "https://testnet-api.geobrowser.io/graphql";
export const RPC_URL = "https://rpc-geo-test-zc16z3tcvf.t.conduit.xyz";

// ─── Valid Data Types for Properties ─────────────────────────────────────────

export const VALID_DATA_TYPES = [
  "TEXT", "BOOLEAN", "INTEGER", "FLOAT", "DATE", "TIME", "DATETIME",
  "SCHEDULE", "POINT", "BYTES", "DECIMAL", "EMBEDDING", "RELATION",
] as const;

export type GeoDataType = typeof VALID_DATA_TYPES[number];

// ─── Value type strings the SDK accepts ──────────────────────────────────────
// These are the exact strings passed as `type` in Graph.createEntity values.
// Verified from geo-sdk-tutorial/courses/05-entities.ts (the canonical source).

export const VALUE_TYPE_MAP: Record<string, string> = {
  TEXT:      "text",
  BOOLEAN:  "bool",
  INTEGER:  "int64",
  FLOAT:    "float64",
  DATE:     "date",
  TIME:     "time",
  DATETIME: "datetime",
  POINT:    "point",
  SCHEDULE: "schedule",
};

// Well-known root property → dataType mapping (for root properties used in valueFields)
export const ROOT_PROPERTY_TYPES: Record<string, string> = {
  web_url:      "TEXT",
  birth_date:   "DATE",
  date_founded: "DATE",
};
