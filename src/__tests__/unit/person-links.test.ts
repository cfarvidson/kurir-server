import { describe, it, expect } from "vitest";
import { accept, dedupKey, extractLinks } from "@/lib/mail/person-links";

describe("extractLinks", () => {
  it("extracts href text and a bare URL", () => {
    const html = `<p>See <a href="https://docs.example.com/q3">Q3 budget</a> and
        https://notes.example.com/pad.</p>`;
    const found = extractLinks(html, null);
    expect(found.map((l) => l.title)).toEqual([
      "Q3 budget",
      "notes.example.com/pad",
    ]);
    expect(found.map((l) => l.key)).toEqual([
      "docs.example.com/q3",
      "notes.example.com/pad",
    ]);
  });

  it("prefers anchor text over a bare duplicate", () => {
    const html = `<a href="https://docs.example.com/q3">Q3 budget</a>
        https://docs.example.com/q3`;
    expect(extractLinks(html, null).map((l) => l.title)).toEqual(["Q3 budget"]);
  });

  it("dedupes http/https and a trailing slash", () => {
    const a = accept("https://Docs.Example.com/a/b/", null);
    const b = accept("http://docs.example.com/a/b", null);
    expect(a?.key).toBe(b?.key);
    expect(a?.key).toBe("docs.example.com/a/b");
    expect(dedupKey(new URL("https://docs.example.com/a/b/"))).toBe(
      "docs.example.com/a/b",
    );
  });

  it("drops mailto, tel, cid, javascript, trackers, and unsubscribe", () => {
    expect(accept("mailto:ada@x.y", null)).toBeNull();
    expect(accept("tel:+46701234567", null)).toBeNull();
    expect(accept("cid:image001", null)).toBeNull();
    expect(accept("javascript:void(0)", null)).toBeNull();
    expect(accept("https://emltrk.com/open?u=1", "pixel")).toBeNull();
    expect(
      accept("https://list.example.com/unsubscribe?id=1", "here"),
    ).toBeNull();
    expect(accept("https://example.com/u", "Unsubscribe")).toBeNull();
  });

  it("ignores quoted-reply hrefs", () => {
    const html = `<div>New: <a href="https://now.example.com/x">now</a></div>
        <blockquote class="gmail_quote">
        old <a href="https://old.example.com/y">old</a>
        </blockquote>`;
    expect(extractLinks(html, null).map((l) => l.key)).toEqual([
      "now.example.com/x",
    ]);
  });

  it("ignores quoted plaintext URLs", () => {
    const text = `latest https://now.example.com/x

> earlier https://old.example.com/y`;
    expect(extractLinks(null, text).map((l) => l.key)).toEqual([
      "now.example.com/x",
    ]);
  });
});
