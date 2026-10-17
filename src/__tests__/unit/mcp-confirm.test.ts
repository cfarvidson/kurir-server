import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "@/lib/mcp/types";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

vi.mock("@/lib/mcp/confirmations", () => ({
  createConfirmation: vi.fn(async () => ({ id: "c1", message: "ok" })),
  consumeConfirmation: vi.fn(),
}));

import { createConfirmation } from "@/lib/mcp/confirmations";

function ctx(partial: Partial<ToolContext> = {}): ToolContext {
  return {
    userId: "u1",
    tokenId: "t1",
    hasElicitation: false,
    ...partial,
  };
}

describe("requireConfirmation", () => {
  beforeEach(() => {
    vi.mocked(createConfirmation).mockClear();
  });

  it("asks a client that cannot elicit to retry with confirm true", async () => {
    const { CANNOT_CONFIRM, requireConfirmation, wrap } = await import(
      "@/lib/mcp/tools/helpers"
    );
    const ran = vi.fn();
    const result = await wrap(async (toolCtx) =>
      requireConfirmation(toolCtx, "screen_sender", { action: "reject" }, "Reject", async () => {
        ran();
        return { type: "ok", structuredContent: { ok: true } };
      }),
    )(ctx(), { action: "reject" });
    expect(result).toEqual({ type: "error", message: CANNOT_CONFIRM });
    expect(ran).not.toHaveBeenCalled();
    expect(createConfirmation).not.toHaveBeenCalled();
  });

  it("runs the action when that client retries with confirm true", async () => {
    const { requireConfirmation, wrap } = await import(
      "@/lib/mcp/tools/helpers"
    );
    const result = await wrap(async (toolCtx) =>
      requireConfirmation(
        toolCtx,
        "screen_sender",
        { action: "reject", confirm: true },
        "Reject",
        async () => ({ type: "ok", structuredContent: { ok: true } }),
      ),
    )(ctx(), { action: "reject", confirm: true });
    expect(result).toEqual({ type: "ok", structuredContent: { ok: true } });
    expect(createConfirmation).not.toHaveBeenCalled();
  });

  it("still elicits when the client can show a prompt", async () => {
    const { requireConfirmation, wrap } = await import(
      "@/lib/mcp/tools/helpers"
    );
    const result = await wrap(async (toolCtx) =>
      requireConfirmation(
        toolCtx,
        "screen_sender",
        { action: "reject", confirm: true },
        "Reject sender",
        async () => ({ type: "ok", structuredContent: { ok: true } }),
      ),
    )(ctx({ hasElicitation: true }), { action: "reject", confirm: true });
    expect(result).toMatchObject({
      type: "input_required",
      requestState: "c1",
      message: "Reject sender",
    });
    expect(createConfirmation).toHaveBeenCalledOnce();
  });
});
