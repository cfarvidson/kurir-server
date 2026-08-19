import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DraftType } from "@prisma/client";
import { requireMobileAuth } from "@/lib/mobile/auth";
import { rateLimitUser, tooManyRequests } from "@/lib/rate-limit";
import {
  saveDraftSchema,
  saveDraftForUser,
  deleteDraftForUser,
  loadAttachmentMeta,
} from "@/lib/mail/drafts";
import { presentDraftsForUser } from "@/lib/mail/draft-presentation";

/**
 * Mobile CRUD for the Draft model, sharing the `(userId, type,
 * contextMessageId)` upsert contract with the web composer autosave so drafts
 * written on either surface appear on the other.
 *
 * GET    → { drafts: [...] }        list the user's drafts, newest first
 * PUT    → { draft }                upsert one draft (shared zod schema)
 * DELETE → { success: true }        idempotent delete by key
 */

const deleteSchema = z.object({
  type: z.nativeEnum(DraftType),
  contextMessageId: z.string().min(1),
});

export async function GET(req: NextRequest) {
  const mobileAuth = await requireMobileAuth(req);
  if (!mobileAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = mobileAuth;

  const limit = await rateLimitUser(userId);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const drafts = await presentDraftsForUser(userId);
  const attachmentIds = [
    ...new Set(drafts.flatMap((draft) => draft.attachmentIds)),
  ];
  const meta = await loadAttachmentMeta(userId, attachmentIds);
  const metaById = new Map(meta.map((row) => [row.id, row]));
  return NextResponse.json({
    drafts: drafts.map((d) => ({
      type: d.type,
      contextMessageId: d.contextMessageId,
      to: d.to,
      subject: d.subject,
      body: d.body,
      emailConnectionId: d.emailConnectionId,
      attachmentIds: d.attachmentIds,
      attachments: d.attachmentIds.flatMap((id) => {
        const row = metaById.get(id);
        return row ? [row] : [];
      }),
      updatedAt: d.updatedAt,
      displaySubject: d.displaySubject,
      displayFrom: d.displayFrom,
      folder: d.folder,
    })),
  });
}

export async function PUT(req: NextRequest) {
  const mobileAuth = await requireMobileAuth(req);
  if (!mobileAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = mobileAuth;

  const limit = await rateLimitUser(userId);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  let parsed;
  try {
    parsed = saveDraftSchema.safeParse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const draft = await saveDraftForUser(userId, parsed.data);
    return NextResponse.json({ draft });
  } catch {
    // The only expected throw is an attachment-ownership violation.
    return NextResponse.json(
      { error: "Invalid attachment references" },
      { status: 400 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const mobileAuth = await requireMobileAuth(req);
  if (!mobileAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = mobileAuth;

  const limit = await rateLimitUser(userId);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  let parsed;
  try {
    parsed = deleteSchema.safeParse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  await deleteDraftForUser(
    userId,
    parsed.data.type,
    parsed.data.contextMessageId,
  );
  return NextResponse.json({ success: true });
}
