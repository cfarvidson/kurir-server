/**
 * Unit tests for domain screening rule matching/precedence and the
 * scope-option generator (plan 033).
 */
import { describe, it, expect } from "vitest";
import {
  matchDomainRule,
  patternMatchesDomain,
  domainScopeOptions,
} from "@/lib/mail/domain-rules";

function rule(
  id: string,
  pattern: string,
  includeSubdomains: boolean,
): { id: string; pattern: string; includeSubdomains: boolean } {
  return { id, pattern, includeSubdomains };
}

describe("patternMatchesDomain", () => {
  it("exact pattern matches only the exact domain", () => {
    expect(patternMatchesDomain("github.com", rule("r", "github.com", false))).toBe(
      true,
    );
    expect(
      patternMatchesDomain("news.github.com", rule("r", "github.com", false)),
    ).toBe(false);
  });

  it("wildcard pattern matches the domain itself and any subdomain depth", () => {
    const r = rule("r", "github.com", true);
    expect(patternMatchesDomain("github.com", r)).toBe(true);
    expect(patternMatchesDomain("news.github.com", r)).toBe(true);
    expect(patternMatchesDomain("mail.dev.github.com", r)).toBe(true);
  });

  it("wildcard pattern requires a label boundary", () => {
    expect(
      patternMatchesDomain("evilgithub.com", rule("r", "github.com", true)),
    ).toBe(false);
  });

  it("is case-insensitive on the sender domain", () => {
    expect(
      patternMatchesDomain("News.GitHub.com", rule("r", "github.com", true)),
    ).toBe(true);
  });
});

describe("matchDomainRule precedence", () => {
  it("returns null when nothing matches", () => {
    expect(
      matchDomainRule("example.com", [rule("a", "github.com", true)]),
    ).toBeNull();
  });

  it("exact rule beats wildcard rule", () => {
    const exact = rule("exact", "news.github.com", false);
    const wild = rule("wild", "github.com", true);
    expect(matchDomainRule("news.github.com", [wild, exact])).toBe(exact);
  });

  it("longest pattern wins among wildcard matches", () => {
    const shallow = rule("shallow", "github.com", true);
    const deep = rule("deep", "dev.github.com", true);
    expect(matchDomainRule("mail.dev.github.com", [shallow, deep])).toBe(deep);
    expect(matchDomainRule("mail.dev.github.com", [deep, shallow])).toBe(deep);
  });

  it("exact rule only matches its own domain", () => {
    const exact = rule("exact", "github.com", false);
    expect(matchDomainRule("news.github.com", [exact])).toBeNull();
  });
});

describe("domainScopeOptions", () => {
  it("offers exact first, then one wildcard per parent suffix with >= 2 labels", () => {
    expect(domainScopeOptions("mail.dev.github.com")).toEqual([
      { pattern: "mail.dev.github.com", includeSubdomains: false },
      { pattern: "dev.github.com", includeSubdomains: true },
      { pattern: "github.com", includeSubdomains: true },
    ]);
  });

  it("never offers a TLD wildcard for a two-label domain", () => {
    expect(domainScopeOptions("github.com")).toEqual([
      { pattern: "github.com", includeSubdomains: false },
    ]);
  });

  it("normalizes to lowercase", () => {
    expect(domainScopeOptions("News.GitHub.Com")).toEqual([
      { pattern: "news.github.com", includeSubdomains: false },
      { pattern: "github.com", includeSubdomains: true },
    ]);
  });
});
