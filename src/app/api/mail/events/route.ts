import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { sseSubscribers, type MailEvent } from "@/lib/mail/sse-subscribers";

export const runtime = "nodejs"; // not edge — needs access to sseSubscribers

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
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`)
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
          // Stream closed
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
