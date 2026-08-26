/**
 * The two subscription inference adapters. Fetch is stubbed — nothing here
 * ever leaves the process. Claude uses the OAuth bearer path (never
 * x-api-key); Grok refreshes an expired session, persists the rotation, and
 * retries exactly once.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CLAUDE_CODE_MODEL,
  generateWithClaudeCode,
} from "@/lib/draft-generation/providers/claude-code";
import { generateWithGrokBuild } from "@/lib/draft-generation/providers/grok-build";
import { parseGrokSession } from "@/lib/draft-generation/grok-session";

const request = { system: "rules", user: "the mail" };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generateWithClaudeCode", () => {
  it("calls Anthropic over OAuth bearer with the pinned model and never x-api-key", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { content: [{ type: "text", text: "draft text" }] }),
    );

    const text = await generateWithClaudeCode("sk-ant-oat01-abc", request);
    expect(text).toBe("draft text");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-ant-oat01-abc");
    expect(headers["anthropic-beta"]).toContain("oauth");
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain(
      "x-api-key",
    );
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe(CLAUDE_CODE_MODEL);
    expect(body.messages[0].content).toBe("the mail");
  });

  it("maps 401 to a dead-token error", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: "unauthorized" }));
    await expect(
      generateWithClaudeCode("sk-ant-oat01-abc", request),
    ).rejects.toMatchObject({ code: "TOKEN_DEAD" });
  });

  it("maps 429 to a usage-limited error", async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { error: "rate" }));
    await expect(
      generateWithClaudeCode("sk-ant-oat01-abc", request),
    ).rejects.toMatchObject({ code: "USAGE_LIMITED" });
  });

  it("maps a 404 on the pinned model to MODEL_UNAVAILABLE, never a silent switch", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: "no model" }));
    await expect(
      generateWithClaudeCode("sk-ant-oat01-abc", request),
    ).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
  });
});

describe("generateWithGrokBuild", () => {
  const session = JSON.stringify({ access: "acc-1", refresh: "ref-1" });

  it("returns the draft on a first-try success", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { choices: [{ message: { content: "grok draft" } }] }),
    );
    const rotate = vi.fn();
    const text = await generateWithGrokBuild(session, request, rotate);
    expect(text).toBe("grok draft");
    expect(rotate).not.toHaveBeenCalled();
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<
      string,
      string
    >;
    expect(headers.Authorization).toBe("Bearer acc-1");
  });

  it("on 401 refreshes, persists the rotated session, and retries once", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(
        jsonResponse(200, { access_token: "acc-2", refresh_token: "ref-2" }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { choices: [{ message: { content: "after refresh" } }] }),
      );
    const rotate = vi.fn(async (_next: string) => {});

    const text = await generateWithGrokBuild(session, request, rotate);
    expect(text).toBe("after refresh");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(parseGrokSession(rotate.mock.calls[0][0])).toEqual({
      access: "acc-2",
      refresh: "ref-2",
    });
    const retryHeaders = fetchMock.mock.calls[2][1]?.headers as Record<
      string,
      string
    >;
    expect(retryHeaders.Authorization).toBe("Bearer acc-2");
  });

  it("a failed refresh clears the access token and asks for a fresh session", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(400, { error: "bad refresh" }));
    const rotate = vi.fn(async (_next: string) => {});

    await expect(
      generateWithGrokBuild(session, request, rotate),
    ).rejects.toMatchObject({ code: "TOKEN_DEAD" });
    expect(parseGrokSession(rotate.mock.calls[0][0])).toEqual({
      access: "",
      refresh: "ref-1",
    });
  });

  it("an empty stored access token goes straight to refresh", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { access_token: "acc-3", refresh_token: "ref-3" }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { choices: [{ message: { content: "ok" } }] }),
      );
    const rotate = vi.fn(async (_next: string) => {});
    const cleared = JSON.stringify({ access: "", refresh: "ref-1" });

    const text = await generateWithGrokBuild(cleared, request, rotate);
    expect(text).toBe("ok");
    expect(String(fetchMock.mock.calls[0][0])).toContain("token");
  });

  it("maps 429 to a usage-limited error", async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, {}));
    await expect(
      generateWithGrokBuild(session, request, vi.fn()),
    ).rejects.toMatchObject({ code: "USAGE_LIMITED" });
  });
});
