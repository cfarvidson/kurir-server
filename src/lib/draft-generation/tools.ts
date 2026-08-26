import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { searchMessages } from "@/lib/mail/search";
import { contextBodyText } from "@/lib/draft-generation/context";
import { formatFrom } from "@/lib/mcp/serialize";
import type { InferenceTool } from "@/lib/draft-generation/types";

/**
 * The bounded mailbox tools a draft generation may call (kurir-server#133).
 * The seeded context pack (correspondence with the recipient) is the floor;
 * these are the ceiling — the model can go looking for the invoice thread
 * from March. Every executor is scoped to the requesting user, reads only
 * the replica, and truncates, so a tool loop can never turn into a dump of
 * the mailbox or reach another user's mail.
 */

export const TOOL_SEARCH_LIMIT = 8;
export const TOOL_READ_MAX_CHARS = 4000;
/** Round-trips per generation; at the cap the model is forced to answer. */
export const MAX_TOOL_CALLS = 6;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function searchMail(userId: string, query: string): Promise<string> {
  const q = query.trim();
  if (!q) return "No query given.";
  const hits = await searchMessages(userId, q, Prisma.empty, TOOL_SEARCH_LIMIT);
  if (hits.length === 0) return "No matching mail.";
  return JSON.stringify(
    hits.map((hit) => ({
      id: hit.id,
      from: formatFrom(hit.fromName, hit.fromAddress),
      subject: hit.subject ?? "",
      date: hit.receivedAt.toISOString().slice(0, 10),
      snippet: hit.snippet ?? "",
    })),
  );
}

async function readMessage(userId: string, id: string): Promise<string> {
  if (!id.trim()) return "No message id given.";
  const message = await db.message.findFirst({
    where: { userId, id },
    select: {
      subject: true,
      fromAddress: true,
      fromName: true,
      toAddresses: true,
      receivedAt: true,
      textBody: true,
      htmlBody: true,
    },
  });
  if (!message) return "No such message.";
  const header = [
    `From: ${formatFrom(message.fromName, message.fromAddress)}`,
    `To: ${message.toAddresses.join(", ")}`,
    `Date: ${message.receivedAt.toISOString().slice(0, 10)}`,
    `Subject: ${message.subject ?? ""}`,
  ].join("\n");
  const body = contextBodyText(message).slice(0, TOOL_READ_MAX_CHARS);
  return `${header}\n\n${body || "(no text)"}`;
}

/**
 * Run one tool the model asked for. Shared by both provider adapters: an
 * unknown name or a failing lookup answers the model instead of killing the
 * generation, which can still be written from the seeded context pack.
 */
export async function runInferenceTool(
  tools: InferenceTool[],
  name: string | undefined,
  input: Record<string, unknown>,
): Promise<string> {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) return `No tool named ${name}.`;
  try {
    return await tool.run(input);
  } catch {
    return `The ${tool.name} tool failed.`;
  }
}

/** The tool set offered to a panel generation, bound to one user. */
export function buildMailboxTools(userId: string): InferenceTool[] {
  return [
    {
      name: "search_mail",
      description:
        "Full-text search the user's own mailbox for context the drafted mail needs. Returns compact rows (id, from, subject, date, snippet).",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Words to search for, e.g. \"invoice March\".",
          },
        },
        required: ["query"],
      },
      run: (input) => searchMail(userId, asString(input.query)),
    },
    {
      name: "read_message",
      description:
        "Read one of the user's own messages as plain text, by the id returned from search_mail.",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Message id from search_mail.",
          },
        },
        required: ["id"],
      },
      run: (input) => readMessage(userId, asString(input.id)),
    },
  ];
}
