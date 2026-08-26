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

/**
 * The agentic retrieval loop (#133): each provider's native tool-use API,
 * the executor round-trip, and the hard cap that forces an answer.
 */
describe("the tool-use loop", () => {
  const searched: string[] = [];

  const tools = () => [
    {
      name: "search_mail",
      description: "search",
      inputSchema: { type: "object" as const },
      run: async (input: Record<string, unknown>) => {
        searched.push(String(input.query ?? ""));
        return "one hit";
      },
    },
  ];

  beforeEach(() => {
    searched.length = 0;
  });

  it("Claude executes a tool_use block and hands the result back", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          content: [
            {
              type: "tool_use",
              id: "tu-1",
              name: "search_mail",
              input: { query: "invoice March" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { content: [{ type: "text", text: "final draft" }] }),
      );

    const text = await generateWithClaudeCode("sk-ant-oat01-abc", {
      ...request,
      tools: tools(),
      maxToolCalls: 6,
    });

    expect(text).toBe("final draft");
    expect(searched).toEqual(["invoice March"]);
    const second = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(second.tools[0].name).toBe("search_mail");
    expect(second.messages[2].content[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "tu-1",
      content: "one hit",
    });
  });

  it("Claude stops calling tools at the cap and is forced to answer", async () => {
    const toolUse = jsonResponse(200, {
      content: [
        { type: "tool_use", id: "tu", name: "search_mail", input: { query: "q" } },
      ],
    });
    fetchMock.mockImplementation(async () => {
      const call = fetchMock.mock.calls.length;
      return call <= 2
        ? toolUse.clone()
        : jsonResponse(200, { content: [{ type: "text", text: "answer" }] });
    });

    const text = await generateWithClaudeCode("sk-ant-oat01-abc", {
      ...request,
      tools: tools(),
      maxToolCalls: 2,
    });

    expect(text).toBe("answer");
    expect(searched).toHaveLength(2);
    const last = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body));
    expect(last.tool_choice).toEqual({ type: "none" });
  });

  it("Claude offers no tools when the request has none", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { content: [{ type: "text", text: "plain" }] }),
    );
    await generateWithClaudeCode("sk-ant-oat01-abc", request);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });

  it("Grok executes a function call and hands the result back", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "tc-1",
                    function: {
                      name: "search_mail",
                      arguments: '{"query":"invoice March"}',
                    },
                  },
                ],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { choices: [{ message: { content: "final draft" } }] }),
      );

    const text = await generateWithGrokBuild(
      JSON.stringify({ access: "acc-1", refresh: "ref-1" }),
      { ...request, tools: tools(), maxToolCalls: 6 },
      vi.fn(),
    );

    expect(text).toBe("final draft");
    expect(searched).toEqual(["invoice March"]);
    const second = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(second.tools[0].function.name).toBe("search_mail");
    expect(second.messages.at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "tc-1",
      content: "one hit",
    });
  });

  it("Grok refreshes mid-loop, persists the rotation, and carries on", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          choices: [
            {
              message: {
                tool_calls: [
                  { id: "tc-1", function: { name: "search_mail", arguments: "{}" } },
                ],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(
        jsonResponse(200, { access_token: "acc-2", refresh_token: "ref-2" }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { choices: [{ message: { content: "after refresh" } }] }),
      );
    const rotate = vi.fn(async (_next: string) => {});

    const text = await generateWithGrokBuild(
      JSON.stringify({ access: "acc-1", refresh: "ref-1" }),
      { ...request, tools: tools(), maxToolCalls: 6 },
      rotate,
    );

    expect(text).toBe("after refresh");
    expect(parseGrokSession(rotate.mock.calls[0][0])).toEqual({
      access: "acc-2",
      refresh: "ref-2",
    });
  });

  it("Grok stops calling tools at the cap and is forced to answer", async () => {
    fetchMock.mockImplementation(async () => {
      const call = fetchMock.mock.calls.length;
      return call <= 1
        ? jsonResponse(200, {
            choices: [
              {
                message: {
                  tool_calls: [
                    { id: "tc", function: { name: "search_mail", arguments: "{}" } },
                  ],
                },
              },
            ],
          })
        : jsonResponse(200, { choices: [{ message: { content: "answer" } }] });
    });

    const text = await generateWithGrokBuild(
      JSON.stringify({ access: "acc-1", refresh: "ref-1" }),
      { ...request, tools: tools(), maxToolCalls: 1 },
      vi.fn(),
    );

    expect(text).toBe("answer");
    expect(searched).toHaveLength(1);
    const last = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body));
    expect(last.tool_choice).toBe("none");
  });
});
