import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { checkForUpdates } from "@/lib/updates/version-checker";

export async function POST() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await checkForUpdates();
  return NextResponse.json(result);
}
