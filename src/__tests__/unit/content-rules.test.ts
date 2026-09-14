/**
 * AI content rules: the pure half — sender scope coverage, the inference
 * request, verdict parsing, and the placement each action produces.
 */
import { describe, it, expect } from "vitest";
import {
  buildContentRuleRequest,
  contentRuleCoversSender,
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

describe("contentRuleCoversSender", () => {
  const senders = [
    { scope: "ADDRESS" as const, scopeValue: "anna@consult.se" },
    { scope: "SUBDOMAINS" as const, scopeValue: "broker.io" },
  ];

  it("matches the exact address and any subdomain", () => {
    expect(contentRuleCoversSender("Anna@Consult.se", senders)).toBe(true);
    expect(contentRuleCoversSender("x@jobs.broker.io", senders)).toBe(true);
    expect(contentRuleCoversSender("x@broker.io", senders)).toBe(true);
  });

  it("misses other senders and an empty list", () => {
    expect(contentRuleCoversSender("bob@consult.se", senders)).toBe(false);
    expect(contentRuleCoversSender("x@notbroker.io", senders)).toBe(false);
    expect(contentRuleCoversSender("anna@consult.se", [])).toBe(false);
  });
});

describe("senderScopeWhere", () => {
  it("builds one case-insensitive clause per scope kind", () => {
    expect(
      senderScopeWhere([
        { scope: "ADDRESS", scopeValue: "anna@consult.se" },
        { scope: "DOMAIN", scopeValue: "consult.se" },
        { scope: "SUBDOMAINS", scopeValue: "broker.io" },
      ]),
    ).toEqual([
      { fromAddress: { equals: "anna@consult.se", mode: "insensitive" } },
      { fromAddress: { endsWith: "@consult.se", mode: "insensitive" } },
      { fromAddress: { endsWith: "@broker.io", mode: "insensitive" } },
      { fromAddress: { endsWith: ".broker.io", mode: "insensitive" } },
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
