/**
 * Real-Postgres FTS. Not collected by the default `pnpm test` suite
 * (`*.postgres.test.ts` is excluded). Run with:
 *   pnpm exec vitest run --config vitest.fts.config.mjs
 * DATABASE_URL must already be set before this process starts.
 */
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { mergeSearchFilters, searchMessages } from "@/lib/mail/search";

const stamp = Date.now();
const token = `uniquefts${stamp}`;

async function seedUser(
  email: string,
  subject: string,
  body: string,
  from: { address: string; name: string | null } = {
    address: "seller@example.com",
    name: "Seller",
  },
) {
  const user = await db.user.create({
    data: { displayName: email },
  });
  const connection = await db.emailConnection.create({
    data: {
      userId: user.id,
      email,
      imapHost: "imap.example.com",
      smtpHost: "smtp.example.com",
      encryptedPassword: "x",
    },
  });
  const folder = await db.folder.create({
    data: {
      userId: user.id,
      emailConnectionId: connection.id,
      name: "INBOX",
      path: "INBOX",
    },
  });
  const message = await db.message.create({
    data: {
      userId: user.id,
      emailConnectionId: connection.id,
      folderId: folder.id,
      uid: 1,
      fromAddress: from.address,
      fromName: from.name,
      subject,
      textBody: body,
      receivedAt: new Date(),
      isInImbox: true,
      isInScreener: false,
      isDraft: false,
      isDeleted: false,
    },
  });
  return { user, message };
}

describe("search_vector against Postgres", () => {
  let userA: { user: { id: string }; message: { id: string } };
  let userB: { user: { id: string }; message: { id: string } };
  let userC: { user: { id: string }; message: { id: string } };

  beforeAll(async () => {
    userA = await seedUser(
      `fts-a-${stamp}@example.com`,
      `Zebra invoice ${token}`,
      `the widget serial abcfts ${token}`,
    );
    userB = await seedUser(
      `fts-b-${stamp}@example.com`,
      `Zebra invoice ${token}`,
      "other body",
    );
    // A Swedish mail whose sender name is only in the address.
    userC = await seedUser(
      `fts-c-${stamp}@example.com`,
      `Fakturan för kulturföreningen ${token}`,
      "Hej, här kommer underlaget.",
      { address: `monika${stamp}@kulturforeningen.se`, name: null },
    );
  });

  afterAll(async () => {
    await db.user.deleteMany({
      where: { id: { in: [userA.user.id, userB.user.id, userC.user.id] } },
    });
  });

  it("finds the message by a name that only appears in the address", async () => {
    const hits = await searchMessages(userC.user.id, "monika", Prisma.empty);
    expect(hits.map((h) => h.id)).toContain(userC.message.id);
  });

  it("finds the message by the full address and by the domain", async () => {
    const byAddress = await searchMessages(
      userC.user.id,
      `monika${stamp}@kulturforeningen.se`,
      Prisma.empty,
    );
    expect(byAddress.map((h) => h.id)).toContain(userC.message.id);
    const byDomain = await searchMessages(
      userC.user.id,
      "kulturforeningen",
      Prisma.empty,
    );
    expect(byDomain.map((h) => h.id)).toContain(userC.message.id);
  });

  it("prefix-matches Swedish words as typed, without English stemming", async () => {
    const hits = await searchMessages(userC.user.id, "faktura", Prisma.empty);
    expect(hits.map((h) => h.id)).toContain(userC.message.id);
    const exact = await searchMessages(userC.user.id, "fakturan", Prisma.empty);
    expect(exact.map((h) => h.id)).toContain(userC.message.id);
  });

  it("lists mail for a From chip alone, matched on part of the address", async () => {
    const hits = await searchMessages(
      userC.user.id,
      "",
      mergeSearchFilters(Prisma.empty, { from: "monika" }),
      50,
      { constrained: true },
    );
    expect(hits.map((h) => h.id)).toContain(userC.message.id);
    const none = await searchMessages(userC.user.id, "", Prisma.empty);
    expect(none).toEqual([]);
  });

  it("populates search_vector on insert", async () => {
    const rows = await db.$queryRaw<{ search_vector: unknown }[]>`
      SELECT search_vector::text AS search_vector FROM "Message" WHERE id = ${userA.message.id}
    `;
    expect(rows[0]?.search_vector).toBeTruthy();
  });

  it("finds the message by subject token", async () => {
    const hits = await searchMessages(userA.user.id, "Zebra", Prisma.empty);
    expect(hits.map((h) => h.id)).toContain(userA.message.id);
  });

  it("finds the message by body token", async () => {
    const hits = await searchMessages(userA.user.id, "widget", Prisma.empty);
    expect(hits.map((h) => h.id)).toContain(userA.message.id);
  });

  it("returns empty for an unknown token", async () => {
    const hits = await searchMessages(
      userA.user.id,
      "no-such-token-xyz",
      Prisma.empty,
    );
    expect(hits).toEqual([]);
  });

  it("does not return another user's message", async () => {
    const hits = await searchMessages(userA.user.id, "Zebra", Prisma.empty);
    expect(hits.map((h) => h.id)).not.toContain(userB.message.id);
  });
});
