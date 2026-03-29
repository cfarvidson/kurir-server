import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { startRollback } from "@/lib/updates/update-executor";

export async function POST() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await startRollback();

  if (!result.started) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  return NextResponse.json(
    { message: "Rollback started", logId: result.logId },
    { status: 202 },
  );
}
