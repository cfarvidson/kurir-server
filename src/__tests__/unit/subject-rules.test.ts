/**
 * Pure matching/precedence tests for subject screening rules (kurir-ios#48)
 * in src/lib/mail/subject-rules.ts.
 */
import { describe, it, expect } from "vitest";
import {
  matchSubjectRule,
  stripReplyPrefixes,
  subjectRuleMatches,
  subjectScopeOptions,
  type SubjectRuleLike,
} from "@/lib/mail/subject-rules";

const rule = (
  scope: SubjectRuleLike["scope"],
  scopeValue: string,
  pattern: string,
): SubjectRuleLike => ({ scope, scopeValue, pattern });

describe("subjectRuleMatches", () => {
  it("matches when the subject contains the pattern, case-insensitively", () => {
    const r = rule("ADDRESS", "news@github.com", "security alert");
    expect(subjectRuleMatches("news@github.com", "SECURITY Alert: repo", r)).toBe(
      true,
    );
    expect(subjectRuleMatches("News@GitHub.com", "security alert", r)).toBe(
      true,
    );
    expect(subjectRuleMatches("news@github.com", "weekly digest", r)).toBe(
      false,
    );
  });

  it("never matches a null/missing subject", () => {
    const r = rule("ADDRESS", "a@b.com", "x");
    expect(subjectRuleMatches("a@b.com", null, r)).toBe(false);
    expect(subjectRuleMatches("a@b.com", undefined, r)).toBe(false);
  });

  it("never matches an empty pattern", () => {
    expect(
      subjectRuleMatches("a@b.com", "anything", rule("ADDRESS", "a@b.com", "")),
    ).toBe(false);
  });

  it("ignores reply/forward prefixes on the subject side (kurir-ios#58)", () => {
    const r = rule("ADDRESS", "a@b.com", "weekly digest");
    expect(subjectRuleMatches("a@b.com", "Re: Weekly digest", r)).toBe(true);
    expect(subjectRuleMatches("a@b.com", "Sv: weekly digest", r)).toBe(true);
    expect(subjectRuleMatches("a@b.com", "Re: Fwd: weekly digest", r)).toBe(
      true,
    );
    expect(subjectRuleMatches("a@b.com", "weekly digest", r)).toBe(true);
  });

  it("ignores a reply prefix stored in the pattern (pre-#58 rules)", () => {
    const r = rule("ADDRESS", "a@b.com", "re: weekly digest");
    expect(subjectRuleMatches("a@b.com", "weekly digest", r)).toBe(true);
    expect(subjectRuleMatches("a@b.com", "Re: weekly digest", r)).toBe(true);
    expect(subjectRuleMatches("a@b.com", "other", r)).toBe(false);
  });

  it("a pattern that is nothing but a prefix never matches", () => {
    const r = rule("ADDRESS", "a@b.com", "re:");
    expect(subjectRuleMatches("a@b.com", "re: anything", r)).toBe(false);
  });

  it("scopes: ADDRESS matches only the exact address", () => {
    const r = rule("ADDRESS", "news@github.com", "x");
    expect(subjectRuleMatches("news@github.com", "x", r)).toBe(true);
    expect(subjectRuleMatches("other@github.com", "x", r)).toBe(false);
  });

  it("scopes: DOMAIN matches the exact domain, not subdomains", () => {
    const r = rule("DOMAIN", "github.com", "x");
    expect(subjectRuleMatches("a@github.com", "x", r)).toBe(true);
    expect(subjectRuleMatches("b@github.com", "x", r)).toBe(true);
    expect(subjectRuleMatches("a@mail.github.com", "x", r)).toBe(false);
  });

  it("scopes: SUBDOMAINS matches the domain and deep subdomains", () => {
    const r = rule("SUBDOMAINS", "github.com", "x");
    expect(subjectRuleMatches("a@github.com", "x", r)).toBe(true);
    expect(subjectRuleMatches("a@mail.github.com", "x", r)).toBe(true);
    expect(subjectRuleMatches("a@deep.mail.github.com", "x", r)).toBe(true);
    expect(subjectRuleMatches("a@notgithub.com", "x", r)).toBe(false);
  });
});

describe("stripReplyPrefixes", () => {
  it("strips single and stacked prefixes, case-insensitively", () => {
    expect(stripReplyPrefixes("Re: hello")).toBe("hello");
    expect(stripReplyPrefixes("SV: hello")).toBe("hello");
    expect(stripReplyPrefixes("Fwd: hello")).toBe("hello");
    expect(stripReplyPrefixes("FW: hello")).toBe("hello");
    expect(stripReplyPrefixes("VB: hello")).toBe("hello");
    expect(stripReplyPrefixes("Aw: hello")).toBe("hello");
    expect(stripReplyPrefixes("Vs: hello")).toBe("hello");
    expect(stripReplyPrefixes("Re: Fwd: Sv: hello")).toBe("hello");
  });

  it("handles missing or extra whitespace around the colon", () => {
    expect(stripReplyPrefixes("Re:hello")).toBe("hello");
    expect(stripReplyPrefixes("Re :  hello")).toBe("hello");
    expect(stripReplyPrefixes("  Re: hello  ")).toBe("hello");
  });

  it("only strips whole prefix tokens at the start", () => {
    expect(stripReplyPrefixes("revenue: q3")).toBe("revenue: q3");
    expect(stripReplyPrefixes("svar: hej")).toBe("svar: hej");
    expect(stripReplyPrefixes("update re: budget")).toBe("update re: budget");
    expect(stripReplyPrefixes("hello")).toBe("hello");
  });

  it("a bare prefix strips to the empty string", () => {
    expect(stripReplyPrefixes("Re:")).toBe("");
    expect(stripReplyPrefixes("Re: Fwd:")).toBe("");
  });
});

describe("matchSubjectRule", () => {
  it("returns null when nothing matches", () => {
    expect(
      matchSubjectRule("a@b.com", "hello", [rule("ADDRESS", "a@b.com", "bye")]),
    ).toBeNull();
  });

  it("ADDRESS beats DOMAIN beats SUBDOMAINS", () => {
    const address = rule("ADDRESS", "a@github.com", "x");
    const domain = rule("DOMAIN", "github.com", "x");
    const wild = rule("SUBDOMAINS", "github.com", "x");
    expect(matchSubjectRule("a@github.com", "x", [wild, domain, address])).toBe(
      address,
    );
    expect(matchSubjectRule("a@github.com", "x", [wild, domain])).toBe(domain);
    expect(matchSubjectRule("a@github.com", "x", [wild])).toBe(wild);
  });

  it("among SUBDOMAINS matches, the longest scopeValue wins", () => {
    const broad = rule("SUBDOMAINS", "github.com", "x");
    const narrow = rule("SUBDOMAINS", "mail.github.com", "x");
    expect(
      matchSubjectRule("a@news.mail.github.com", "x", [broad, narrow]),
    ).toBe(narrow);
  });

  it("at equal scope, the longest pattern wins", () => {
    const short = rule("ADDRESS", "a@b.com", "invoice");
    const long = rule("ADDRESS", "a@b.com", "invoice overdue");
    expect(
      matchSubjectRule("a@b.com", "invoice overdue notice", [short, long]),
    ).toBe(long);
  });

  it("a full tie goes to the first rule in caller order", () => {
    const first = rule("ADDRESS", "a@b.com", "alpha");
    const second = rule("ADDRESS", "a@b.com", "bravo");
    expect(matchSubjectRule("a@b.com", "alpha bravo", [first, second])).toBe(
      first,
    );
  });
});

describe("subjectScopeOptions", () => {
  it("offers address, domain, then parent wildcards (never *.tld)", () => {
    expect(subjectScopeOptions("News@mail.github.com")).toEqual([
      { scope: "ADDRESS", scopeValue: "news@mail.github.com" },
      { scope: "DOMAIN", scopeValue: "mail.github.com" },
      { scope: "SUBDOMAINS", scopeValue: "github.com" },
    ]);
  });

  it("a bare two-label domain gets no wildcard option", () => {
    expect(subjectScopeOptions("a@github.com")).toEqual([
      { scope: "ADDRESS", scopeValue: "a@github.com" },
      { scope: "DOMAIN", scopeValue: "github.com" },
    ]);
  });
});
