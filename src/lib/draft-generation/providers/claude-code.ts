import {
  DraftGenerationError,
  type InferenceRequest,
  type InferenceTool,
} from "@/lib/draft-generation/types";

/**
 * Claude Code subscription inference: the OAuth bearer path a setup-token
 * (`sk-ant-oat…`) is valid for — never `x-api-key`, which is the metered
 * Console billing path. A setup-token is only honored when the request
 * carries Claude Code's OAuth beta header and identifies as Claude Code in
 * the first system block, so both are pinned here.
 *
 * When the request offers tools (the compose assistant, #133) this runs
 * Anthropic's native tool-use loop: execute every `tool_use` block, hand the
 * results back as `tool_result`, repeat. At `maxToolCalls` the next request
 * goes out with `tool_choice: none`, so the model must answer.
 */

export const CLAUDE_CODE_MODEL = "claude-sonnet-5";
const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const OAUTH_BETA = "oauth-2025-04-20";
const CLAUDE_CODE_IDENTITY =
  "You are Claude Code, Anthropic's official CLI for Claude.";
const MAX_TOKENS = 1024;
const TIMEOUT_MS = 60_000;

type ContentBlock = {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
};

type MessagesPayload = { content?: ContentBlock[] };

async function callMessages(
  token: string,
  request: InferenceRequest,
  messages: unknown[],
  tools: InferenceTool[],
  forceAnswer: boolean,
): Promise<MessagesPayload> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const body: Record<string, unknown> = {
    model: CLAUDE_CODE_MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      { type: "text", text: CLAUDE_CODE_IDENTITY },
      { type: "text", text: request.system },
    ],
    messages,
  };
  if (tools.length > 0) {
    body.tools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
    // Keep the definitions on the forced round — the transcript still holds
    // tool_use blocks — and close the door with tool_choice instead.
    body.tool_choice = forceAnswer ? { type: "none" } : { type: "auto" };
  }

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
      body: JSON.stringify(body),
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
  return (await response.json()) as MessagesPayload;
}

function textOf(blocks: ContentBlock[]): string {
  return blocks
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("")
    .trim();
}

async function runTool(
  tools: InferenceTool[],
  name: string | undefined,
  input: Record<string, unknown> | undefined,
): Promise<string> {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) return `No tool named ${name}.`;
  try {
    return await tool.run(input ?? {});
  } catch {
    // A failing lookup must not kill the generation — the model can answer
    // from the seeded context pack instead.
    return `The ${tool.name} tool failed.`;
  }
}

export async function generateWithClaudeCode(
  token: string,
  request: InferenceRequest,
): Promise<string> {
  const tools = request.tools ?? [];
  const maxToolCalls = tools.length > 0 ? (request.maxToolCalls ?? 0) : 0;
  const messages: unknown[] = [{ role: "user", content: request.user }];
  let used = 0;

  for (;;) {
    const forceAnswer = used >= maxToolCalls;
    const payload = await callMessages(
      token,
      request,
      messages,
      tools,
      forceAnswer,
    );
    const blocks = payload.content ?? [];
    const toolUses = forceAnswer
      ? []
      : blocks.filter((block) => block.type === "tool_use");

    if (toolUses.length === 0) {
      const text = textOf(blocks);
      if (!text) {
        throw new DraftGenerationError(
          "GENERATION_FAILED",
          "Claude returned an empty draft.",
        );
      }
      return text;
    }

    messages.push({ role: "assistant", content: blocks });
    const results = [];
    for (const use of toolUses) {
      used += 1;
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: await runTool(tools, use.name, use.input),
      });
    }
    messages.push({ role: "user", content: results });
  }
}
