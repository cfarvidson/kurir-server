import { db } from "@/lib/db";
import { type OwnAddresses, isOwnAddress } from "@/lib/mail/user-emails";

/**
 * Writing to someone screens them in: their reply belongs in the Imbox, not
 * the Screener. Called for every To/Cc/Bcc address of a mail the user sent,
 * whether from Kurir or from another client (seen at Sent-folder sync).
 *
 * A new sender is created APPROVED in the Imbox. A PENDING sender flips to
 * APPROVED and any mail of theirs waiting in the Screener moves to the
 * Imbox. An APPROVED sender keeps its category; a REJECTED one stays out.
 */
export async function approveRecipients(
  userId: string,
  emailConnectionId: string,
  addresses: string[],
  own?: OwnAddresses,
): Promise<void> {
  const unique = new Set(
    addresses
      .map((a) => a.trim().toLowerCase())
      .filter((a) => a.includes("@") && !(own && isOwnAddress(a, own))),
  );
  for (const email of unique) {
    const sender = await db.sender.upsert({
      where: { emailConnectionId_email: { emailConnectionId, email } },
      create: {
        userId,
        emailConnectionId,
        email,
        displayName: null,
        domain: email.split("@")[1] || email,
        status: "APPROVED",
        category: "IMBOX",
        messageCount: 0,
        decidedAt: new Date(),
      },
      update: {},
    });
    if (sender.status !== "PENDING") continue;
    await db.$transaction([
      db.sender.update({
        where: { id: sender.id },
        data: { status: "APPROVED", category: "IMBOX", decidedAt: new Date() },
      }),
      db.message.updateMany({
        // Subject-rule placements outrank sender decisions (kurir-ios#48).
        where: { senderId: sender.id, isArchived: false, subjectRuleId: null },
        data: {
          isInScreener: false,
          isInImbox: true,
          isInFeed: false,
          isInPaperTrail: false,
        },
      }),
    ]);
  }
}
