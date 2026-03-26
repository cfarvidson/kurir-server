// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { sanitizeEmailHtml } from "../sanitize-html";

describe("sanitizeEmailHtml", () => {
  describe("dangerous tag removal", () => {
    it("removes script tags and their content", () => {
      const result = sanitizeEmailHtml(
        '<script>alert("xss")</script><p>Hello</p>',
      );
      expect(result).not.toContain("<script");
      expect(result).not.toContain("alert");
      expect(result).toContain("Hello");
    });

    it("removes style tags and their content", () => {
      const result = sanitizeEmailHtml(
        "<style>body { color: red; }</style><p>Hello</p>",
      );
      expect(result).not.toContain("<style");
      expect(result).not.toContain("color: red");
      expect(result).toContain("Hello");
    });

    it("removes noscript tags", () => {
      const result = sanitizeEmailHtml(
        "<noscript><p>No JS</p></noscript><p>Text</p>",
      );
      expect(result).not.toContain("<noscript");
      expect(result).toContain("Text");
    });

    it("removes form and input tags", () => {
      const result = sanitizeEmailHtml(
        '<form action="/steal"><input type="password" /><p>Content</p></form>',
      );
      expect(result).not.toContain("<form");
      expect(result).not.toContain("<input");
      expect(result).toContain("Content");
    });
  });

  describe("event handler removal", () => {
    it("removes onclick attributes", () => {
      const result = sanitizeEmailHtml('<p onclick="alert(1)">Click me</p>');
      expect(result).not.toContain("onclick");
      expect(result).toContain("Click me");
    });

    it("removes onerror attributes", () => {
      const result = sanitizeEmailHtml(
        '<img src="https://example.com/img.png" onerror="alert(1)" />',
      );
      expect(result).not.toContain("onerror");
    });

    it("removes onload attributes", () => {
      const result = sanitizeEmailHtml(
        '<body onload="steal()"><p>Hi</p></body>',
      );
      expect(result).not.toContain("onload");
    });

    it("removes onmouseover attributes", () => {
      const result = sanitizeEmailHtml(
        '<a href="https://safe.com" onmouseover="track()">Link</a>',
      );
      expect(result).not.toContain("onmouseover");
      expect(result).toContain("Link");
    });

    it("removes all on* event handlers", () => {
      const handlers = [
        "onclick",
        "onerror",
        "onload",
        "onmouseover",
        "onmouseout",
        "onfocus",
        "onblur",
        "onchange",
        "onsubmit",
        "onkeydown",
        "onkeyup",
      ];
      for (const handler of handlers) {
        const result = sanitizeEmailHtml(
          `<div ${handler}="evil()">Content</div>`,
        );
        expect(result).not.toContain(handler);
      }
    });
  });

  describe("safe inline styles", () => {
    it("preserves inline style attributes", () => {
      const result = sanitizeEmailHtml(
        '<p style="color: blue; font-size: 14px;">Styled</p>',
      );
      expect(result).toContain('style="color: blue');
      expect(result).toContain("Styled");
    });

    it("preserves inline styles on spans and divs", () => {
      const result = sanitizeEmailHtml(
        '<div style="margin: 0;"><span style="font-weight: bold;">Bold</span></div>',
      );
      expect(result).toContain("margin");
      expect(result).toContain("font-weight");
    });
  });

  describe("safe HTML structure preservation", () => {
    it("preserves basic structural elements", () => {
      const html = `
        <div>
          <h1>Title</h1>
          <p>Paragraph with <strong>bold</strong> and <em>italic</em></p>
          <ul><li>Item 1</li><li>Item 2</li></ul>
        </div>
      `;
      const result = sanitizeEmailHtml(html);
      expect(result).toContain("<h1>");
      expect(result).toContain("<p>");
      expect(result).toContain("<strong>");
      expect(result).toContain("<em>");
      expect(result).toContain("<ul>");
      expect(result).toContain("<li>");
    });

    it("preserves table elements", () => {
      const html = `
        <table>
          <tr><th>Header</th></tr>
          <tr><td>Cell</td></tr>
        </table>
      `;
      const result = sanitizeEmailHtml(html);
      expect(result).toContain("<table");
      expect(result).toContain("<tr");
      expect(result).toContain("<th");
      expect(result).toContain("<td");
    });

    it("preserves pre and code elements", () => {
      const result = sanitizeEmailHtml("<pre><code>const x = 1;</code></pre>");
      expect(result).toContain("<pre>");
      expect(result).toContain("<code>");
    });

    it("preserves blockquote elements", () => {
      const result = sanitizeEmailHtml(
        "<blockquote><p>Quoted text</p></blockquote>",
      );
      expect(result).toContain("<blockquote>");
      expect(result).toContain("Quoted text");
    });
  });

  describe("link enforcement", () => {
    it('enforces target="_blank" on links', () => {
      const result = sanitizeEmailHtml(
        '<a href="https://example.com">Link</a>',
      );
      expect(result).toContain('target="_blank"');
    });

    it('enforces rel="noopener noreferrer" on links', () => {
      const result = sanitizeEmailHtml(
        '<a href="https://example.com">Link</a>',
      );
      expect(result).toContain('rel="noopener noreferrer"');
    });

    it("overwrites existing target on links", () => {
      const result = sanitizeEmailHtml(
        '<a href="https://example.com" target="_self">Link</a>',
      );
      expect(result).toContain('target="_blank"');
      expect(result).not.toContain('target="_self"');
    });

    it("preserves href attribute on links", () => {
      const result = sanitizeEmailHtml(
        '<a href="https://example.com">Link</a>',
      );
      expect(result).toContain('href="https://example.com"');
    });
  });

  describe("image src filtering", () => {
    it("allows https image sources (proxied)", () => {
      const result = sanitizeEmailHtml(
        '<img src="https://example.com/image.png" />',
      );
      expect(result).toContain("/api/proxy/image?url=");
      expect(result).toContain(
        encodeURIComponent("https://example.com/image.png"),
      );
    });

    it("allows http image sources (proxied)", () => {
      const result = sanitizeEmailHtml(
        '<img src="http://example.com/image.png" />',
      );
      expect(result).toContain("/api/proxy/image?url=");
      expect(result).toContain(
        encodeURIComponent("http://example.com/image.png"),
      );
    });

    it("allows cid: image sources (inline attachments)", () => {
      const result = sanitizeEmailHtml(
        '<img src="cid:image001@example.com" />',
      );
      expect(result).toContain('src="cid:image001@example.com"');
    });

    it("blocks data: URI image sources", () => {
      const result = sanitizeEmailHtml(
        '<img src="data:image/png;base64,iVBORw0KGgo=" alt="test" />',
      );
      expect(result).not.toContain("data:image");
      // The img tag may still be present but without src
      expect(result).not.toContain('src="data:');
    });

    it("blocks javascript: image sources", () => {
      const result = sanitizeEmailHtml('<img src="javascript:alert(1)" />');
      expect(result).not.toContain("javascript:");
    });

    it("strips src for unknown protocol images", () => {
      const result = sanitizeEmailHtml(
        '<img src="blob:https://example.com/abc" />',
      );
      expect(result).not.toContain("blob:");
    });
  });

  describe("edge cases", () => {
    it("returns empty string for empty input", () => {
      const result = sanitizeEmailHtml("");
      expect(result).toBe("");
    });

    it("handles plain text input (no HTML)", () => {
      const result = sanitizeEmailHtml("Just plain text");
      expect(result).toContain("Just plain text");
    });

    it("handles deeply nested HTML", () => {
      const html = "<div><div><div><p>Deep</p></div></div></div>";
      const result = sanitizeEmailHtml(html);
      expect(result).toContain("Deep");
    });

    it("handles HTML entities correctly", () => {
      const result = sanitizeEmailHtml("<p>Hello &amp; World &lt;3</p>");
      expect(result).toContain("Hello");
      expect(result).toContain("World");
    });

    it("handles multiple script injection attempts", () => {
      const html = `
        <script>alert(1)</script>
        <p onclick="alert(2)">Text</p>
        <img src="x" onerror="alert(3)" />
        <style>* { display: none }</style>
      `;
      const result = sanitizeEmailHtml(html);
      expect(result).not.toContain("alert(1)");
      expect(result).not.toContain("onclick");
      expect(result).not.toContain("onerror");
      expect(result).not.toContain("<style");
    });
  });

  describe("css url() stripping in inline styles", () => {
    it("strips background-image: url(...) from inline styles", () => {
      const result = sanitizeEmailHtml(
        '<p style="background-image: url(https://tracker.evil.com/pixel.gif);">Text</p>',
      );
      expect(result).not.toContain("url(");
      expect(result).toContain("Text");
    });

    it("strips list-style-image: url(...) from inline styles", () => {
      const result = sanitizeEmailHtml(
        '<ul><li style="list-style-image: url(https://tracker.example.com/img.png)">Item</li></ul>',
      );
      expect(result).not.toContain("url(");
      expect(result).toContain("Item");
    });

    it("strips content: url(...) from inline styles", () => {
      const result = sanitizeEmailHtml(
        '<span style="content: url(https://example.com/icon.png)">text</span>',
      );
      expect(result).not.toContain("url(");
    });

    it("strips cursor: url(...) from inline styles", () => {
      const result = sanitizeEmailHtml(
        '<div style="cursor: url(https://example.com/cursor.cur), auto;">Content</div>',
      );
      expect(result).not.toContain("url(");
      expect(result).toContain("Content");
    });

    it("preserves non-url() style properties alongside stripped url() ones", () => {
      const result = sanitizeEmailHtml(
        '<p style="color: red; background-image: url(https://tracker.com/px); font-size: 14px;">Text</p>',
      );
      expect(result).not.toContain("url(");
      expect(result).toContain("color: red");
      expect(result).toContain("font-size: 14px");
      expect(result).toContain("Text");
    });

    it("preserves styles with no url() at all", () => {
      const result = sanitizeEmailHtml(
        '<p style="color: blue; font-weight: bold; margin: 0 auto;">Content</p>',
      );
      expect(result).toContain("color: blue");
      expect(result).toContain("font-weight: bold");
      expect(result).toContain("margin: 0 auto");
    });

    it("strips url() regardless of quoting style in CSS", () => {
      const withDoubleQuotes = sanitizeEmailHtml(
        `<p style='background-image: url("https://tracker.com/img.gif");'>Text</p>`,
      );
      const withSingleQuotes = sanitizeEmailHtml(
        `<p style="background-image: url('https://tracker.com/img.gif');">Text</p>`,
      );
      expect(withDoubleQuotes).not.toContain("url(");
      expect(withSingleQuotes).not.toContain("url(");
    });

    it("strips url() with data: URI", () => {
      const result = sanitizeEmailHtml(
        '<div style="background: url(data:image/gif;base64,R0lGOD=)">Content</div>',
      );
      expect(result).not.toContain("url(");
      expect(result).toContain("Content");
    });
  });

  describe("collapseQuotes option", () => {
    it("preserves blockquotes by default", () => {
      const result = sanitizeEmailHtml(
        "<blockquote><p>Quoted text</p></blockquote>",
      );
      expect(result).toContain("<blockquote>");
      expect(result).toContain("Quoted text");
    });

    it("removes blockquotes when collapseQuotes is true", () => {
      const result = sanitizeEmailHtml(
        "<p>Reply text</p><blockquote><p>Original message</p></blockquote>",
        { collapseQuotes: true },
      );
      expect(result).not.toContain("<blockquote>");
      expect(result).not.toContain("Original message");
      expect(result).toContain("Reply text");
    });

    it("removes gmail_quote elements when collapseQuotes is true", () => {
      const result = sanitizeEmailHtml(
        '<p>New text</p><div class="gmail_quote">Quoted content</div>',
        { collapseQuotes: true },
      );
      expect(result).not.toContain("gmail_quote");
      expect(result).not.toContain("Quoted content");
      expect(result).toContain("New text");
    });

    it("removes protonmail_quote elements when collapseQuotes is true", () => {
      const result = sanitizeEmailHtml(
        '<p>Reply</p><div class="protonmail_quote">Quoted</div>',
        { collapseQuotes: true },
      );
      expect(result).not.toContain("Quoted");
      expect(result).toContain("Reply");
    });
  });
});
