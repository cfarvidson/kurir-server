import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

/**
 * PATCH /api/auth/webauthn/passkeys/[id]
 *
 * Renames a passkey belonging to the current user.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!name || name.length > 100) {
    return NextResponse.json(
      { error: "Name must be 1-100 characters" },
      { status: 400 },
    );
  }

  const updated = await db.passkey.updateMany({
    where: { id, userId: session.user.id },
    data: { friendlyName: name },
  });

  if (updated.count === 0) {
    return NextResponse.json({ error: "Passkey not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

/**
 * DELETE /api/auth/webauthn/passkeys/[id]
 *
 * Deletes a passkey belonging to the current user.
 * Enforces a minimum-1 guard: the last passkey cannot be deleted.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const userId = session.user.id;

  // Verify the passkey belongs to the current user
  const passkey = await db.passkey.findFirst({
    where: { id, userId },
    select: { id: true },
  });

  if (!passkey) {
    return NextResponse.json({ error: "Passkey not found" }, { status: 404 });
  }

  // Atomically enforce minimum-1 guard and delete
  const deleted = await db.$transaction(async (tx) => {
    const passkeyCount = await tx.passkey.count({ where: { userId } });
    if (passkeyCount <= 1) {
      return null;
    }
    return tx.passkey.delete({ where: { id } });
  });

  if (!deleted) {
    return NextResponse.json(
      { error: "Cannot delete the last passkey. You would lose access to your account." },
      { status: 409 }
    );
  }

  return NextResponse.json({ success: true });
}
