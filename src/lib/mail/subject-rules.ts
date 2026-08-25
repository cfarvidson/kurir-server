/**
 * Subject screening rules (kurir-ios#48): pure matching/precedence logic and
 * the scope-option generator shared by the screener UI surfaces.
 *
 * Matching semantics:
 * - A rule matches when the sender falls inside its scope AND the message
 *   subject contains the rule's pattern (both compared case-insensitively;
 *   `scopeValue` and `pattern` are stored normalized lowercase).
 * - Scopes: ADDRESS = exact sender address, DOMAIN = exact domain,
 *   SUBDOMAINS = the domain itself and arbitrarily deep subdomains.
 * - Precedence: a matching subject rule beats the sender's own decision
 *   (enforced by callers); among matching rules the most specific scope wins
 *   (ADDRESS > DOMAIN > SUBDOMAINS), then the longest scopeValue, then the
 *   longest pattern, then the first rule in the caller's order (loaders order
 *   by createdAt asc, so the oldest rule wins a full tie).
 */

export type SubjectRuleScopeKind = "ADDRESS" | "DOMAIN" | "SUBDOMAINS";

// Local copy of sync-service's extractDomain: this module is imported by
// client components, so it must stay dependency-free (like domain-rules.ts).
function extractDomain(email: string): string {
  return email.split("@")[1] || email;
}

export interface SubjectRuleLike {
  scope: SubjectRuleScopeKind;
  scopeValue: string;
  pattern: string;
}

export interface SubjectScopeOption {
  scope: SubjectRuleScopeKind;
  scopeValue: string;
}

const SCOPE_SPECIFICITY: Record<SubjectRuleScopeKind, number> = {
  ADDRESS: 2,
  DOMAIN: 1,
  SUBDOMAINS: 0,
};

/** True when `rule`'s scope covers the sender address (case-insensitive). */
export function scopeMatchesSender(
  senderEmail: string,
  rule: SubjectRuleLike,
): boolean {
  const email = senderEmail.trim().toLowerCase();
  const domain = extractDomain(email);
  switch (rule.scope) {
    case "ADDRESS":
      return email === rule.scopeValue;
    case "DOMAIN":
      return domain === rule.scopeValue;
    case "SUBDOMAINS":
      return (
        domain === rule.scopeValue ||
        domain.endsWith("." + rule.scopeValue)
      );
  }
}

/** True when `rule` covers this sender + subject (case-insensitive). */
export function subjectRuleMatches(
  senderEmail: string,
  subject: string | null | undefined,
  rule: SubjectRuleLike,
): boolean {
  if (!rule.pattern) return false;
  if (!scopeMatchesSender(senderEmail, rule)) return false;
  return (subject ?? "").toLowerCase().includes(rule.pattern.toLowerCase());
}

/**
 * Pick the winning rule for a sender + subject, or null. Most specific scope
 * wins (ADDRESS > DOMAIN > SUBDOMAINS), then longest scopeValue, then longest
 * pattern, then the first matching rule in the caller's order.
 */
export function matchSubjectRule<T extends SubjectRuleLike>(
  senderEmail: string,
  subject: string | null | undefined,
  rules: T[],
): T | null {
  let best: T | null = null;
  for (const rule of rules) {
    if (!subjectRuleMatches(senderEmail, subject, rule)) continue;
    if (
      !best ||
      SCOPE_SPECIFICITY[rule.scope] > SCOPE_SPECIFICITY[best.scope] ||
      (SCOPE_SPECIFICITY[rule.scope] === SCOPE_SPECIFICITY[best.scope] &&
        (rule.scopeValue.length > best.scopeValue.length ||
          (rule.scopeValue.length === best.scopeValue.length &&
            rule.pattern.length > best.pattern.length)))
    ) {
      best = rule;
    }
  }
  return best;
}

/**
 * Generate the scope options offered for a sender address: the exact address
 * first, then the exact domain, then one subdomain-wildcard per parent suffix
 * as long as the suffix keeps at least two labels (stops before the TLD, so
 * `*.com` is never offered). Mirrors `domainScopeOptions` for domains.
 */
export function subjectScopeOptions(senderEmail: string): SubjectScopeOption[] {
  const email = senderEmail.trim().toLowerCase();
  const domain = extractDomain(email);
  const options: SubjectScopeOption[] = [
    { scope: "ADDRESS", scopeValue: email },
  ];
  if (domain && domain !== email) {
    options.push({ scope: "DOMAIN", scopeValue: domain });
    const labels = domain.split(".");
    for (let i = 1; i <= labels.length - 2; i++) {
      options.push({
        scope: "SUBDOMAINS",
        scopeValue: labels.slice(i).join("."),
      });
    }
  }
  return options;
}
