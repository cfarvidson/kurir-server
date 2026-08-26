import {
  DraftGenerationError,
  type InferenceRequest,
} from "@/lib/draft-generation/types";

/**
 * Claude Code subscription inference: the OAuth bearer path a setup-token
 * (`sk-ant-oat…`) is valid for — never `x-api-key`, which is the metered
 * Console billing path. A setup-token is only honored when the request
 * carries Claude Code's OAuth beta header and identifies as Claude Code in
 * the first system block, so both are pinned here.
 */

export const CLAUDE_CODE_MODEL = "claude-sonnet-5";
const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const OAUTH_BETA = "oauth-2025-04-20";
const CLAUDE_CODE_IDENTITY =
  "You are Claude Code, Anthropic's official CLI for Claude.";
const MAX_TOKENS = 1024;
const TIMEOUT_MS = 60_000;

export async function generateWithClaudeCode(
  token: string,
  request: InferenceRequest,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(MESSAGES_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-beta": OAUTH_BETA,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_CODE_MODEL,
        max_tokens: MAX_TOKENS,
        system: [
          { type: "text", text: CLAUDE_CODE_IDENTITY },
          { type: "text", text: request.system },
        ],
        messages: [{ role: "user", content: request.user }],
      }),
    });
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401 || response.status === 403) {
    throw new DraftGenerationError(
      "TOKEN_DEAD",
      "The Claude token was rejected. Run `claude setup-token` and paste a fresh one in Settings.",
    );
  }
  if (response.status === 429) {
    throw new DraftGenerationError(
      "USAGE_LIMITED",
      "The Claude subscription usage window is exhausted. Try again when it resets.",
    );
  }
  if (response.status === 404) {
    throw new DraftGenerationError(
      "MODEL_UNAVAILABLE",
      `Model ${CLAUDE_CODE_MODEL} was not found — the pinned model needs a bump.`,
    );
  }
  if (!response.ok) {
    throw new DraftGenerationError(
      "GENERATION_FAILED",
      `Claude request failed with status ${response.status}.`,
    );
  }

  const payload = (await response.json()) as {
    content?: { type: string; text?: string }[];
  };
  const text = (payload.content ?? [])
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("")
    .trim();
  if (!text) {
    throw new DraftGenerationError(
      "GENERATION_FAILED",
      "Claude returned an empty draft.",
    );
  }
  return text;
}
