import { describe, it, expect } from "vitest";
import {
  appendQuoteToHtml,
  buildReplyQuote,
  htmlToQuoteText,
} from "@/lib/mail/reply-quote";
import { createSnippet } from "@/lib/mail/snippet";
import { splitPlainTextQuotes } from "@/lib/mail/quote-utils";

const original = {
  fromName: "Isabelle Kornby",
  fromAddress: "isabelle@example.com",
  sentAt: new Date("2026-09-08T08:35:29Z"),
  receivedAt: new Date("2026-09-08T08:35:45Z"),
  textBody:
    "Hej Carl-Fredrik,\r\nBifogat finner du påminnelsefakturan.\r\n\r\n> Hej!\r\n> Det har varit svårt.\r\n",
  htmlBody: null,
};

describe("buildReplyQuote", () => {
  it("prefixes every original line and puts the attribution above", () => {
    const quote = buildReplyQuote(original)!;
    expect(quote.text).toBe(
      "\n\nOn 8 Sep 2026, Isabelle Kornby <isabelle@example.com> wrote:\n\n" +
        "> Hej Carl-Fredrik,\n" +
        "> Bifogat finner du påminnelsefakturan.\n" +
        ">\n" +
        "> > Hej!\n" +
        "> > Det har varit svårt.",
    );
  });

  it("renders the HTML part as attribution plus an escaped blockquote", () => {
    const quote = buildReplyQuote({
      ...original,
      textBody: "1 < 2 & <b>bold</b>",
    })!;
    expect(quote.html).toBe(
      "<div>On 8 Sep 2026, Isabelle Kornby &lt;isabelle@example.com&gt; wrote:</div>\n" +
        '<blockquote type="cite" style="border-left:3px solid #d1d5db;margin:0 0 1em;padding:0 0 0 12px;color:#6b7280">' +
        "1 &lt; 2 &amp; &lt;b&gt;bold&lt;/b&gt;</blockquote>",
    );
  });

  it("falls back to the address alone and to receivedAt", () => {
    const quote = buildReplyQuote({
      fromAddress: "noreply@example.com",
      receivedAt: new Date("2026-01-02T00:00:00Z"),
      textBody: "Hi",
    })!;
    expect(quote.text.split("\n")[2]).toBe(
      "On 2 Jan 2026, noreply@example.com wrote:",
    );
  });

  it("quotes a text rendering when the original only has HTML", () => {
    const quote = buildReplyQuote({
      ...original,
      textBody: "  ",
      htmlBody:
        "<html><head><style>p{}</style></head><body><p>First &amp; second</p><div>Third<br>Fourth</div></body></html>",
    })!;
    expect(quote.text).toContain(
      "> First & second\n> Third\n> Fourth",
    );
  });

  it("is null when there is nothing to quote", () => {
    expect(
      buildReplyQuote({ fromAddress: "a@b", textBody: "", htmlBody: null }),
    ).toBeNull();
    expect(
      buildReplyQuote({ fromAddress: "a@b", htmlBody: "<p> </p>" }),
    ).toBeNull();
  });
});

describe("htmlToQuoteText", () => {
  it("keeps line structure and drops scripts and styles", () => {
    expect(
      htmlToQuoteText(
        "<style>x</style><script>y</script><p>a</p><p>b</p><br><br><br>c",
      ),
    ).toBe("a\nb\n\nc");
  });
});

describe("appendQuoteToHtml", () => {
  it("inserts before </body> of the markdown wrapper", () => {
    expect(
      appendQuoteToHtml("<html><body>\n<p>Hi</p>\n</body></html>", "<q>"),
    ).toBe("<html><body>\n<p>Hi</p>\n<q>\n</body></html>");
  });

  it("appends when there is no body element", () => {
    expect(appendQuoteToHtml("<p>Hi</p>", "<q>")).toBe("<p>Hi</p>\n<q>");
  });
});

describe("Kurir's own quote detection folds the generated quote", () => {
  const text = "Ok, jag betalade fakturan igår." + buildReplyQuote(original)!.text;

  it("splitPlainTextQuotes returns only the new text as the body", () => {
    expect(splitPlainTextQuotes(text).body.trim()).toBe(
      "Ok, jag betalade fakturan igår.",
    );
  });

  it("createSnippet does not leak the quote into the Sent row", () => {
    expect(createSnippet(text)).toBe("Ok, jag betalade fakturan igår.");
  });
});
