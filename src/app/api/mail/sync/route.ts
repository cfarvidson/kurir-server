import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { syncUserEmail } from "@/lib/mail/sync-service";

export async function POST() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await syncUserEmail(session.user.id);

  if (!result.success) {
    return NextResponse.json(
      { error: result.error, results: result.results },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    results: result.results,
  });
}

export async function GET() {
  // Allow GET for easy testing
  return POST();
}
