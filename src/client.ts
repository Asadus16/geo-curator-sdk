/**
 * Geo SDK Client — GraphQL queries and publishing helpers
 *
 * Enhanced version with:
 *   - Typed PublishResult return
 *   - Transaction receipt waiting
 *   - Smart account + EOA wallet support
 *   - Ops file saving for deletion
 */

import {
  daoSpace,
  getSmartAccountWalletClient,
  personalSpace,
  type Op,
} from "@geoprotocol/geo-sdk";
import { createPublicClient, http } from "viem";
import * as fs from "fs";
import path from "node:path";
import { API_URL, RPC_URL } from "./constants";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PublishResult {
  success: boolean;
  editId?: string;
  cid?: string;
  transactionHash?: string;
  spaceId?: string;
  error?: string;
}

// ─── GraphQL Helper ──────────────────────────────────────────────────────────

export async function gql(query: string, variables?: Record<string, any>) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  if (json.errors) {
    console.error("GraphQL errors:", JSON.stringify(json.errors, null, 2));
    throw new Error(`GraphQL: ${json.errors[0].message}`);
  }
  return json.data;
}

// ─── Duplicate-Check Helper ──────────────────────────────────────────────────

export async function queryEntityByName(name: string): Promise<string | null> {
  try {
    const data = await gql(`{
      search(query: ${JSON.stringify(name)}, first: 5) {
        id
        name
      }
    }`);
    const entities = data?.search ?? [];
    const exact = entities.find(
      (e: any) => e.name?.toLowerCase() === name.toLowerCase()
    );
    return exact ? exact.id : null;
  } catch {
    return null;
  }
}

// ─── Publishing Helper ───────────────────────────────────────────────────────

export async function publishOps(
  ops: Op[],
  editName: string,
  spaceId: string,
  privateKey: `0x${string}`
): Promise<PublishResult> {
  if (!spaceId) return { success: false, error: "spaceId is required" };
  if (!privateKey) return { success: false, error: "privateKey is required" };

  try {
    const client = await getSmartAccountWalletClient({
      privateKey,
      rpcUrl: RPC_URL,
    });
    const address = client.account.address;
    const publicClient = createPublicClient({ transport: http(RPC_URL) });

    // Look up the caller's personal space
    const personalSpaceData = await gql(`{
      spaces(filter: { address: { is: "${address}" } }) { id type }
    }`);

    console.log(`\n  Wallet address: ${address}`);
    console.log(`  Querying space ${spaceId}...`);

    const spaceData = await gql(`{
      space(id: "${spaceId}") {
        type
        address
        membersList { memberSpaceId }
        editorsList { memberSpaceId }
      }
    }`);

    if (!spaceData.space) throw new Error(`Space ${spaceId} not found`);

    const { type: spaceType, address: daoAddress } = spaceData.space;
    console.log(`  Space type: ${spaceType}`);
    console.log(`  Publishing ${ops.length} operations...`);

    let to: `0x${string}`;
    let calldata: `0x${string}`;
    let cid: string;
    let editId: string;

    if (spaceType === "PERSONAL") {
      const result = await personalSpace.publishEdit({
        name: editName,
        spaceId,
        ops,
        author: spaceId, // must be the spaceId, not the wallet address
        network: "TESTNET",
      });
      ({ cid, editId, to, calldata } = result);
    } else {
      // DAO space — resolve caller's personal space and verify membership
      const callerSpace = personalSpaceData.spaces?.find(
        (s: any) => s.type === "PERSONAL"
      );
      if (!callerSpace) {
        throw new Error(`No personal space found for wallet ${address}`);
      }
      const callerSpaceId: string = callerSpace.id;
      console.log(`  Caller personal space: ${callerSpaceId}`);

      const members: any[] = spaceData.space.membersList ?? [];
      const editors: any[] = spaceData.space.editorsList ?? [];
      const isMemberOrEditor = [...members, ...editors].some(
        (m: any) => m.memberSpaceId === callerSpaceId
      );
      if (!isMemberOrEditor) {
        throw new Error(
          `Your personal space (${callerSpaceId}) is not a member or editor of DAO space ${spaceId}`
        );
      }

      const result = await daoSpace.proposeEdit({
        name: editName,
        ops,
        author: callerSpaceId,
        network: "TESTNET",
        callerSpaceId: `0x${callerSpaceId}` as `0x${string}`,
        daoSpaceId: `0x${spaceId}` as `0x${string}`,
        daoSpaceAddress: daoAddress as `0x${string}`,
      });
      ({ cid, editId, to, calldata } = result);
    }

    console.log("  CID:", cid);
    console.log("  Edit ID:", editId);

    const txHash = await client.sendTransaction({ to, data: calldata });
    await publicClient.waitForTransactionReceipt({ hash: txHash });

    console.log("  Transaction hash:", txHash);
    return { success: true, editId, cid, transactionHash: txHash, spaceId };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ─── Save Ops to File (for deletion later) ───────────────────────────────────

function isUuidByteArray(obj: any): boolean {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return false;
  const keys = Object.keys(obj);
  if (keys.length !== 16) return false;
  for (let i = 0; i < 16; i++) {
    if (!(String(i) in obj) || typeof obj[String(i)] !== "number") return false;
  }
  return true;
}

function convertUuidBytes(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") {
    if (
      typeof obj === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(obj)
    ) {
      return obj.replace(/-/g, "");
    }
    return obj;
  }
  if (isUuidByteArray(obj)) {
    let hex = "";
    for (let i = 0; i < 16; i++) hex += obj[String(i)].toString(16).padStart(2, "0");
    return hex;
  }
  if (Array.isArray(obj)) return obj.map(convertUuidBytes);
  const result: any = {};
  for (const key of Object.keys(obj)) result[key] = convertUuidBytes(obj[key]);
  return result;
}

export function saveOps(ops: Op[], outputDir: string, filename: string) {
  if (ops.length === 0) {
    console.log("  No ops to save.");
    return;
  }
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(outputDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(convertUuidBytes(ops), null, 2));
  console.log(`  Ops saved to ${filePath} (${ops.length} ops)`);
}

// ─── Ops Summary ─────────────────────────────────────────────────────────────

export function printOpsSummary(ops: Op[]) {
  const counts: Record<string, number> = {};
  for (const op of ops) counts[op.type] = (counts[op.type] || 0) + 1;
  console.log(`  Total operations: ${ops.length}`);
  for (const [type, count] of Object.entries(counts)) {
    console.log(`    ${type}: ${count}`);
  }
}
