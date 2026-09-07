import { describe, it, expect } from "vitest";
import {
  closingKind,
  isClosingLine,
  isNameLike,
  splitPlainTextQuotes,
} from "../quote-utils";

describe("splitPlainTextQuotes", () => {
  it("collapses a trailing > block with its attribution line", () => {
    const text = "Thanks!\n\nOn Mon, Sep 7, 2026 Bob wrote:\n> hello\n> there";
    expect(splitPlainTextQuotes(text)).toEqual({
      body: "Thanks!",
      quoted: "On Mon, Sep 7, 2026 Bob wrote:\n> hello\n> there",
    });
  });

  it("pulls in a wrapped Swedish attribution", () => {
    const text =
      "Tack!\n\nDen 7 sep. 2026 kl. 12:30 skrev Carl-Fredrik Arvidson\n<carl-fredrik@arvidson.io>:\n\n> Hej";
    const { body, quoted } = splitPlainTextQuotes(text);
    expect(body).toBe("Tack!");
    expect(quoted?.startsWith("Den 7 sep. 2026")).toBe(true);
  });

  it("does not treat prose starting with 'On' above the attribution as quoted", () => {
    const text = "On the other hand, fine.\nOn X wrote:\n> q";
    expect(splitPlainTextQuotes(text).body).toBe("On the other hand, fine.");
  });

  it("leaves inline > replies alone", () => {
    const text = "> question\nanswer\n> other\nmore";
    expect(splitPlainTextQuotes(text)).toEqual({ body: text, quoted: null });
  });

  it("cuts at an Outlook Från:/Skickat: header without > prefixes", () => {
    // Outlook desktop (Windows, Swedish) quoting an earlier mail verbatim.
    const text = [
      "Hej!",
      "",
      "Ifall du inte finner någon tillverkarskylt, kanske finns det en faktura",
      "eller beställningsunderlag?",
      "",
      " ",
      "",
      "Från: carl-fredrik@arvidson.io <carl-fredrik@arvidson.io> ",
      "Skickat: den 7 september 2026 12:30",
      "Till: info@portexpert.se",
      "Ämne: Re: Sv: Portar",
      "",
      "Hej!",
      "",
      "Jag har letat men hittar tyvärr ingen tillverkarskylt på porten.",
    ].join("\n");
    const { body, quoted } = splitPlainTextQuotes(text);
    expect(body).toBe(
      "Hej!\n\nIfall du inte finner någon tillverkarskylt, kanske finns det en faktura\neller beställningsunderlag?",
    );
    expect(quoted?.startsWith("Från: carl-fredrik")).toBe(true);
  });

  it("cuts at an English From:/Sent: header and at dividers", () => {
    expect(
      splitPlainTextQuotes("ok\n\nFrom: x\nSent: y\nTo: z\n\nold").body,
    ).toBe("ok");
    expect(
      splitPlainTextQuotes("ok\n\n-----Original Message-----\nFrom: x").body,
    ).toBe("ok");
    expect(
      splitPlainTextQuotes("ok\n\n________________________________\nFrom: x")
        .body,
    ).toBe("ok");
  });

  it("does not cut at a lone From: line without a following label", () => {
    const text = "From: the top of the hill\nyou can see far.";
    expect(splitPlainTextQuotes(text)).toEqual({ body: text, quoted: null });
  });

  it("cuts at the -- signature delimiter", () => {
    const text = "See you\n-- \nBob\nCEO";
    expect(splitPlainTextQuotes(text)).toEqual({
      body: "See you",
      quoted: "-- \nBob\nCEO",
    });
  });

  it("hides a signature that sits below the quote (Thunderbird reply-above)", () => {
    const text = "Hi\n\nOn X wrote:\n> q\n-- \nBob";
    expect(splitPlainTextQuotes(text)).toEqual({
      body: "Hi",
      quoted: "On X wrote:\n> q\n-- \nBob",
    });
  });

  it("matches the German Outlook divider", () => {
    expect(
      splitPlainTextQuotes("Hi\n-----Ursprüngliche Nachricht-----\nVon: a@b")
        .body,
    ).toBe("Hi");
  });

  it("uses the earliest of signature and quote", () => {
    const text = "Hi\n-- \nBob\n\nOn X wrote:\n> q";
    expect(splitPlainTextQuotes(text).body).toBe("Hi");
  });

  it("hides a trailing 'Sent from my iPhone' line", () => {
    expect(splitPlainTextQuotes("Yes\n\nSent from my iPhone").body).toBe("Yes");
    expect(
      splitPlainTextQuotes("Ja\n\nSkickat från min iPhone\n\nOn X wrote:\n> q")
        .body,
    ).toBe("Ja");
    expect(splitPlainTextQuotes("Yes\n\nGet Outlook for iOS").body).toBe("Yes");
  });

  it("keeps a 'Sent from' line that is not the last one", () => {
    const text = "Sent from my iPhone this morning, worked fine.\nCheers";
    expect(splitPlainTextQuotes(text)).toEqual({ body: text, quoted: null });
  });

  it("starts the signature at the last closing phrase", () => {
    const text = [
      "Hej!",
      "",
      "Tack för svaret, jag återkommer.",
      "",
      "Med vänliga hälsningar",
      "",
      "Teckentrup / Portexpert.se",
      "",
      "Nicklas Bertilsson",
      "Mob: 0707-88 06 69",
    ].join("\n");
    const { body, quoted } = splitPlainTextQuotes(text);
    expect(body).toBe("Hej!\n\nTack för svaret, jag återkommer.");
    expect(quoted?.startsWith("Med vänliga hälsningar")).toBe(true);
  });

  it("recognises Mvh + name, slash sign-offs and English closings", () => {
    expect(splitPlainTextQuotes("Ok!\n\nMvh Nicklas\n070-123").body).toBe(
      "Ok!",
    );
    expect(splitPlainTextQuotes("Ok!\n\n/Nicklas").body).toBe("Ok!");
    expect(splitPlainTextQuotes("Ok!\n\n//Nicklas Bertilsson\nVD").body).toBe(
      "Ok!",
    );
    expect(splitPlainTextQuotes("Ok!\n\nBest regards,\nBob").body).toBe("Ok!");
  });

  it("keeps a bare closing that is first, last, or followed by prose", () => {
    expect(splitPlainTextQuotes("Tack\nBob").quoted).toBeNull();
    expect(splitPlainTextQuotes("Hej\nTack").quoted).toBeNull();
    expect(
      splitPlainTextQuotes(
        "Hej!\n\nKan du skicka den?\n\nTack\n\nOch en sak till...",
      ).quoted,
    ).toBeNull();
    // A lone "Tack" mid-mail followed by a later real closing: the last wins.
    expect(splitPlainTextQuotes("Hej\nTack\nEn sak till.\nMvh\nBob").body).toBe(
      "Hej\nTack\nEn sak till.",
    );
  });

  it("closing phrase comes before a trailing quote and Sent-from", () => {
    expect(
      splitPlainTextQuotes("Ok\n\nMvh\nBob\n\nOn X wrote:\n> q").body,
    ).toBe("Ok");
  });

  it("bails when nothing would remain visible", () => {
    expect(splitPlainTextQuotes("> only quoted")).toEqual({
      body: "> only quoted",
      quoted: null,
    });
    expect(splitPlainTextQuotes("Sent from my iPhone").quoted).toBeNull();
    expect(splitPlainTextQuotes("\nFrom: x\nSent: y").quoted).toBeNull();
  });

  it("returns the text untouched when there is nothing to collapse", () => {
    const text = "Just a normal mail.\nTwo lines.";
    expect(splitPlainTextQuotes(text)).toEqual({ body: text, quoted: null });
  });

  it("handles CRLF bodies", () => {
    const text = "Hi\r\n\r\nOn X wrote:\r\n> q\r\n";
    expect(splitPlainTextQuotes(text).body).toBe("Hi");
  });
});

describe("closingKind / isNameLike", () => {
  it("classifies closings, names and slash sign-offs", () => {
    expect(closingKind("Med vänliga hälsningar")).toBe("bare");
    expect(closingKind("Med vänlig hälsning,")).toBe("bare");
    expect(closingKind("Mvh Nicklas")).toBe("named");
    expect(closingKind("Kind regards, Bob Smith")).toBe("named");
    expect(closingKind("/Nicklas")).toBe("named");
    expect(closingKind("//Nicklas Bertilsson")).toBe("named");
    expect(closingKind("/ Carl-Fredrik")).toBe("named");
    expect(closingKind("/Bjørn")).toBe("named");
    expect(closingKind("/nicklas")).toBe("named");
    expect(isClosingLine("Best regards")).toBe(true);
  });

  it("rejects prose, paths and ASCII-boundary false positives", () => {
    for (const l of [
      "Tack för att du hörde av dig.",
      "Best regards are sent to everyone",
      "/usr/local/bin",
      "//comment in code",
      "Mvh vi ses imorgon på kontoret",
      "BRÖD AB",
    ]) {
      expect(closingKind(l), l).toBe("none");
    }
  });

  it("tells names and companies from prose", () => {
    for (const l of [
      "Nicklas Bertilsson",
      "Teckentrup / Portexpert.se",
      "Head of Sales",
      "VD",
      "Carl-Fredrik Arvidson",
    ]) {
      expect(isNameLike(l), l).toBe(true);
    }
    for (const l of [
      "Kan du skicka den?",
      "Och en sak till...",
      "Vår styrka är att vi",
      "0707-88 06 69",
      "Mob: 0707",
    ]) {
      expect(isNameLike(l), l).toBe(false);
    }
  });
});
