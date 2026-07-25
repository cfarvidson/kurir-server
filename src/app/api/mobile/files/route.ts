import { NextRequest, NextResponse } from "next/server";
import { requireMobileAuth } from "@/lib/mobile/auth";
import { rateLimitUser, tooManyRequests } from "@/lib/rate-limit";
import { getFiles } from "@/lib/mail/files";
import { parseFileGroup } from "@/lib/mail/file-types";

/**
 * Mobile file browser: a page of the user's attachments, newest first. Shares
 * getFiles() — cursor pagination (`<isoCreatedAt>_<attachmentId>`), type-group
 * and filename-search filters — with the web Files page. Read-only; not
 * mirrored into the mobile GRDB store (fetched on demand like Scheduled).
 *
 * GET ?cursor=&group=&q=&limit= →
 *   { files: [{ id, filename, contentType, size, createdAt,
 *               messageId, messageSubject, fromAddress }],
 *     nextCursor, hasMore }
 *
 * `group` is validated against the shared FileGroup keys (parseFileGroup); an
 * unknown value is a 400 rather than a silent "all files".
 */
export async function GET(req: NextRequest) {
  const mobileAuth = await requireMobileAuth(req);
  if (!mobileAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = mobileAuth;

  const limit = await rateLimitUser(userId);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const params = req.nextUrl.searchParams;

  const groupParam = params.get("group");
  let group: ReturnType<typeof parseFileGroup> | undefined;
  if (groupParam) {
    group = parseFileGroup(groupParam);
    if (!group) {
      return NextResponse.json({ error: "Invalid group" }, { status: 400 });
    }
  }

  const limitParam = Number(params.get("limit"));
  const pageLimit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(Math.floor(limitParam), 100)
      : 50;

  const result = await getFiles(userId, {
    cursor: params.get("cursor"),
    group,
    q: params.get("q"),
    limit: pageLimit,
  });

  // getFiles returns null only for a malformed cursor.
  if (!result) {
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  }

  const files = result.files.map((f) => ({
    id: f.id,
    filename: f.filename,
    contentType: f.contentType,
    size: f.size,
    createdAt: f.createdAt,
    messageId: f.message?.id ?? null,
    messageSubject: f.message?.subject ?? null,
    fromAddress: f.message?.fromAddress ?? null,
  }));

  return NextResponse.json({
    files,
    nextCursor: result.nextCursor,
    hasMore: result.nextCursor !== null,
  });
}
