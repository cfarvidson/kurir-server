import {
  parseGrokSession,
  serializeGrokSession,
} from "@/lib/draft-generation/grok-session";
import {
  DraftGenerationError,
  type InferenceRequest,
} from "@/lib/draft-generation/types";

/**
 * Grok Build subscription inference: the grok.com session path — never
 * `api.x.ai` with an API key, which is the metered billing path. Sessions
 * expire; on a 401 the server refreshes with the stored refresh token,
 * persists the rotated session via `rotateSecret`, and retries once. A
 * refresh failure clears the access token and asks for a fresh session.
 *
 * Endpoints are pinned; a 404 means the pin needs a bump, not a silent
 * switch onto a metered SKU.
 */

export const GROK_BUILD_MODEL = "grok-4";
const CHAT_URL = "https://build.grok.com/api/v1/chat/completions";
const REFRESH_URL = "https://build.grok.com/api/v1/oauth/token";
const MAX_TOKENS = 1024;
const TIMEOUT_MS = 60_000;

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
  request: InferenceRequest,
): Promise<Response> {
  return timedFetch(CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROK_BUILD_MODEL,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
    }),
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

async function readDraft(response: Response): Promise<string> {
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
    choices?: { message?: { content?: string } }[];
  };
  const text = payload.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) {
    throw new DraftGenerationError(
      "GENERATION_FAILED",
      "Grok returned an empty draft.",
    );
  }
  return text;
}

export async function generateWithGrokBuild(
  secret: string,
  request: InferenceRequest,
  rotateSecret: (next: string) => Promise<void>,
): Promise<string> {
  const session = parseGrokSession(secret);
  if (!session) throw freshSessionError();

  if (session.access) {
    const first = await chatOnce(session.access, request);
    if (first.status !== 401 && first.status !== 403) {
      return readDraft(first);
    }
  }

  const refreshed = await refreshSession(session.refresh);
  if (!refreshed) {
    // Clear the dead access token but keep the row so Settings still shows
    // which provider was connected when asking for a fresh session.
    await rotateSecret(
      serializeGrokSession({ access: "", refresh: session.refresh }),
    );
    throw freshSessionError();
  }
  await rotateSecret(serializeGrokSession(refreshed));

  const retried = await chatOnce(refreshed.access, request);
  if (retried.status === 401 || retried.status === 403) {
    throw freshSessionError();
  }
  return readDraft(retried);
}
