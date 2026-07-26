import { NextResponse } from "next/server";
import type { Contact, ContactEmail } from "@prisma/client";

/** Wire shape for the iOS app. `notes` is deliberately omitted — the web UI
 * neither shows nor edits it, and the mobile surface mirrors the web. */
export function serializeContact(
  contact: Contact & { emails: ContactEmail[] },
) {
  return {
    id: contact.id,
    name: contact.name,
    emails: contact.emails.map((e) => ({
      id: e.id,
      email: e.email,
      label: e.label,
      isPrimary: e.isPrimary,
    })),
  };
}

/** Map core errors: ownership misses are 404, validation failures 400. */
export function contactErrorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : "Invalid request";
  const status = message.endsWith("not found") ? 404 : 400;
  return NextResponse.json({ error: message }, { status });
}
