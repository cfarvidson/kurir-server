// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { EmailBodyFrame } from "../email-body-frame";
import * as sanitizeModule from "@/lib/mail/sanitize-html";

// Mock sanitizeEmailHtml — we test it separately; here we focus on the component.
vi.mock("@/lib/mail/sanitize-html", () => ({
  sanitizeEmailHtml: vi.fn((html: string) => html),
}));

// ResizeObserver is not implemented in jsdom — provide a no-op stub.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

describe("EmailBodyFrame", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders an iframe element", async () => {
    await act(async () => {
      render(<EmailBodyFrame html="<p>Hello</p>" />);
    });
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
  });

  it("sets sandbox attribute to allow-same-origin only", async () => {
    await act(async () => {
      render(<EmailBodyFrame html="<p>Hello</p>" />);
    });
    const iframe = document.querySelector("iframe");
    expect(iframe?.getAttribute("sandbox")).toBe("allow-same-origin");
  });

  it("does NOT include allow-scripts in sandbox (blocks JS execution)", async () => {
    await act(async () => {
      render(<EmailBodyFrame html="<p>Hello</p>" />);
    });
    const iframe = document.querySelector("iframe");
    const sandbox = iframe?.getAttribute("sandbox") ?? "";
    expect(sandbox).not.toContain("allow-scripts");
  });

  it("does NOT include allow-forms in sandbox (blocks form submission)", async () => {
    await act(async () => {
      render(<EmailBodyFrame html="<p>Hello</p>" />);
    });
    const iframe = document.querySelector("iframe");
    const sandbox = iframe?.getAttribute("sandbox") ?? "";
    expect(sandbox).not.toContain("allow-forms");
  });

  it("sets srcdoc attribute with provided HTML", async () => {
    await act(async () => {
      render(<EmailBodyFrame html="<p>Test content</p>" />);
    });
    const iframe = document.querySelector("iframe");
    const srcdoc = iframe?.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("<p>Test content</p>");
  });

  it("wraps HTML in a complete document structure", async () => {
    await act(async () => {
      render(<EmailBodyFrame html="<p>Body</p>" />);
    });
    const iframe = document.querySelector("iframe");
    const srcdoc = iframe?.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("<!DOCTYPE html>");
    expect(srcdoc).toContain("<html");
    expect(srcdoc).toContain("<head>");
    expect(srcdoc).toContain("<body>");
  });

  it("includes a base tag with target=_blank for link safety", async () => {
    await act(async () => {
      render(
        <EmailBodyFrame html="<a href='https://example.com'>Link</a>" />,
      );
    });
    const iframe = document.querySelector("iframe");
    const srcdoc = iframe?.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain('<base target="_blank">');
  });

  it("includes a style block with base styles", async () => {
    await act(async () => {
      render(<EmailBodyFrame html="<p>Styled</p>" />);
    });
    const iframe = document.querySelector("iframe");
    const srcdoc = iframe?.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("<style>");
    // The style block should contain basic resets
    expect(srcdoc).toContain("font-family");
    expect(srcdoc).toContain("font-size");
  });

  it("includes dark mode media query in styles", async () => {
    await act(async () => {
      render(<EmailBodyFrame html="<p>Hello</p>" />);
    });
    const iframe = document.querySelector("iframe");
    const srcdoc = iframe?.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("prefers-color-scheme: dark");
  });

  it("sets referrerPolicy to no-referrer", async () => {
    await act(async () => {
      render(<EmailBodyFrame html="<p>Hello</p>" />);
    });
    const iframe = document.querySelector("iframe");
    expect(iframe?.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("sets an accessible title on the iframe", async () => {
    await act(async () => {
      render(<EmailBodyFrame html="<p>Hello</p>" />);
    });
    const iframe = screen.getByTitle("Email content");
    expect(iframe).toBeTruthy();
  });

  it("sets aria-label on the iframe for accessibility", async () => {
    await act(async () => {
      render(<EmailBodyFrame html="<p>Hello</p>" />);
    });
    const iframe = screen.getByLabelText("Email body");
    expect(iframe).toBeTruthy();
  });

  it("does not set a name attribute (prevents targeting by other frames)", async () => {
    await act(async () => {
      render(<EmailBodyFrame html="<p>Hello</p>" />);
    });
    const iframe = document.querySelector("iframe");
    // name should be absent or empty — not set by the component
    const name = iframe?.getAttribute("name");
    expect(name == null || name === "").toBe(true);
  });

  it("passes html through sanitizeEmailHtml", async () => {
    await act(async () => {
      render(<EmailBodyFrame html="<p>Content</p>" />);
    });
    expect(vi.mocked(sanitizeModule.sanitizeEmailHtml)).toHaveBeenCalledWith(
      "<p>Content</p>",
      expect.any(Object),
    );
  });

  it("passes collapseQuotes option to sanitizeEmailHtml when set", async () => {
    await act(async () => {
      render(
        <EmailBodyFrame
          html="<blockquote>Quoted</blockquote>"
          collapseQuotes
        />,
      );
    });
    expect(vi.mocked(sanitizeModule.sanitizeEmailHtml)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ collapseQuotes: true }),
    );
  });

  it("has no src attribute (content is via srcdoc, not a URL)", async () => {
    await act(async () => {
      render(<EmailBodyFrame html="<p>Hello</p>" />);
    });
    const iframe = document.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toBeNull();
  });

  it("has no border (seamless visual integration)", async () => {
    await act(async () => {
      render(<EmailBodyFrame html="<p>Hello</p>" />);
    });
    const iframe = document.querySelector("iframe");
    const className = iframe?.className ?? "";
    // border-0 class should be present
    expect(className).toContain("border-0");
  });

  it("renders as a block element taking full width", async () => {
    await act(async () => {
      render(<EmailBodyFrame html="<p>Hello</p>" />);
    });
    const iframe = document.querySelector("iframe");
    const className = iframe?.className ?? "";
    // Width is set via inline style (100%), not Tailwind class
    expect(className).toContain("block");
    const style = iframe?.getAttribute("style") ?? "";
    expect(style).toContain("width");
  });

  it("updates srcdoc when html prop changes", async () => {
    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<EmailBodyFrame html="<p>First</p>" />);
    });
    const iframe = document.querySelector("iframe");
    const firstSrcdoc = iframe?.getAttribute("srcdoc") ?? "";
    expect(firstSrcdoc).toContain("First");

    await act(async () => {
      result!.rerender(<EmailBodyFrame html="<p>Second</p>" />);
    });
    const updatedSrcdoc = iframe?.getAttribute("srcdoc") ?? "";
    expect(updatedSrcdoc).toContain("Second");
  });
});
