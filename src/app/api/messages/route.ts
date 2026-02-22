import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getMessages } from "@/lib/mail/messages";

const querySchema = z.object({
  category: z.enum(["imbox", "feed", "paper-trail", "archive"]),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
  }

  const { category, cursor, limit } = parsed.data;
  const result = await getMessages(session.user.id, category, limit, cursor);

  if (!result) {
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  }

  return NextResponse.json(result);
}
