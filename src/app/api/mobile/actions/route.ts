import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMobileAuth } from "@/lib/mobile/auth";
import { rateLimitUser, tooManyRequests } from "@/lib/rate-limit";
import {
  archiveThread,
  unarchiveThread,
  setThreadReadState,
  snoozeThread,
  unsnoozeThread,
  approveSenderForUser,
  rejectSenderForUser,
} from "@/lib/mail/mutations";

/**
 * POST /api/mobile/actions
 *
 * Executes a batch of user actions from the mobile offline queue, in order.
 * Every action type is idempotent, so replaying a batch after a lost response
 * is safe. `id` is the client's queue id, echoed back for correlation.
 *
 * Response: { results: [{ id, ok, error? }] } — 200 even when individual
 * actions fail; only auth/validation problems fail the whole request.
 */

const actionSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1),
    type: z.literal("archive"),
    messageId: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("unarchive"),
    messageId: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("setRead"),
    messageId: z.string().min(1),
    isRead: z.boolean(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("snooze"),
    messageId: z.string().min(1),
    until: z.coerce.date(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("unsnooze"),
    messageId: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("approveSender"),
    senderId: z.string().min(1),
    category: z.enum(["IMBOX", "FEED", "PAPER_TRAIL"]),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("rejectSender"),
    senderId: z.string().min(1),
  }),
]);

const bodySchema = z.object({
  actions: z.array(actionSchema).min(1).max(50),
});

export async function POST(req: NextRequest) {
  const mobileAuth = await requireMobileAuth(req);
  if (!mobileAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = mobileAuth;

  const limit = await rateLimitUser(userId);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  let parsed;
  try {
    parsed = bodySchema.safeParse(await req.json());
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  for (const action of parsed.data.actions) {
    try {
      switch (action.type) {
        case "archive":
          await archiveThread(userId, action.messageId);
          break;
        case "unarchive":
          await unarchiveThread(userId, action.messageId);
          break;
        case "setRead":
          await setThreadReadState(userId, action.messageId, action.isRead);
          break;
        case "snooze":
          await snoozeThread(userId, action.messageId, action.until);
          break;
        case "unsnooze":
          await unsnoozeThread(userId, action.messageId);
          break;
        case "approveSender":
          await approveSenderForUser(userId, action.senderId, action.category);
          break;
        case "rejectSender":
          await rejectSenderForUser(userId, action.senderId);
          break;
      }
      results.push({ id: action.id, ok: true });
    } catch (err) {
      results.push({
        id: action.id,
        ok: false,
        error: err instanceof Error ? err.message : "Action failed",
      });
    }
  }

  return NextResponse.json({ results });
}
