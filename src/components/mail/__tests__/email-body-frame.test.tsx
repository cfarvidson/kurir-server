// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

  it("renders an iframe element", () => {
    render(<EmailBodyFrame html="<p>Hello</p>" />);
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
  });

  it("sets sandbox attribute to allow-same-origin only", () => {
    render(<EmailBodyFrame html="<p>Hello</p>" />);
    const iframe = document.querySelector("iframe");
    expect(iframe?.getAttribute("sandbox")).toBe("allow-same-origin");
  });

  it("does NOT include allow-scripts in sandbox (blocks JS execution)", () => {
    render(<EmailBodyFrame html="<p>Hello</p>" />);
    const iframe = document.querySelector("iframe");
    const sandbox = iframe?.getAttribute("sandbox") ?? "";
    expect(sandbox).not.toContain("allow-scripts");
  });

  it("does NOT include allow-forms in sandbox (blocks form submission)", () => {
    render(<EmailBodyFrame html="<p>Hello</p>" />);
    const iframe = document.querySelector("iframe");
    const sandbox = iframe?.getAttribute("sandbox") ?? "";
    expect(sandbox).not.toContain("allow-forms");
  });

  it("sets srcdoc attribute with provided HTML", () => {
    render(<EmailBodyFrame html="<p>Test content</p>" />);
    const iframe = document.querySelector("iframe");
    const srcdoc = iframe?.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("<p>Test content</p>");
  });

  it("wraps HTML in a complete document structure", () => {
    render(<EmailBodyFrame html="<p>Body</p>" />);
    const iframe = document.querySelector("iframe");
    const srcdoc = iframe?.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("<!DOCTYPE html>");
    expect(srcdoc).toContain("<html");
    expect(srcdoc).toContain("<head>");
    expect(srcdoc).toContain("<body>");
  });

  it("includes a base tag with target=_blank for link safety", () => {
    render(<EmailBodyFrame html="<a href='https://example.com'>Link</a>" />);
    const iframe = document.querySelector("iframe");
    const srcdoc = iframe?.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain('<base target="_blank">');
  });

  it("includes a style block with base styles", () => {
    render(<EmailBodyFrame html="<p>Styled</p>" />);
    const iframe = document.querySelector("iframe");
    const srcdoc = iframe?.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("<style>");
    // The style block should contain basic resets
    expect(srcdoc).toContain("font-family");
    expect(srcdoc).toContain("font-size");
  });

  it("includes dark mode media query in styles", () => {
    render(<EmailBodyFrame html="<p>Hello</p>" />);
    const iframe = document.querySelector("iframe");
    const srcdoc = iframe?.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("prefers-color-scheme: dark");
  });

  it("sets referrerPolicy to no-referrer", () => {
    render(<EmailBodyFrame html="<p>Hello</p>" />);
    const iframe = document.querySelector("iframe");
    expect(iframe?.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("sets an accessible title on the iframe", () => {
    render(<EmailBodyFrame html="<p>Hello</p>" />);
    const iframe = screen.getByTitle("Email content");
    expect(iframe).toBeTruthy();
  });

  it("sets aria-label on the iframe for accessibility", () => {
    render(<EmailBodyFrame html="<p>Hello</p>" />);
    const iframe = screen.getByLabelText("Email body");
    expect(iframe).toBeTruthy();
  });

  it("does not set a name attribute (prevents targeting by other frames)", () => {
    render(<EmailBodyFrame html="<p>Hello</p>" />);
    const iframe = document.querySelector("iframe");
    // name should be absent or empty — not set by the component
    const name = iframe?.getAttribute("name");
    expect(name == null || name === "").toBe(true);
  });

  it("passes html through sanitizeEmailHtml", () => {
    render(<EmailBodyFrame html="<p>Content</p>" />);
    expect(vi.mocked(sanitizeModule.sanitizeEmailHtml)).toHaveBeenCalledWith(
      "<p>Content</p>",
      expect.any(Object)
    );
  });

  it("passes collapseQuotes option to sanitizeEmailHtml when set", () => {
    render(<EmailBodyFrame html="<blockquote>Quoted</blockquote>" collapseQuotes />);
    expect(vi.mocked(sanitizeModule.sanitizeEmailHtml)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ collapseQuotes: true })
    );
  });

  it("has no src attribute (content is via srcdoc, not a URL)", () => {
    render(<EmailBodyFrame html="<p>Hello</p>" />);
    const iframe = document.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toBeNull();
  });

  it("has no border (seamless visual integration)", () => {
    render(<EmailBodyFrame html="<p>Hello</p>" />);
    const iframe = document.querySelector("iframe");
    const className = iframe?.className ?? "";
    // border-0 class should be present
    expect(className).toContain("border-0");
  });

  it("renders as a block element taking full width", () => {
    render(<EmailBodyFrame html="<p>Hello</p>" />);
    const iframe = document.querySelector("iframe");
    const className = iframe?.className ?? "";
    expect(className).toContain("w-full");
    expect(className).toContain("block");
  });

  it("updates srcdoc when html prop changes", () => {
    const { rerender } = render(<EmailBodyFrame html="<p>First</p>" />);
    const iframe = document.querySelector("iframe");
    const firstSrcdoc = iframe?.getAttribute("srcdoc") ?? "";
    expect(firstSrcdoc).toContain("First");

    rerender(<EmailBodyFrame html="<p>Second</p>" />);
    const updatedSrcdoc = iframe?.getAttribute("srcdoc") ?? "";
    expect(updatedSrcdoc).toContain("Second");
  });
});
