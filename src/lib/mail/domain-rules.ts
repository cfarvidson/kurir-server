/**
 * Domain screening rules (plan 033): pure matching/precedence logic and the
 * scope-option generator shared by the screener UI surfaces.
 *
 * Matching semantics:
 * - Exact rule (`includeSubdomains: false`) matches when the sender domain
 *   equals the pattern.
 * - Wildcard rule (`includeSubdomains: true`) matches the pattern itself and
 *   arbitrarily deep subdomains (`*.github.com` matches `mail.dev.github.com`).
 * - Precedence: an existing Sender decision always wins (enforced by callers);
 *   among rules, exact beats wildcard, and among wildcard matches the longest
 *   pattern wins.
 */

export interface DomainRuleLike {
  pattern: string;
  includeSubdomains: boolean;
}

export interface DomainScopeOption {
  pattern: string;
  includeSubdomains: boolean;
}

/** True when `rule` covers `senderDomain` (case-insensitive). */
export function patternMatchesDomain(
  senderDomain: string,
  rule: DomainRuleLike,
): boolean {
  const domain = senderDomain.trim().toLowerCase();
  if (domain === rule.pattern) return true;
  return rule.includeSubdomains && domain.endsWith("." + rule.pattern);
}

/**
 * Pick the winning rule for a sender domain, or null. Exact rule > wildcard
 * rule; among wildcard matches the longest pattern wins.
 */
export function matchDomainRule<T extends DomainRuleLike>(
  senderDomain: string,
  rules: T[],
): T | null {
  let best: T | null = null;
  for (const rule of rules) {
    if (!patternMatchesDomain(senderDomain, rule)) continue;
    if (!rule.includeSubdomains) return rule; // exact — cannot be beaten
    if (!best || rule.pattern.length > best.pattern.length) {
      best = rule;
    }
  }
  return best;
}

/**
 * Generate the scope options offered for a sender domain: the exact domain
 * first, then one wildcard per parent suffix as long as the suffix keeps at
 * least two labels (stops before the TLD, so `*.com` is never offered).
 */
export function domainScopeOptions(senderDomain: string): DomainScopeOption[] {
  const domain = senderDomain.trim().toLowerCase();
  const options: DomainScopeOption[] = [
    { pattern: domain, includeSubdomains: false },
  ];
  const labels = domain.split(".");
  for (let i = 1; i <= labels.length - 2; i++) {
    options.push({
      pattern: labels.slice(i).join("."),
      includeSubdomains: true,
    });
  }
  return options;
}
