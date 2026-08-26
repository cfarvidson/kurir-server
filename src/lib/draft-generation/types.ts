/**
 * Draft generation: shared types for the one module seam. Web server actions
 * and the mobile routes are thin wrappers around this module; tests inject a
 * stub `InferenceAdapter` so nothing here ever hits Anthropic or xAI in CI.
 */

export type DraftGenerationProvider = "claudeCode" | "grokBuild";

export type DraftGenerationErrorCode =
  | "DEMO_INSTANCE"
  | "NO_CREDENTIAL"
  | "TOKEN_REJECTED"
  | "TOKEN_DEAD"
  | "USAGE_LIMITED"
  | "MODEL_UNAVAILABLE"
  | "NO_CORRESPONDENT"
  | "UNSUPPORTED_TYPE"
  | "CONTEXT_MESSAGE_MISSING"
  | "BODY_EXISTS"
  | "GENERATION_FAILED";

export class DraftGenerationError extends Error {
  constructor(
    readonly code: DraftGenerationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DraftGenerationError";
  }
}

/** What clients may see: connected + provider, never the secret. */
export type DraftGenerationStatus = {
  connected: boolean;
  provider: DraftGenerationProvider | null;
};

/** Register the mail is written in. `auto` matches the user's own voice. */
export type DraftTone = "auto" | "formal" | "friendly" | "direct";

/**
 * One tool the model may call while drafting. `run` executes server-side,
 * already scoped to the requesting user, and its string result goes back to
 * the model verbatim. Both providers map this onto their native tool-use API.
 */
export type InferenceTool = {
  name: string;
  description: string;
  /** JSON Schema for the tool input, as both provider APIs expect it. */
  inputSchema: Record<string, unknown>;
  run: (input: Record<string, unknown>) => Promise<string>;
};

export type InferenceRequest = {
  system: string;
  user: string;
  /** Optional agentic retrieval. Absent = the old single-shot call. */
  tools?: InferenceTool[];
  /** Hard cap on tool round-trips; at the cap the model must answer. */
  maxToolCalls?: number;
};

/**
 * One call into a subscription inference endpoint. `secret` is the decrypted
 * credential (Claude: the setup-token, Grok: the session JSON). Implementations
 * call `rotateSecret` with a replacement plaintext secret after a refresh.
 */
export type InferenceAdapter = (args: {
  provider: DraftGenerationProvider;
  secret: string;
  request: InferenceRequest;
  rotateSecret: (next: string) => Promise<void>;
}) => Promise<string>;

/**
 * The one HTTP status mapping for DraftGenerationError codes, shared by the
 * mobile routes so web and native see consistent statuses.
 * 422 carries the credential-state family (missing / dead / usage limited)
 * with `code` distinguishing them, per the mobile contract.
 */
export function httpStatusForDraftGenerationError(
  code: DraftGenerationErrorCode,
): number {
  switch (code) {
    case "DEMO_INSTANCE":
      return 403;
    case "BODY_EXISTS":
      return 409;
    case "NO_CREDENTIAL":
    case "TOKEN_DEAD":
    case "USAGE_LIMITED":
      return 422;
    case "MODEL_UNAVAILABLE":
    case "GENERATION_FAILED":
      return 502;
    default:
      return 400;
  }
}
