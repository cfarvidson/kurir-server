/**
 * Pure matching/precedence tests for subject screening rules (kurir-ios#48)
 * in src/lib/mail/subject-rules.ts.
 */
import { describe, it, expect } from "vitest";
import {
  matchSubjectRule,
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
