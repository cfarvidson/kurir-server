import { describe, it, expect } from "vitest";
import {
  extractSignature,
  mergeSignatureDetails,
  stripQuotedAndForwarded,
} from "@/lib/mail/signature-extract";
import { mergeContactDetails } from "@/lib/mail/person-details";

describe("stripQuotedAndForwarded", () => {
  it("cuts at a > quote block", () => {
    const text = "Hi\n\nThanks!\n\n> Old stuff\n> Tel 070-111 22 33";
    expect(stripQuotedAndForwarded(text)).toBe("Hi\n\nThanks!");
  });

  it("cuts at an 'On ... wrote:' attribution line", () => {
    const text = "Sure.\n\nOn Mon, 3 Aug 2026, Bob <bob@x.y> wrote:\nCall me 070-111 22 33";
    expect(stripQuotedAndForwarded(text)).toBe("Sure.");
  });

  it("cuts at a Swedish 'Den ... skrev' attribution line", () => {
    const text = "Ja.\n\nDen mån 3 aug. 2026 kl 10:00 skrev Bob <bob@x.y>:\n070-111 22 33";
    expect(stripQuotedAndForwarded(text)).toBe("Ja.");
  });

  it("cuts at forwarded headers (From:/Från: followed by Sent:/Skickat:)", () => {
    const en = "FYI\n\nFrom: Bob <bob@x.y>\nSent: Monday\nTo: me\nSubject: x\n\nBob Smith\nCEO, Globex\n+1 555 123 4567";
    expect(stripQuotedAndForwarded(en)).toBe("FYI");
    const sv = "Se nedan\n\nFrån: Bob <bob@x.y>\nSkickat: den 3 augusti 2026\nTill: mig\nÄmne: x";
    expect(stripQuotedAndForwarded(sv)).toBe("Se nedan");
  });

  it("cuts at Outlook original-message and forwarded dividers", () => {
    expect(
      stripQuotedAndForwarded("ok\n\n-----Original Message-----\nFrom: x"),
    ).toBe("ok");
    expect(
      stripQuotedAndForwarded("ok\n\n---------- Forwarded message ---------\nFrom: x"),
    ).toBe("ok");
    expect(
      stripQuotedAndForwarded("ok\n\nBegin forwarded message:\n\nFrom: x"),
    ).toBe("ok");
    expect(
      stripQuotedAndForwarded("ok\n\n________________________________\nFrom: x"),
    ).toBe("ok");
  });
});

describe("extractSignature", () => {
  it("reads phones, title and company from a -- delimited Swedish signature", () => {
    const text = [
      "Hej!",
      "",
      "Fakturan är på 12 500 kr och förfaller 2026-09-30.",
      "",
      "-- ",
      "Anna Andersson",
      "Ekonomichef",
      "Acme AB",
      "Tel: 08-123 456 78",
      "Mobil: 070-123 45 67",
      "anna@acme.se | www.acme.se",
    ].join("\n");
    expect(extractSignature(text)).toEqual({
      phones: ["08-123 456 78", "070-123 45 67"],
      title: "Ekonomichef",
      company: "Acme AB",
    });
  });

  it("reads an international signature after a closing line", () => {
    const text = [
      "Hi,",
      "",
      "Attached is the deck. Our order #4471 shipped on 08/12/2026.",
      "",
      "Best regards,",
      "Bob Smith",
      "Senior Product Manager | Globex Corporation",
      "M +1 (415) 555-0132",
      "bob@globex.com",
    ].join("\n");
    expect(extractSignature(text)).toEqual({
      phones: ["+1 (415) 555-0132"],
      title: "Senior Product Manager",
      company: "Globex Corporation",
    });
  });

  it("does not pick up numbers from the body above the signature", () => {
    const text = [
      "Ring mig på 070-999 88 77 så tar vi det.",
      "",
      "Mvh",
      "Carl",
      "Rektor, Solskolan",
      "Tfn 031-12 34 56",
    ].join("\n");
    const sig = extractSignature(text);
    expect(sig.phones).toEqual(["031-12 34 56"]);
    expect(sig.title).toBe("Rektor");
    expect(sig.company).toBe("Solskolan");
  });

  it("ignores phones and titles inside quoted replies and forwards", () => {
    const text = [
      "Tack, det låter bra.",
      "",
      "Med vänlig hälsning",
      "Anna Andersson",
      "Projektledare",
      "+46 70 123 45 67",
      "",
      "Den 3 aug. 2026 kl. 10:00 skrev Bob <bob@x.y>:",
      "> Hej",
      "> Bob Smith",
      "> CEO, Globex Inc.",
      "> +1 555 000 1111",
    ].join("\n");
    expect(extractSignature(text)).toEqual({
      phones: ["+46 70 123 45 67"],
      title: "Projektledare",
      company: undefined,
    });
  });

  it("returns nothing for a one-paragraph mail with a number in it", () => {
    expect(extractSignature("Call me at 070-123 45 67 tomorrow.")).toEqual({
      phones: [],
      title: undefined,
      company: undefined,
    });
  });

  it("returns nothing when the trailing block reads like prose", () => {
    const text = [
      "Hi,",
      "",
      "Just a reminder that the meeting is moved to room 4412 on Friday, please bring the 2025 figures and the 3 open items from last time so we can close them.",
    ].join("\n");
    expect(extractSignature(text)).toEqual({
      phones: [],
      title: undefined,
      company: undefined,
    });
  });

  it("does not treat a trailing prose paragraph as a signature", () => {
    expect(extractSignature("Hi Bob,\n\nCall me at 070-123 45 67 tomorrow.")).toEqual({
      phones: [],
      title: undefined,
      company: undefined,
    });
    expect(
      extractSignature("Hi,\n\nLet's discuss the project tomorrow.\nI'll bring the sales numbers."),
    ).toEqual({ phones: [], title: undefined, company: undefined });
  });

  it("accepts an unlabelled trailing card when it carries an anchor line", () => {
    const text = ["Hi,", "", "Talk soon.", "", "Eva Lind", "VD", "Acme AB", "Mob: 070-111 22 33", "eva@acme.se"].join("\n");
    expect(extractSignature(text)).toEqual({
      phones: ["070-111 22 33"],
      title: "VD",
      company: "Acme AB",
    });
  });

  it("does not mistake dates, org numbers, or postal addresses for phones", () => {
    const text = [
      "Hej",
      "",
      "Vänliga hälsningar",
      "Anna",
      "Acme AB, org.nr 556677-1234",
      "Kungsgatan 12, 111 22 Stockholm",
      "Uppdaterad 2026-08-31",
      "Direkt: +46 8 555 123 45",
    ].join("\n");
    expect(extractSignature(text).phones).toEqual(["+46 8 555 123 45"]);
  });

  it("dedupes the same number in different formats and caps at three", () => {
    const text = [
      "Hi",
      "",
      "Cheers",
      "Bob",
      "Tel +46 70 123 45 67",
      "Mobile: 070-1234567",
      "Office: +46 8 111 22 33",
      "Fax: +46 8 111 22 34",
      "Home: +46 8 111 22 35",
    ].join("\n");
    expect(extractSignature(text).phones).toEqual([
      "+46 70 123 45 67",
      "+46 8 111 22 33",
      "+46 8 111 22 34",
    ]);
  });

  it("skips 'Sent from my iPhone' style lines and the closing itself", () => {
    const text = ["Ok", "", "Thanks", "Bob", "Sent from my iPhone"].join("\n");
    expect(extractSignature(text)).toEqual({
      phones: [],
      title: undefined,
      company: undefined,
    });
    const sv = ["Ok", "", "Mvh Bob", "Skickat från min iPhone"].join("\n");
    expect(extractSignature(sv).title).toBeUndefined();
  });

  it("handles a 'Title at Company' line and CRLF input", () => {
    const text = "Hi\r\n\r\nRegards,\r\nEve\r\nHead of Sales at Initech\r\n";
    expect(extractSignature(text)).toEqual({
      phones: [],
      title: "Head of Sales",
      company: "Initech",
    });
  });

  it("is empty for empty or null-ish input", () => {
    expect(extractSignature("")).toEqual({
      phones: [],
      title: undefined,
      company: undefined,
    });
  });
});

describe("mergeSignatureDetails", () => {
  it("keeps stored values when a newer extraction found nothing for a field", () => {
    const merged = mergeSignatureDetails(
      { phones: ["070-1"], title: "CEO", company: "Acme AB" },
      { phones: [], title: undefined, company: "Acme Group" },
    );
    expect(merged).toEqual({
      phones: ["070-1"],
      title: "CEO",
      company: "Acme Group",
    });
  });

  it("unions phones, newest first, capped at three", () => {
    const merged = mergeSignatureDetails(
      { phones: ["+46 8 1", "+46 8 2"], title: undefined, company: undefined },
      { phones: ["+46 70 1", "+46 8 1"], title: undefined, company: undefined },
    );
    expect(merged.phones).toEqual(["+46 70 1", "+46 8 1", "+46 8 2"]);
  });
});

describe("mergeContactDetails", () => {
  it("lets Contact values win and fills gaps from the signature", () => {
    const merged = mergeContactDetails(
      { name: "Anna A", phones: [], title: undefined, company: "Acme Group" },
      {
        phones: ["+46 70 1"],
        title: "CEO",
        company: "Acme AB",
      },
    );
    expect(merged).toEqual({
      name: { value: "Anna A", source: "contact" },
      phones: [{ value: "+46 70 1", source: "signature" }],
      title: { value: "CEO", source: "signature" },
      company: { value: "Acme Group", source: "contact" },
    });
  });

  it("uses the signature alone when no Contact exists", () => {
    const merged = mergeContactDetails(null, {
      phones: ["+46 70 1"],
      title: undefined,
      company: "Acme AB",
    });
    expect(merged.name).toBeNull();
    expect(merged.title).toBeNull();
    expect(merged.company).toEqual({ value: "Acme AB", source: "signature" });
  });

  it("prefers Contact phones over signature phones", () => {
    const merged = mergeContactDetails(
      { name: "A", phones: ["+1 1"], title: undefined, company: undefined },
      { phones: ["+1 2"], title: undefined, company: undefined },
    );
    expect(merged.phones).toEqual([{ value: "+1 1", source: "contact" }]);
  });
});
