/**
 * Seed the kurir_demo database with curated, entirely fictional demo mail
 * for marketing screenshots. Run from kurir-server root:
 *   DATABASE_URL=postgresql://kurir:kurir@localhost:5432/kurir_demo pnpm exec tsx <this file>
 */
import { PrismaClient, SenderStatus, SenderCategory } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const now = Date.now();
const min = 60_000;
const hour = 60 * min;
const day = 24 * hour;
const at = (msAgo: number) => new Date(now - msAgo);

async function main() {
  // Wipe any previous demo run
  await db.user.deleteMany({});

  const user = await db.user.create({
    data: { displayName: "Alex Berg", timezone: "Europe/Stockholm" },
  });

  const conn = await db.emailConnection.create({
    data: {
      email: "alex@kurir.io",
      displayName: "Alex Berg",
      imapHost: "imap.kurir.io",
      smtpHost: "smtp.kurir.io",
      isDefault: true,
      userId: user.id,
    },
  });

  await db.syncState.create({
    data: { emailConnectionId: conn.id, lastFullSync: at(1 * min) },
  });

  const inbox = await db.folder.create({
    data: {
      name: "INBOX",
      path: "INBOX",
      specialUse: "inbox",
      userId: user.id,
      emailConnectionId: conn.id,
    },
  });

  type SenderSpec = {
    key: string;
    email: string;
    name: string;
    status: SenderStatus;
    category?: SenderCategory;
  };

  const senderSpecs: SenderSpec[] = [
    // Imbox people
    { key: "maya", email: "maya.lindqvist@gmail.com", name: "Maya Lindqvist", status: "APPROVED", category: "IMBOX" },
    { key: "dad", email: "tomas.berg@icloud.com", name: "Tomas Berg", status: "APPROVED", category: "IMBOX" },
    { key: "jonas", email: "jonas.ek@fastmail.com", name: "Jonas Ek", status: "APPROVED", category: "IMBOX" },
    { key: "sara", email: "sara.holm@gmail.com", name: "Sara Holm", status: "APPROVED", category: "IMBOX" },
    { key: "elin", email: "elin.akesson@proton.me", name: "Elin Åkesson", status: "APPROVED", category: "IMBOX" },
    // Feed newsletters
    { key: "dense", email: "hello@densediscovery.example", name: "Dense Discovery", status: "APPROVED", category: "FEED" },
    { key: "pragmatic", email: "newsletter@pragmaticengineer.example", name: "The Pragmatic Engineer", status: "APPROVED", category: "FEED" },
    { key: "weekend", email: "digest@weekendreads.example", name: "Weekend Reads", status: "APPROVED", category: "FEED" },
    { key: "marginalia", email: "letters@marginalia.example", name: "The Marginalian", status: "APPROVED", category: "FEED" },
    { key: "slowcooking", email: "club@slowcooking.example", name: "Slow Cooking Club", status: "APPROVED", category: "FEED" },
    { key: "trailhead", email: "news@trailhead.example", name: "Trailhead Notes", status: "APPROVED", category: "FEED" },
    // Paper Trail
    { key: "stripe", email: "receipts@stripe.example", name: "Stripe", status: "APPROVED", category: "PAPER_TRAIL" },
    { key: "postnord", email: "noreply@postnord.example", name: "PostNord", status: "APPROVED", category: "PAPER_TRAIL" },
    { key: "github", email: "billing@github.example", name: "GitHub", status: "APPROVED", category: "PAPER_TRAIL" },
    // Screener (pending)
    { key: "nora", email: "nora.sjoberg@outlook.com", name: "Nora Sjöberg", status: "PENDING" },
    { key: "fieldnotes", email: "hello@fieldnotes.example", name: "Field Notes Dispatch", status: "PENDING" },
    { key: "untitled", email: "weekly@untitleddesign.example", name: "Untitled Design Weekly", status: "PENDING" },
  ];

  const senders: Record<string, { id: string }> = {};
  for (const s of senderSpecs) {
    senders[s.key] = await db.sender.create({
      data: {
        email: s.email,
        displayName: s.name,
        domain: s.email.split("@")[1],
        status: s.status,
        category: s.category ?? null,
        decidedAt: s.status === "APPROVED" ? at(30 * day) : null,
        userId: user.id,
        emailConnectionId: conn.id,
      },
    });
  }

  let uid = 100;
  type MsgSpec = {
    sender: string;
    subject: string;
    snippet: string;
    html: string;
    receivedAt: Date;
    isRead?: boolean;
    where: "imbox" | "feed" | "papertrail" | "screener";
    threadId?: string;
    fromMe?: boolean;
    hasAttachments?: boolean;
    attachments?: { filename: string; contentType: string; size: number }[];
  };

  const p = (s: string) => `<p style="margin:0 0 12px">${s}</p>`;

  const messages: MsgSpec[] = [
    // ---- Imbox ----
    {
      sender: "maya",
      subject: "Dinner on Saturday?",
      snippet: "We're doing 7pm at ours — bring nothing but yourselves. Livia is already planning dessert and it involves way too much chocolate.",
      html: p("Hi Alex!") + p("We're doing 7pm at ours — bring nothing but yourselves. Livia is already planning dessert and it involves way too much chocolate.") + p("Can you make it? The Petterssons are coming too.") + p("Maya"),
      receivedAt: at(35 * min),
      where: "imbox",
    },
    {
      sender: "jonas",
      subject: "Climbing on Thursday?",
      snippet: "I booked us the 6:30 slot at the bouldering gym. Bring your harness this time :)",
      html: p("Hey!") + p("I booked us the 6:30 slot at the bouldering gym. Bring your harness this time :)") + p("Jonas"),
      receivedAt: at(4 * hour),
      where: "imbox",
      threadId: "thread-climbing",
    },
    {
      sender: "jonas",
      subject: "Re: Climbing on Thursday?",
      snippet: "Deal. See you Thursday — 6:30 sharp. I'll bring the tape and grab the good mats before the after-work crowd shows up.",
      html: p("Deal. See you Thursday — 6:30 sharp.") + p("I'll bring the tape and grab the good mats before the after-work crowd shows up.") + p("Jonas"),
      receivedAt: at(3 * hour),
      where: "imbox",
      threadId: "thread-climbing",
    },
    {
      sender: "dad",
      subject: "Boat keys are in the shed",
      snippet: "Left them on the hook by the life jackets. Fill up the tank if you take her out past the lighthouse.",
      html: p("Left them on the hook by the life jackets.") + p("Fill up the tank if you take her out past the lighthouse. And check the bilge pump — it's been moody.") + p("Dad"),
      receivedAt: at(1 * day + 2 * hour),
      isRead: true,
      where: "imbox",
    },
    {
      sender: "sara",
      subject: "Summer cabin week — dates",
      snippet: "Week 29 or 30 works for us. The sauna is finally fixed, so no excuses this year.",
      html: p("Hi!") + p("Week 29 or 30 works for us. The sauna is finally fixed, so no excuses this year.") + p("Sara"),
      receivedAt: at(2 * day + 3 * hour),
      isRead: true,
      where: "imbox",
    },
    {
      sender: "elin",
      subject: "Photos from the weekend",
      snippet: "Uploaded the good ones — the drone shot of the lake at sunset is unreal. Full album coming later this week.",
      html: p("Uploaded the good ones — the drone shot of the lake at sunset is unreal.") + p("Full album coming later this week.") + p("/E"),
      receivedAt: at(3 * day + 5 * hour),
      isRead: true,
      where: "imbox",
      hasAttachments: true,
      attachments: [
        { filename: "lake-sunset.jpg", contentType: "image/jpeg", size: 2_400_000 },
        { filename: "midsommar-group.jpg", contentType: "image/jpeg", size: 1_800_000 },
      ],
    },
    // ---- The Feed ----
    {
      sender: "dense",
      subject: "Dense Discovery #297",
      snippet: "A calmer web, one tab at a time. This week: tools for thought, a beautiful map archive, and why slow software is good software.",
      html: p("<strong>A calmer web, one tab at a time.</strong>") + p("This week: tools for thought, a beautiful map archive, and why slow software is good software.") + p("Plus: a chair you'll want to 3D-print."),
      receivedAt: at(6 * hour),
      where: "feed",
    },
    {
      sender: "pragmatic",
      subject: "The Pulse #142: The return of the personal server",
      snippet: "Self-hosting is having a moment. What's driving engineers back to their own hardware — and what it means for cloud vendors.",
      html: p("Self-hosting is having a moment. What's driving engineers back to their own hardware — and what it means for cloud vendors.") + p("Also in this issue: hiring trends, and a deep dive on sync engines."),
      receivedAt: at(1 * day + 1 * hour),
      where: "feed",
    },
    {
      sender: "weekend",
      subject: "Weekend Reads — Issue 84",
      snippet: "Five long reads worth your Sunday coffee: the lighthouse keeper's diary, inside a seed vault, and the slow death of the phone call.",
      html: p("Five long reads worth your Sunday coffee: the lighthouse keeper's diary, inside a seed vault, and the slow death of the phone call."),
      receivedAt: at(2 * day + 6 * hour),
      where: "feed",
    },
    {
      sender: "marginalia",
      subject: "The uses of not knowing",
      snippet: "On wonder as a discipline: what a 19th-century naturalist's notebooks teach us about paying attention.",
      html: p("On wonder as a discipline: what a 19th-century naturalist's notebooks teach us about paying attention."),
      receivedAt: at(3 * day + 2 * hour),
      where: "feed",
    },
    {
      sender: "slowcooking",
      subject: "Issue 12 — Stock season",
      snippet: "Three broths worth an afternoon, and why your freezer is the best kitchen tool you own.",
      html: p("Three broths worth an afternoon, and why your freezer is the best kitchen tool you own."),
      receivedAt: at(4 * day + 3 * hour),
      where: "feed",
    },
    {
      sender: "trailhead",
      subject: "Trailhead Notes — May routes",
      snippet: "Five quiet trails within an hour of the city, ranked by swimming potential.",
      html: p("Five quiet trails within an hour of the city, ranked by swimming potential."),
      receivedAt: at(5 * day + 4 * hour),
      where: "feed",
    },
    // ---- Paper Trail ----
    {
      sender: "stripe",
      subject: "Your receipt from Acme Hosting — $12.00",
      snippet: "Receipt #2481-0442. Acme Hosting, monthly plan. Paid with •••• 4242.",
      html: p("Receipt #2481-0442") + p("Acme Hosting — monthly plan: <strong>$12.00</strong>") + p("Paid with •••• 4242."),
      receivedAt: at(8 * hour),
      isRead: true,
      where: "papertrail",
    },
    {
      sender: "postnord",
      subject: "Your package is on its way",
      snippet: "Shipment 7301244902 will be delivered to your service point on Thursday. Track your delivery online.",
      html: p("Shipment 7301244902 will be delivered to your service point on Thursday.") + p("Track your delivery online."),
      receivedAt: at(1 * day + 4 * hour),
      isRead: true,
      where: "papertrail",
    },
    {
      sender: "github",
      subject: "Payment receipt — GitHub Sponsors",
      snippet: "Thanks for sponsoring open source. Your monthly sponsorship receipt is attached.",
      html: p("Thanks for sponsoring open source.") + p("Your monthly sponsorship of <strong>$5.00</strong> was processed."),
      receivedAt: at(4 * day),
      isRead: true,
      where: "papertrail",
    },
    // ---- Screener ----
    {
      sender: "nora",
      subject: "Long time! Coffee next week?",
      snippet: "Ran into your sister at the market and realized it's been ages. Are you around Tuesday or Wednesday?",
      html: p("Ran into your sister at the market and realized it's been ages. Are you around Tuesday or Wednesday?") + p("Nora"),
      receivedAt: at(5 * hour),
      where: "screener",
    },
    {
      sender: "fieldnotes",
      subject: "Field Notes Dispatch — April",
      snippet: "New editions, shop notes, and a look inside the print floor.",
      html: p("New editions, shop notes, and a look inside the print floor."),
      receivedAt: at(1 * day + 7 * hour),
      where: "screener",
    },
    {
      sender: "untitled",
      subject: "You're invited: Untitled Design Weekly",
      snippet: "The five best design links of the week, every Friday. You were referred by a friend.",
      html: p("The five best design links of the week, every Friday.") + p("You were referred by a friend."),
      receivedAt: at(2 * day + 1 * hour),
      where: "screener",
    },
  ];

  for (const m of messages) {
    uid += 1;
    const flags = {
      isInImbox: m.where === "imbox",
      isInFeed: m.where === "feed",
      isInPaperTrail: m.where === "papertrail",
      isInScreener: m.where === "screener",
    };
    const created = await db.message.create({
      data: {
        uid,
        messageId: `<demo-${uid}@kurir.example>`,
        threadId: m.threadId ?? `thread-${uid}`,
        subject: m.subject,
        fromAddress: senderSpecs.find((s) => s.key === m.sender)!.email,
        fromName: senderSpecs.find((s) => s.key === m.sender)!.name,
        toAddresses: ["alex@kurir.io"],
        sentAt: m.receivedAt,
        receivedAt: m.receivedAt,
        snippet: m.snippet,
        htmlBody: `<div style="font-family:inherit">${m.html}</div>`,
        textBody: m.snippet,
        isRead: m.isRead ?? false,
        hasAttachments: m.hasAttachments ?? false,
        ...flags,
        folderId: inbox.id,
        userId: user.id,
        emailConnectionId: conn.id,
        senderId: senders[m.sender].id,
      },
    });
    for (const a of m.attachments ?? []) {
      await db.attachment.create({
        data: { filename: a.filename, contentType: a.contentType, size: a.size, messageId: created.id },
      });
    }
    await db.sender.update({
      where: { id: senders[m.sender].id },
      data: { messageCount: { increment: 1 } },
    });
  }

  // Alex's own reply in the climbing thread, so the conversation reads
  // naturally in the thread view. Not in any category list (it's sent mail).
  await db.message.create({
    data: {
      uid: 99,
      messageId: "<demo-99@kurir.example>",
      threadId: "thread-climbing",
      subject: "Re: Climbing on Thursday?",
      fromAddress: "alex@kurir.io",
      fromName: "Alex Berg",
      toAddresses: ["jonas.ek@fastmail.com"],
      sentAt: at(3.5 * hour),
      receivedAt: at(3.5 * hour),
      snippet: "In. But if I win, you're buying at the fancy ramen place.",
      htmlBody: `<div style="font-family:inherit">${p("In. But if I win, you're buying at the fancy ramen place.")}${p("Alex")}</div>`,
      textBody: "In. But if I win, you're buying at the fancy ramen place.",
      isRead: true,
      isInImbox: false,
      isInScreener: false,
      folderId: inbox.id,
      userId: user.id,
      emailConnectionId: conn.id,
    },
  });

  console.log("Seeded demo user:", user.id);
}

main().finally(() => db.$disconnect());
