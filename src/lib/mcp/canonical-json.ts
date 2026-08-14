import { createHash } from "crypto";

/**
 * Canonical JSON for MCP confirmation arg hashing: UTF-8, sorted object
 * keys, no insignificant whitespace. Arrays keep their original order.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const nested = (value as Record<string, unknown>)[key];
    if (nested === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalJson(nested)}`);
  }
  return `{${parts.join(",")}}`;
}

export function hashArgs(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
