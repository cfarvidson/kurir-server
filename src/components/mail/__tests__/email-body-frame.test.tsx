// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
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
globalThis.ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

function getHost(container: HTMLElement): HTMLElement {
  // The component renders a single host <div> as the root.
  const host = container.firstElementChild as HTMLElement | null;
  if (!host) throw new Error("EmailBodyFrame host element not found");
  return host;
}

describe("EmailBodyFrame", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a host div (no iframe)", async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<EmailBodyFrame html="<p>Hello</p>" />));
    });
    expect(document.querySelector("iframe")).toBeNull();
    const host = getHost(container);
    expect(host.tagName).toBe("DIV");
  });

  it("attaches an open Shadow DOM to the host", async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<EmailBodyFrame html="<p>Hello</p>" />));
    });
    const host = getHost(container);
    expect(host.shadowRoot).not.toBeNull();
    expect(host.shadowRoot?.mode).toBe("open");
  });

  it("renders the sanitized HTML inside the shadow root", async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<EmailBodyFrame html="<p>Test content</p>" />));
    });
    const shadow = getHost(container).shadowRoot!;
    const content = shadow.querySelector(".content");
    expect(content).not.toBeNull();
    expect(content?.innerHTML).toContain("<p>Test content</p>");
  });

  it("wraps the content in a .scaler > .content structure", async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<EmailBodyFrame html="<p>Body</p>" />));
    });
    const shadow = getHost(container).shadowRoot!;
    expect(shadow.querySelector(".scaler")).not.toBeNull();
    expect(shadow.querySelector(".scaler > .content")).not.toBeNull();
  });

  it("includes a style block with base styles inside the shadow root", async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<EmailBodyFrame html="<p>Styled</p>" />));
    });
    const shadow = getHost(container).shadowRoot!;
    const style = shadow.querySelector("style");
    expect(style).not.toBeNull();
    const css = style?.textContent ?? "";
    expect(css).toContain("font-family");
    expect(css).toContain("font-size");
  });

  it("forces light color-scheme on the shadow host (emails rarely support dark mode)", async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<EmailBodyFrame html="<p>Hello</p>" />));
    });
    const shadow = getHost(container).shadowRoot!;
    const css = shadow.querySelector("style")?.textContent ?? "";
    expect(css).toContain(":host");
    expect(css).toContain("color-scheme: light");
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

  it("uses the bg-white host class for seamless visual integration", async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<EmailBodyFrame html="<p>Hello</p>" />));
    });
    const host = getHost(container);
    expect(host.className).toContain("bg-white");
  });

  it("updates shadow content when html prop changes", async () => {
    let result: ReturnType<typeof render>;
    let container!: HTMLElement;
    await act(async () => {
      result = render(<EmailBodyFrame html="<p>First</p>" />);
      container = result.container;
    });
    const shadow = getHost(container).shadowRoot!;
    expect(shadow.querySelector(".content")?.innerHTML).toContain("First");

    await act(async () => {
      result!.rerender(<EmailBodyFrame html="<p>Second</p>" />);
    });
    expect(shadow.querySelector(".content")?.innerHTML).toContain("Second");
  });
});
