import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { sseSubscribers, type MailEvent } from "@/lib/mail/sse-subscribers";

// Node.js is the default runtime in Next 16, so no explicit `runtime` export is
// needed (this route needs Node — it accesses sseSubscribers, not edge-safe).
// An explicit `export const runtime` is also rejected when experimental.useCache
// is enabled (see next.config.ts), so it must stay omitted.

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = session.user.id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: MailEvent) => {
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`,
            ),
          );
        } catch {
          // Stream may be closed
        }
      };

      // Register subscriber
      if (!sseSubscribers.has(userId)) {
        sseSubscribers.set(userId, new Set());
      }
      const subscribers = sseSubscribers.get(userId)!;
      subscribers.add(send);

      // Heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          // Stream closed — clean up subscriber and stop heartbeat
          clearInterval(heartbeat);
          subscribers.delete(send);
          if (subscribers.size === 0) sseSubscribers.delete(userId);
        }
      }, 30_000);

      // Cleanup on disconnect
      request.signal.addEventListener("abort", () => {
        subscribers.delete(send);
        if (subscribers.size === 0) sseSubscribers.delete(userId);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
