/**
 * AI content rules: the pure half — sender scope coverage, the inference
 * request, verdict parsing, and the placement each action produces.
 */
import { describe, it, expect } from "vitest";
import {
  buildContentRuleRequest,
  contentRuleCoversSender,
  messageHrefForPlacement,
  normalizeScopeValue,
  parseContentRuleVerdict,
  placementForAction,
  senderScopeWhere,
  MAX_BODY_CHARS,
} from "@/lib/mail/content-rules";

describe("normalizeScopeValue", () => {
  it("lowercases and trims an address", () => {
    expect(normalizeScopeValue("ADDRESS", "  Anna@Consult.SE ")).toBe(
      "anna@consult.se",
    );
  });

  it("rejects an address without @ and a domain with @", () => {
    expect(() => normalizeScopeValue("ADDRESS", "consult.se")).toThrow(
      /address/i,
    );
    expect(() => normalizeScopeValue("DOMAIN", "anna@consult.se")).toThrow(
      /domain/i,
    );
  });

  it("rejects a single-label domain and an empty value", () => {
    expect(() => normalizeScopeValue("SUBDOMAINS", "se")).toThrow(/domain/i);
    expect(() => normalizeScopeValue("DOMAIN", "  ")).toThrow(/domain/i);
  });
});

const since = new Date("2026-09-01T00:00:00Z");
const before = new Date("2026-08-31T23:59:59Z");
const after = new Date("2026-09-10T00:00:00Z");

describe("contentRuleCoversSender", () => {
  const senders = [
    { scope: "ADDRESS" as const, scopeValue: "anna@consult.se", since },
    { scope: "SUBDOMAINS" as const, scopeValue: "broker.io", since },
  ];

  it("matches the exact address and any subdomain", () => {
    expect(contentRuleCoversSender("Anna@Consult.se", after, senders)).toBe(true);
    expect(contentRuleCoversSender("x@jobs.broker.io", after, senders)).toBe(true);
    expect(contentRuleCoversSender("x@broker.io", since, senders)).toBe(true);
  });

  it("misses other senders, mail older than the sender's since, and an empty list", () => {
    expect(contentRuleCoversSender("bob@consult.se", after, senders)).toBe(false);
    expect(contentRuleCoversSender("x@notbroker.io", after, senders)).toBe(false);
    expect(contentRuleCoversSender("anna@consult.se", before, senders)).toBe(false);
    expect(contentRuleCoversSender("anna@consult.se", after, [])).toBe(false);
  });
});

describe("senderScopeWhere", () => {
  it("builds one case-insensitive clause per scope kind, each bound to its sender's since", () => {
    const receivedAt = { gte: since };
    expect(
      senderScopeWhere([
        { scope: "ADDRESS", scopeValue: "anna@consult.se", since },
        { scope: "DOMAIN", scopeValue: "consult.se", since },
        { scope: "SUBDOMAINS", scopeValue: "broker.io", since },
      ]),
    ).toEqual([
      { fromAddress: { equals: "anna@consult.se", mode: "insensitive" }, receivedAt },
      { fromAddress: { endsWith: "@consult.se", mode: "insensitive" }, receivedAt },
      { fromAddress: { endsWith: "@broker.io", mode: "insensitive" }, receivedAt },
      { fromAddress: { endsWith: ".broker.io", mode: "insensitive" }, receivedAt },
    ]);
  });
});

describe("buildContentRuleRequest", () => {
  const message = {
    subject: "Profil: senior utvecklare",
    fromAddress: "anna@consult.se",
    fromName: "Anna",
    receivedAt: new Date("2026-09-14T08:00:00Z"),
    textBody: null,
    htmlBody: "<p>Uppdrag i <b>Uppsala</b>, 2 dagar remote.</p>",
  };

  it("puts the criterion and a text rendering of the mail in the user turn", () => {
    const request = buildContentRuleRequest("2 dagar remote i Uppsala", message);
    expect(request.system).toMatch(/JSON/);
    expect(request.user).toContain("2 dagar remote i Uppsala");
    expect(request.user).toContain("Anna <anna@consult.se>");
    expect(request.user).toContain("Profil: senior utvecklare");
    expect(request.user).toMatch(/Uppdrag i Uppsala\s*, 2 dagar remote\./);
    expect(request.user).not.toContain("<b>");
  });

  it("marks a truncated body instead of cutting it silently", () => {
    const request = buildContentRuleRequest("x", {
      ...message,
      htmlBody: null,
      textBody: "a".repeat(MAX_BODY_CHARS + 10),
    });
    expect(request.user).toContain("[truncated]");
    expect(request.user.length).toBeLessThan(MAX_BODY_CHARS + 1000);
  });
});

describe("parseContentRuleVerdict", () => {
  it("reads a bare JSON object", () => {
    expect(
      parseContentRuleVerdict('{"match": true, "reason": "Två dagar remote."}'),
    ).toEqual({ matched: true, reason: "Två dagar remote." });
  });

  it("reads JSON wrapped in prose or a code fence", () => {
    expect(
      parseContentRuleVerdict(
        'Here you go:\n```json\n{"match": false, "reason": "On-site only."}\n```',
      ),
    ).toEqual({ matched: false, reason: "On-site only." });
  });

  it("returns null for garbage or a non-boolean match", () => {
    expect(parseContentRuleVerdict("yes")).toBeNull();
    expect(parseContentRuleVerdict('{"match": "yes"}')).toBeNull();
    expect(parseContentRuleVerdict("")).toBeNull();
  });

  it("caps the reason and tolerates a missing one", () => {
    const long = parseContentRuleVerdict(
      `{"match": true, "reason": "${"r".repeat(900)}"}`,
    );
    expect(long?.reason.length).toBe(500);
    expect(parseContentRuleVerdict('{"match": false}')).toEqual({
      matched: false,
      reason: "",
    });
  });
});

describe("placementForAction", () => {
  it("returns null for KEEP", () => {
    expect(placementForAction("KEEP")).toBeNull();
  });

  it("files into exactly one category or archives", () => {
    expect(placementForAction("FEED")).toEqual({
      isInScreener: false,
      isInImbox: false,
      isInFeed: true,
      isInPaperTrail: false,
      isArchived: false,
    });
    expect(placementForAction("ARCHIVE")).toEqual({
      isInScreener: false,
      isInImbox: false,
      isInFeed: false,
      isInPaperTrail: false,
      isArchived: true,
    });
  });
});

describe("messageHrefForPlacement", () => {
  const base = { id: "m1", isArchived: false, isInFeed: false, isInPaperTrail: false };

  it("opens the message under its current category, archive first", () => {
    expect(messageHrefForPlacement({ ...base, isArchived: true, isInFeed: true })).toBe(
      "/archive/m1",
    );
    expect(messageHrefForPlacement({ ...base, isInFeed: true })).toBe("/feed/m1");
    expect(messageHrefForPlacement({ ...base, isInPaperTrail: true })).toBe(
      "/paper-trail/m1",
    );
    expect(messageHrefForPlacement(base)).toBe("/imbox/m1");
  });
});
