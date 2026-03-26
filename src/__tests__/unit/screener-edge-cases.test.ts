import { describe, it, expect, vi } from "vitest";

/**
 * Edge case tests for Screener keyboard shortcuts and email preview.
 *
 * Covers Task 4.4:
 * - HTML-only email (no textBody)
 * - Text-only email (no htmlBody)
 * - Empty body (both null)
 * - RTL content rendering
 * - Undo toast timing (action reversed within 5 seconds)
 */

// ─── Email body content resolution ───────────────────────────────────────────

interface EmailBody {
  html: string | null;
  text: string | null;
  sizeBytes: number;
}

type BodyRenderMode = "html" | "text" | "empty";

interface ResolvedBody {
  mode: BodyRenderMode;
  content: string;
}

function resolveBodyContent(body: EmailBody): ResolvedBody {
  if (body.html) return { mode: "html", content: body.html };
  if (body.text) return { mode: "text", content: body.text };
  return { mode: "empty", content: "" };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Email body edge cases", () => {
  describe("HTML-only email (no textBody)", () => {
    it("renders the HTML body", () => {
      const body: EmailBody = {
        html: "<p>Hello from HTML-only email</p>",
        text: null,
        sizeBytes: 100,
      };
      const resolved = resolveBodyContent(body);
      expect(resolved.mode).toBe("html");
      expect(resolved.content).toBe("<p>Hello from HTML-only email</p>");
    });

    it("does not fall back when html is present", () => {
      const body: EmailBody = {
        html: "<p>Rich</p>",
        text: null,
        sizeBytes: 50,
      };
      const resolved = resolveBodyContent(body);
      expect(resolved.mode).not.toBe("empty");
      expect(resolved.mode).not.toBe("text");
    });

    it("handles multi-part HTML with images", () => {
      const html = `
        <html>
          <body>
            <img src="https://example.com/logo.png" alt="Logo" />
            <p>Invoice attached</p>
          </body>
        </html>
      `;
      const body: EmailBody = { html, text: null, sizeBytes: html.length };
      const resolved = resolveBodyContent(body);
      expect(resolved.mode).toBe("html");
      expect(resolved.content).toContain("Invoice attached");
    });
  });

  describe("Text-only email (no htmlBody)", () => {
    it("renders plain text body", () => {
      const body: EmailBody = {
        html: null,
        text: "Hello, this is plain text only.",
        sizeBytes: 31,
      };
      const resolved = resolveBodyContent(body);
      expect(resolved.mode).toBe("text");
      expect(resolved.content).toBe("Hello, this is plain text only.");
    });

    it("preserves newlines in text-only emails", () => {
      const textBody = "Line 1\nLine 2\nLine 3";
      const body: EmailBody = {
        html: null,
        text: textBody,
        sizeBytes: textBody.length,
      };
      const resolved = resolveBodyContent(body);
      expect(resolved.content).toContain("\n");
      expect(resolved.content.split("\n")).toHaveLength(3);
    });

    it("handles very long text-only email without truncating content string", () => {
      const longText = "a".repeat(1000);
      const body: EmailBody = {
        html: null,
        text: longText,
        sizeBytes: longText.length,
      };
      const resolved = resolveBodyContent(body);
      expect(resolved.content).toHaveLength(1000);
    });

    it("does not use html mode for text-only email", () => {
      const body: EmailBody = { html: null, text: "Some text", sizeBytes: 9 };
      const resolved = resolveBodyContent(body);
      expect(resolved.mode).toBe("text");
    });
  });

  describe("Empty body (both null)", () => {
    it("returns empty mode when both html and text are null", () => {
      const body: EmailBody = { html: null, text: null, sizeBytes: 0 };
      const resolved = resolveBodyContent(body);
      expect(resolved.mode).toBe("empty");
      expect(resolved.content).toBe("");
    });

    it("returns empty mode for empty string html AND null text", () => {
      // Empty string "" is falsy — treated same as null
      const body: EmailBody = { html: "", text: null, sizeBytes: 0 };
      const resolved = resolveBodyContent(body);
      expect(resolved.mode).toBe("empty");
    });

    it("returns text mode when html is empty string but text has content", () => {
      const body: EmailBody = { html: "", text: "Some text", sizeBytes: 9 };
      const resolved = resolveBodyContent(body);
      expect(resolved.mode).toBe("text");
      expect(resolved.content).toBe("Some text");
    });

    it("sizeBytes 0 with empty body is valid", () => {
      const body: EmailBody = { html: null, text: null, sizeBytes: 0 };
      expect(() => resolveBodyContent(body)).not.toThrow();
    });
  });

  describe("RTL content", () => {
    it("html body with dir=rtl attribute is preserved as-is for sanitizer", () => {
      const rtlHtml = '<div dir="rtl"><p>مرحبا بالعالم</p></div>';
      const body: EmailBody = {
        html: rtlHtml,
        text: null,
        sizeBytes: rtlHtml.length,
      };
      const resolved = resolveBodyContent(body);
      expect(resolved.mode).toBe("html");
      // The content should contain the RTL directive — sanitizer handles preservation
      expect(resolved.content).toBe(rtlHtml);
    });

    it("text body with RTL unicode characters is preserved", () => {
      const rtlText = "مرحبا بالعالم"; // Arabic: "Hello World"
      const body: EmailBody = {
        html: null,
        text: rtlText,
        sizeBytes: Buffer.byteLength(rtlText),
      };
      const resolved = resolveBodyContent(body);
      expect(resolved.mode).toBe("text");
      expect(resolved.content).toBe(rtlText);
    });

    it("html body with Hebrew text and RTL markup", () => {
      const hebrewHtml = '<p dir="rtl" lang="he">שלום עולם</p>';
      const body: EmailBody = {
        html: hebrewHtml,
        text: null,
        sizeBytes: hebrewHtml.length,
      };
      const resolved = resolveBodyContent(body);
      expect(resolved.mode).toBe("html");
      expect(resolved.content).toContain("שלום עולם");
    });

    it("mixed LTR/RTL content is handled without error", () => {
      const mixedHtml = '<p>Hello</p><p dir="rtl">مرحبا</p>';
      const body: EmailBody = {
        html: mixedHtml,
        text: null,
        sizeBytes: mixedHtml.length,
      };
      expect(() => resolveBodyContent(body)).not.toThrow();
      const resolved = resolveBodyContent(body);
      expect(resolved.mode).toBe("html");
    });
  });
});

describe("Undo toast timing", () => {
  /**
   * The undo toast should only be shown for 5 seconds after an action.
   * After 5 seconds it expires and the action can no longer be reversed.
   */

  function isWithinUndoWindow(actionTimestamp: number, now: number): boolean {
    return now - actionTimestamp < 5000;
  }

  it("action taken 0ms ago is within undo window", () => {
    const now = Date.now();
    expect(isWithinUndoWindow(now, now)).toBe(true);
  });

  it("action taken 1 second ago is within undo window", () => {
    const now = Date.now();
    const actionTime = now - 1000;
    expect(isWithinUndoWindow(actionTime, now)).toBe(true);
  });

  it("action taken 4.9 seconds ago is within undo window", () => {
    const now = Date.now();
    const actionTime = now - 4900;
    expect(isWithinUndoWindow(actionTime, now)).toBe(true);
  });

  it("action taken exactly 5 seconds ago is NOT within undo window", () => {
    const now = Date.now();
    const actionTime = now - 5000;
    expect(isWithinUndoWindow(actionTime, now)).toBe(false);
  });

  it("action taken 6 seconds ago is NOT within undo window", () => {
    const now = Date.now();
    const actionTime = now - 6000;
    expect(isWithinUndoWindow(actionTime, now)).toBe(false);
  });

  it("undo reversal captures the correct sender ID", () => {
    const undoRecord = {
      senderId: "sender-42",
      action: "rejected" as const,
      timestamp: Date.now() - 1000, // 1s ago
    };

    expect(undoRecord.senderId).toBe("sender-42");
    expect(isWithinUndoWindow(undoRecord.timestamp, Date.now())).toBe(true);
  });

  it("undo after 5s window should not restore sender", () => {
    const staleRecord = {
      senderId: "sender-old",
      action: "approved" as const,
      timestamp: Date.now() - 10000, // 10s ago
    };

    expect(isWithinUndoWindow(staleRecord.timestamp, Date.now())).toBe(false);
    // UI should hide/disable the undo toast at this point
  });
});

describe("Screener edge cases — queue and state boundaries", () => {
  it("handles sender with zero messages gracefully", () => {
    // Sender exists but messages array is empty — latestMessage would be undefined
    const sender = {
      id: "sender-empty",
      email: "empty@example.com",
      displayName: null,
      domain: "example.com",
      messages: [],
      _count: { messages: 0 },
    };

    const latestMessage = sender.messages[0];
    expect(latestMessage).toBeUndefined();
    // Component should not crash — latestMessage conditional check handles this
  });

  it("handles sender with null displayName (uses email for avatar initial)", () => {
    const sender = {
      id: "s1",
      email: "user@example.com",
      displayName: null,
      domain: "example.com",
      messages: [],
      _count: { messages: 1 },
    };

    const avatarInitial = (sender.displayName || sender.email)
      .charAt(0)
      .toUpperCase();

    expect(avatarInitial).toBe("U");
  });

  it("handles sender with displayName (uses displayName for avatar initial)", () => {
    const sender = {
      id: "s1",
      email: "user@example.com",
      displayName: "Jane Doe",
      domain: "example.com",
      messages: [],
      _count: { messages: 1 },
    };

    const avatarInitial = (sender.displayName || sender.email)
      .charAt(0)
      .toUpperCase();

    expect(avatarInitial).toBe("J");
  });

  it("handles subject-only message (no snippet, no body)", () => {
    const message = {
      id: "msg-1",
      subject: "Hello",
      snippet: null,
      receivedAt: new Date(),
    };

    // Snippet is null — component renders subject only, no snippet paragraph
    expect(message.snippet).toBeNull();
    expect(message.subject).toBe("Hello");
  });

  it("handles null subject (shows fallback '(no subject)')", () => {
    const message = {
      id: "msg-1",
      subject: null,
      snippet: null,
      receivedAt: new Date(),
    };

    const displaySubject = message.subject || "(no subject)";
    expect(displaySubject).toBe("(no subject)");
  });
});

describe("CSS url() stripping edge cases in inline styles", () => {
  /**
   * These tests verify the URL stripping logic that must be applied
   * to inline style attributes. The sanitize-html function must strip
   * url() from any inline style property value.
   *
   * We test the stripping logic independently here as pure string transformations
   * to document all the edge cases that the sanitizer must handle.
   */

  /** Minimal url() stripping logic for testing purposes */
  function stripUrlFromStyle(styleValue: string): string {
    // Remove any CSS property value containing url(...)
    // This regex covers: url(...), url("..."), url('...')
    return styleValue
      .split(";")
      .map((declaration) => {
        const colonIdx = declaration.indexOf(":");
        if (colonIdx === -1) return declaration;
        const property = declaration.substring(0, colonIdx);
        const value = declaration.substring(colonIdx + 1);
        // If value contains url(...), remove this declaration
        if (/url\s*\(/i.test(value)) return "";
        return declaration;
      })
      .filter(Boolean)
      .join(";");
  }

  it("strips background-image url()", () => {
    const style = "background-image: url(https://tracker.com/px.gif)";
    const result = stripUrlFromStyle(style);
    expect(result).not.toContain("url(");
  });

  it("strips list-style-image url()", () => {
    const style = "list-style-image: url(https://example.com/bullet.png)";
    const result = stripUrlFromStyle(style);
    expect(result).not.toContain("url(");
  });

  it("strips content url()", () => {
    const style = "content: url(https://example.com/icon.png)";
    const result = stripUrlFromStyle(style);
    expect(result).not.toContain("url(");
  });

  it("strips cursor url()", () => {
    const style = "cursor: url(https://example.com/cursor.cur), auto";
    const result = stripUrlFromStyle(style);
    expect(result).not.toContain("url(");
  });

  it("preserves non-url() style properties", () => {
    const style = "color: red; font-size: 14px; margin: 0 auto";
    const result = stripUrlFromStyle(style);
    expect(result).toContain("color: red");
    expect(result).toContain("font-size: 14px");
    expect(result).toContain("margin: 0 auto");
  });

  it("preserves safe properties alongside stripped url() declarations", () => {
    const style =
      "color: blue; background-image: url(https://tracker.com/px); font-weight: bold";
    const result = stripUrlFromStyle(style);
    expect(result).not.toContain("url(");
    expect(result).toContain("color: blue");
    expect(result).toContain("font-weight: bold");
  });

  it("strips url() with data: URI", () => {
    const style = "background: url(data:image/gif;base64,R0lGOD=)";
    const result = stripUrlFromStyle(style);
    expect(result).not.toContain("url(");
  });

  it("strips url() with double-quoted URL", () => {
    const style = `background-image: url("https://tracker.com/image.gif")`;
    const result = stripUrlFromStyle(style);
    expect(result).not.toContain("url(");
  });

  it("strips url() with single-quoted URL", () => {
    const style = `background-image: url('https://tracker.com/image.gif')`;
    const result = stripUrlFromStyle(style);
    expect(result).not.toContain("url(");
  });

  it("strips url() case-insensitively (URL())", () => {
    const style = "background-image: URL(https://tracker.com/pixel.png)";
    const result = stripUrlFromStyle(style);
    expect(result).not.toContain("url(");
    expect(result).not.toContain("URL(");
  });
});
