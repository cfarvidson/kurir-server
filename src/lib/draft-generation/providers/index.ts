import { generateWithClaudeCode } from "@/lib/draft-generation/providers/claude-code";
import { generateWithGrokBuild } from "@/lib/draft-generation/providers/grok-build";
import type { InferenceAdapter } from "@/lib/draft-generation/types";

/** Dispatch on the stored provider. Tests inject a stub instead of this. */
export const defaultInferenceAdapter: InferenceAdapter = async ({
  provider,
  secret,
  request,
  rotateSecret,
}) => {
  if (provider === "claudeCode") {
    return generateWithClaudeCode(secret, request);
  }
  return generateWithGrokBuild(secret, request, rotateSecret);
};
