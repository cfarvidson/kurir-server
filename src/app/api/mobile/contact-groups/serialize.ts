import { NextResponse } from "next/server";
import { listGroupsForUser } from "@/lib/mail/contact-groups";

/** Compose the wire `group` shape from the existing list core — no new core
 * needed since `listGroupsForUser` already returns the exact element shape
 * the mobile responses use. */
export async function getGroupForUser(userId: string, groupId: string) {
  const groups = await listGroupsForUser(userId);
  return groups.find((g) => g.id === groupId);
}

/** Map core errors: ownership misses are 404, validation failures 400. */
export function groupErrorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : "Invalid request";
  const status = message.endsWith("not found") ? 404 : 400;
  return NextResponse.json({ error: message }, { status });
}
