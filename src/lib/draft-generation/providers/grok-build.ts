import {
  parseGrokSession,
  serializeGrokSession,
} from "@/lib/draft-generation/grok-session";
import { runInferenceTool } from "@/lib/draft-generation/tools";
import {
  DraftGenerationError,
  type InferenceRequest,
  type InferenceTool,
} from "@/lib/draft-generation/types";

/**
 * Grok Build subscription inference: the grok.com session path — never
 * `api.x.ai` with an API key, which is the metered billing path. Sessions
 * expire; on a 401 the server refreshes with the stored refresh token,
 * persists the rotated session via `rotateSecret`, and retries once. A
 * refresh failure clears the access token and asks for a fresh session.
 * The refresh happens at most once per generation, so it also covers the
 * later rounds of a tool loop.
 *
 * When the request offers tools (the compose assistant, #133) this runs the
 * OpenAI-shaped function-calling loop: execute every `tool_calls` entry,
 * append the results as `role: "tool"` messages, repeat. At `maxToolCalls`
 * the next request goes out with `tool_choice: "none"`.
 *
 * Endpoints are pinned; a 404 means the pin needs a bump, not a silent
 * switch onto a metered SKU.
 */

export const GROK_BUILD_MODEL = "grok-4";
const CHAT_URL = "https://build.grok.com/api/v1/chat/completions";
const REFRESH_URL = "https://build.grok.com/api/v1/oauth/token";
const MAX_TOKENS = 1024;
const TIMEOUT_MS = 60_000;

type ToolCall = {
  id?: string;
  function?: { name?: string; arguments?: string };
};

type ChatMessage = {
  role?: string;
  content?: string | null;
  tool_calls?: ToolCall[];
};

function freshSessionError(): DraftGenerationError {
  return new DraftGenerationError(
    "TOKEN_DEAD",
    "The Grok session expired. Sign in with `grok login` and paste a fresh session in Settings.",
  );
}

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function chatOnce(
  accessToken: string,
  messages: unknown[],
  tools: InferenceTool[],
  forceAnswer: boolean,
): Promise<Response> {
  const body: Record<string, unknown> = {
    model: GROK_BUILD_MODEL,
    max_tokens: MAX_TOKENS,
    messages,
  };
  if (tools.length > 0) {
    body.tools = tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
    body.tool_choice = forceAnswer ? "none" : "auto";
  }
  return timedFetch(CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function refreshSession(refreshToken: string): Promise<{
  access: string;
  refresh: string;
} | null> {
  let response: Response;
  try {
    response = await timedFetch(REFRESH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
  };
  if (!payload.access_token) return null;
  return {
    access: payload.access_token,
    refresh: payload.refresh_token ?? refreshToken,
  };
}

async function readChatMessage(response: Response): Promise<ChatMessage> {
  if (response.status === 429) {
    throw new DraftGenerationError(
      "USAGE_LIMITED",
      "The Grok subscription usage window is exhausted. Try again when it resets.",
    );
  }
  if (response.status === 404) {
    throw new DraftGenerationError(
      "MODEL_UNAVAILABLE",
      `Model ${GROK_BUILD_MODEL} was not found — the pinned model needs a bump.`,
    );
  }
  if (!response.ok) {
    throw new DraftGenerationError(
      "GENERATION_FAILED",
      `Grok request failed with status ${response.status}.`,
    );
  }
  const payload = (await response.json()) as {
    choices?: { message?: ChatMessage }[];
  };
  return payload.choices?.[0]?.message ?? {};
}

function parseArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function generateWithGrokBuild(
  secret: string,
  request: InferenceRequest,
  rotateSecret: (next: string) => Promise<void>,
): Promise<string> {
  const session = parseGrokSession(secret);
  if (!session) throw freshSessionError();

  const tools = request.tools ?? [];
  const maxToolCalls = tools.length > 0 ? (request.maxToolCalls ?? 0) : 0;
  const messages: unknown[] = [
    { role: "system", content: request.system },
    { role: "user", content: request.user },
  ];

  let access = session.access;
  let refreshed = false;

  /** One chat round, refreshing the session at most once per generation. */
  const chat = async (forceAnswer: boolean): Promise<ChatMessage> => {
    if (access) {
      const first = await chatOnce(access, messages, tools, forceAnswer);
      if (first.status !== 401 && first.status !== 403) {
        return readChatMessage(first);
      }
      if (refreshed) throw freshSessionError();
    }
    refreshed = true;
    const next = await refreshSession(session.refresh);
    if (!next) {
      // Clear the dead access token but keep the row so Settings still shows
      // which provider was connected when asking for a fresh session.
      await rotateSecret(
        serializeGrokSession({ access: "", refresh: session.refresh }),
      );
      throw freshSessionError();
    }
    await rotateSecret(serializeGrokSession(next));
    access = next.access;
    const retried = await chatOnce(access, messages, tools, forceAnswer);
    if (retried.status === 401 || retried.status === 403) {
      throw freshSessionError();
    }
    return readChatMessage(retried);
  };

  let used = 0;
  for (;;) {
    const forceAnswer = used >= maxToolCalls;
    const message = await chat(forceAnswer);
    const calls = forceAnswer ? [] : (message.tool_calls ?? []);

    if (calls.length === 0) {
      const text = message.content?.trim() ?? "";
      if (!text) {
        throw new DraftGenerationError(
          "GENERATION_FAILED",
          "Grok returned an empty draft.",
        );
      }
      return text;
    }

    messages.push({
      role: "assistant",
      content: message.content ?? "",
      tool_calls: calls,
    });
    for (const call of calls) {
      used += 1;
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: await runInferenceTool(
          tools,
          call.function?.name,
          parseArguments(call.function?.arguments),
        ),
      });
    }
  }
}
