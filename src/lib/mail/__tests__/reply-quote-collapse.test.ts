// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { sanitizeEmailHtmlWithMeta } from "../sanitize-html";
import { convertMarkdownToEmailHtml } from "../markdown-to-email";
import { appendQuoteToHtml, buildReplyQuote } from "../reply-quote";

describe("thread view collapses the generated reply quote", () => {
  const quote = buildReplyQuote({
    fromName: "Isabelle Kornby",
    fromAddress: "isabelle@example.com",
    sentAt: new Date("2026-09-08T08:35:29Z"),
    textBody: "Hej Carl-Fredrik,\nBifogat finner du påminnelsefakturan.",
  })!;
  const html = appendQuoteToHtml(
    convertMarkdownToEmailHtml("Ok, jag betalade fakturan igår.").displayHtml,
    quote.html,
  );

  it("is marked collapsible and folds to the new text", () => {
    const { html: cut, quoteCollapsible } = sanitizeEmailHtmlWithMeta(html, {
      collapseQuotes: true,
    });
    expect(quoteCollapsible).toBe(true);
    expect(cut).toContain("Ok, jag betalade fakturan igår.");
    expect(cut).not.toContain("Bifogat");
    expect(cut).not.toContain("wrote:");
  });
});
