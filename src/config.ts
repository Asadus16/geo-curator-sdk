/**
 * Bounty Config Schema
 *
 * Defines the shape of bounty.config.json — the single file that
 * makes the SDK adapt to any bounty.
 */

import type { GeoDataType } from "./constants";

// ─── Config Types ────────────────────────────────────────────────────────────

/** A property definition — either a new custom property or a reference to an existing one */
export interface PropertyConfig {
  /** Stable ID for this property (pre-generated UUID hex). If omitted, auto-generated. */
  id?: string;
  /** Human-readable name shown in Geo Browser */
  name: string;
  /** Geo data type: TEXT, BOOLEAN, INTEGER, FLOAT, DATE, RELATION, etc. */
  dataType: GeoDataType;
  /** For RELATION properties: the type ID that target entities should have (optional, for docs) */
  targetType?: string;
}

/** An entity type definition */
export interface TypeConfig {
  /** Stable ID for this type (pre-generated UUID hex). If omitted, auto-generated. */
  id?: string;
  /** Human-readable type name */
  name: string;
  /** Keys from the properties section that belong to this type */
  properties: string[];
}

/** An enum value — creates a simple entity with a given type (e.g., contract type "Proxy") */
export interface EnumConfig {
  id?: string;
  name: string;
  /** Key from the types section this enum belongs to */
  type: string;
}

/** Describes one JSON data file and how to map its fields to entities */
export interface EntitySourceConfig {
  /** Path to the JSON file (relative to data_to_publish/) */
  file: string;
  /** Key from the types section — what type these entities are */
  type: string;
  /** Map of JSON field name → property key from the properties section.
   *  Only needed for fields beyond name/description (those are auto-mapped). */
  valueFields?: Record<string, string>;
  /** Map of JSON field name → property key, where the JSON field value is
   *  a name (or array of names) referencing entities from another source. */
  relationFields?: Record<string, { property: string; source: string }>;
  /** JSON field containing markdown text blocks (array of strings) */
  blocksField?: string;
  /** JSON field containing an image URL to upload as avatar */
  avatarField?: string;
  /** Processing order — sources with lower numbers are processed first (default: 0) */
  order?: number;
}

/** Pre-existing entities already on Geo that should be reused, not re-created */
export interface ExistingEntitiesConfig {
  /** Map of entity name → entity ID */
  [name: string]: string;
}

/** The top-level bounty config */
export interface BountyConfig {
  /** Human-readable name for this bounty */
  name: string;
  /** Edit name used when publishing */
  editName: string;

  /** Custom properties to create (key is your reference name) */
  properties?: Record<string, PropertyConfig>;

  /** Custom types to create (key is your reference name) */
  types?: Record<string, TypeConfig>;

  /** Enum entities to create (simple named entities with a type) */
  enums?: EnumConfig[];

  /** Entity data sources — each maps a JSON file to entity creation */
  sources: Record<string, EntitySourceConfig>;

  /** Pre-existing entities that should be reused by name lookup.
   *  Key is the source name these belong to, value is name→ID map. */
  existingEntities?: Record<string, ExistingEntitiesConfig>;
}
