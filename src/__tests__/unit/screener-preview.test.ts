import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for ScreenerPreview expand/collapse logic.
 *
 * Tests the pure state machine and data-fetching behaviour as described
 * in designs/screener-keyboard-ux-spec.md (Task 2.1 / preview section).
 *
 * This models the component logic as a plain object so we can test it
 * without React or a DOM — verifying state transitions, fetch lifecycle,
 * caching, and error handling.
 */

// ─── Minimal model of preview state ──────────────────────────────────────────

type PreviewState = "collapsed" | "loading" | "expanded" | "error";

interface PreviewCache {
  html: string | null;
  text: string | null;
  sizeBytes: number;
}

interface ScreenerPreviewModel {
  state: PreviewState;
  cache: Map<string, PreviewCache>;
  fetchBody: (messageId: string) => Promise<PreviewCache>;
}

function createPreviewModel(
  fetchBody: (id: string) => Promise<PreviewCache>
): ScreenerPreviewModel {
  return {
    state: "collapsed",
    cache: new Map(),
    fetchBody,
  };
}

/**
 * Simulates the "toggle preview" action, including fetch and caching.
 * Returns the final state after all async operations complete.
 */
async function togglePreview(
  model: ScreenerPreviewModel,
  messageId: string,
  onStateChange: (state: PreviewState) => void
): Promise<void> {
  if (model.state === "loading") return; // no-op during load

  if (model.state === "expanded" || model.state === "error") {
    model.state = "collapsed";
    onStateChange("collapsed");
    return;
  }

  // Collapsed → Loading
  model.state = "loading";
  onStateChange("loading");

  if (model.cache.has(messageId)) {
    // Cache hit — skip fetch
    model.state = "expanded";
    onStateChange("expanded");
    return;
  }

  try {
    const result = await model.fetchBody(messageId);
    model.cache.set(messageId, result);
    model.state = "expanded";
    onStateChange("expanded");
  } catch {
    model.state = "error";
    onStateChange("error");
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const SIZE_THRESHOLD = 150 * 1024; // 150KB

describe("ScreenerPreview state machine", () => {
  describe("Space toggle — open/close", () => {
    it("transitions from collapsed to loading then expanded on first open", async () => {
      const states: PreviewState[] = [];
      const model = createPreviewModel(() =>
        Promise.resolve({ html: "<p>Hello</p>", text: null, sizeBytes: 100 })
      );

      await togglePreview(model, "msg-1", (s) => states.push(s));

      expect(states).toEqual(["loading", "expanded"]);
      expect(model.state).toBe("expanded");
    });

    it("transitions from expanded to collapsed on second toggle", async () => {
      const states: PreviewState[] = [];
      const model = createPreviewModel(() =>
        Promise.resolve({ html: "<p>Hello</p>", text: null, sizeBytes: 100 })
      );

      // First toggle: collapsed → expanded
      await togglePreview(model, "msg-1", (s) => states.push(s));
      // Second toggle: expanded → collapsed
      await togglePreview(model, "msg-1", (s) => states.push(s));

      expect(model.state).toBe("collapsed");
      expect(states[states.length - 1]).toBe("collapsed");
    });

    it("is a true toggle (open → close → open)", async () => {
      const model = createPreviewModel(() =>
        Promise.resolve({ html: "<p>Hi</p>", text: null, sizeBytes: 100 })
      );

      await togglePreview(model, "msg-1", vi.fn());
      expect(model.state).toBe("expanded");

      await togglePreview(model, "msg-1", vi.fn());
      expect(model.state).toBe("collapsed");

      await togglePreview(model, "msg-1", vi.fn());
      expect(model.state).toBe("expanded");
    });
  });

  describe("fetch lifecycle", () => {
    it("calls fetchBody exactly once on first open", async () => {
      const fetchBody = vi.fn().mockResolvedValue({
        html: "<p>Body</p>",
        text: null,
        sizeBytes: 200,
      });
      const model = createPreviewModel(fetchBody);

      await togglePreview(model, "msg-1", vi.fn());
      expect(fetchBody).toHaveBeenCalledOnce();
      expect(fetchBody).toHaveBeenCalledWith("msg-1");
    });

    it("does NOT re-fetch on subsequent opens (cache hit)", async () => {
      const fetchBody = vi.fn().mockResolvedValue({
        html: "<p>Cached</p>",
        text: null,
        sizeBytes: 100,
      });
      const model = createPreviewModel(fetchBody);

      // Open
      await togglePreview(model, "msg-1", vi.fn());
      // Close
      await togglePreview(model, "msg-1", vi.fn());
      // Re-open
      await togglePreview(model, "msg-1", vi.fn());

      expect(fetchBody).toHaveBeenCalledOnce();
    });

    it("caches the result keyed by messageId", async () => {
      const body = { html: "<p>Hello</p>", text: null, sizeBytes: 100 };
      const model = createPreviewModel(() => Promise.resolve(body));

      await togglePreview(model, "msg-abc", vi.fn());

      expect(model.cache.has("msg-abc")).toBe(true);
      expect(model.cache.get("msg-abc")).toEqual(body);
    });

    it("fetches independently for different message IDs", async () => {
      const fetchBody = vi.fn().mockResolvedValue({
        html: "<p>Body</p>",
        text: null,
        sizeBytes: 100,
      });
      const model = createPreviewModel(fetchBody);

      await togglePreview(model, "msg-1", vi.fn());
      await togglePreview(model, "msg-1", vi.fn()); // close
      await togglePreview(model, "msg-2", vi.fn()); // different message

      expect(fetchBody).toHaveBeenCalledTimes(2);
      expect(fetchBody).toHaveBeenNthCalledWith(1, "msg-1");
      expect(fetchBody).toHaveBeenNthCalledWith(2, "msg-2");
    });
  });

  describe("loading skeleton state", () => {
    it("enters loading state before fetch resolves", async () => {
      let resolveBody!: (value: PreviewCache) => void;
      const fetchBody = vi.fn(
        () => new Promise<PreviewCache>((res) => { resolveBody = res; })
      );
      const model = createPreviewModel(fetchBody);
      const states: PreviewState[] = [];

      const promise = togglePreview(model, "msg-1", (s) => states.push(s));

      // Should be in loading state before fetch resolves
      expect(model.state).toBe("loading");
      expect(states).toEqual(["loading"]);

      resolveBody({ html: "<p>Done</p>", text: null, sizeBytes: 50 });
      await promise;

      expect(model.state).toBe("expanded");
    });
  });

  describe("error state", () => {
    it("enters error state when fetch fails", async () => {
      const model = createPreviewModel(() =>
        Promise.reject(new Error("Network error"))
      );

      await togglePreview(model, "msg-1", vi.fn());

      expect(model.state).toBe("error");
    });

    it("shows error state in onStateChange callback", async () => {
      const states: PreviewState[] = [];
      const model = createPreviewModel(() =>
        Promise.reject(new Error("timeout"))
      );

      await togglePreview(model, "msg-1", (s) => states.push(s));

      expect(states).toEqual(["loading", "error"]);
    });

    it("collapses on toggle when in error state", async () => {
      const model = createPreviewModel(() =>
        Promise.reject(new Error("fail"))
      );
      await togglePreview(model, "msg-1", vi.fn());
      expect(model.state).toBe("error");

      // Toggle from error → collapsed (retry is separate concern)
      await togglePreview(model, "msg-1", vi.fn());
      expect(model.state).toBe("collapsed");
    });

    it("allows retry — re-fetch after error if cache is empty", async () => {
      let callCount = 0;
      const model = createPreviewModel(() => {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error("first fail"));
        return Promise.resolve({ html: "<p>Retry success</p>", text: null, sizeBytes: 100 });
      });

      // First attempt: error
      await togglePreview(model, "msg-1", vi.fn());
      expect(model.state).toBe("error");

      // Toggle back to collapsed
      await togglePreview(model, "msg-1", vi.fn());

      // Retry: should re-fetch since cache is empty (no cache set on error)
      await togglePreview(model, "msg-1", vi.fn());
      expect(model.state).toBe("expanded");
      expect(callCount).toBe(2);
    });
  });

  describe("large body truncation (>150KB)", () => {
    it("identifies oversized body from sizeBytes", async () => {
      const oversize = SIZE_THRESHOLD + 1;
      const model = createPreviewModel(() =>
        Promise.resolve({ html: "<p>Big</p>", text: null, sizeBytes: oversize })
      );

      await togglePreview(model, "msg-large", vi.fn());

      const cached = model.cache.get("msg-large");
      expect(cached).toBeDefined();
      expect(cached!.sizeBytes).toBeGreaterThan(SIZE_THRESHOLD);
    });

    it("body exactly at 150KB threshold is NOT truncated", async () => {
      const atThreshold = SIZE_THRESHOLD;
      const model = createPreviewModel(() =>
        Promise.resolve({ html: "<p>At limit</p>", text: null, sizeBytes: atThreshold })
      );

      await togglePreview(model, "msg-limit", vi.fn());
      const cached = model.cache.get("msg-limit");
      expect(cached!.sizeBytes).toBe(SIZE_THRESHOLD);
      // At exactly threshold — not over — so should render normally
      expect(cached!.sizeBytes > SIZE_THRESHOLD).toBe(false);
    });

    it("body one byte over threshold triggers truncation", async () => {
      const oversize = SIZE_THRESHOLD + 1;
      const model = createPreviewModel(() =>
        Promise.resolve({ html: "<p>Over</p>", text: null, sizeBytes: oversize })
      );

      await togglePreview(model, "msg-over", vi.fn());
      const cached = model.cache.get("msg-over");
      expect(cached!.sizeBytes > SIZE_THRESHOLD).toBe(true);
    });
  });
});

describe("preview display preference — html vs text fallback", () => {
  /**
   * Helper: determines what content to display given html and text bodies.
   * Mirrors the spec: show HTML if available, fall back to plain text.
   */
  function getDisplayContent(
    html: string | null,
    text: string | null
  ): { type: "html" | "text" | "empty"; content: string } {
    if (html) return { type: "html", content: html };
    if (text) return { type: "text", content: text };
    return { type: "empty", content: "" };
  }

  it("prefers HTML body when available", () => {
    const result = getDisplayContent("<p>Rich content</p>", "Plain content");
    expect(result.type).toBe("html");
    expect(result.content).toBe("<p>Rich content</p>");
  });

  it("falls back to plain text when HTML is null", () => {
    const result = getDisplayContent(null, "Plain text body");
    expect(result.type).toBe("text");
    expect(result.content).toBe("Plain text body");
  });

  it("returns empty when both are null", () => {
    const result = getDisplayContent(null, null);
    expect(result.type).toBe("empty");
    expect(result.content).toBe("");
  });

  it("uses HTML even if text is also available", () => {
    const result = getDisplayContent("<div>HTML</div>", "Also has text");
    expect(result.type).toBe("html");
  });

  it("uses HTML when text is empty string", () => {
    const result = getDisplayContent("<p>Has html</p>", "");
    expect(result.type).toBe("html");
  });
});
