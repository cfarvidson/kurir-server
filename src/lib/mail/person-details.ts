import type { SignatureDetails } from "@/lib/mail/signature-extract";

/**
 * Contact details as the person profile shows them: each value carries
 * where it came from. A Contact record is the user's own data and wins;
 * the signature fills the gaps. Pure; shared by the profile endpoint and
 * the web pane. Today Contact stores a name only, so the merge is generic
 * for phones/title/company but in practice those come from the signature.
 */

export type ProfileSource = "contact" | "signature";

export interface SourcedValue {
  value: string;
  source: ProfileSource;
}

export interface ContactDetails {
  name?: string;
  phones: string[];
  title?: string;
  company?: string;
}

export interface MergedProfileDetails {
  name: SourcedValue | null;
  phones: SourcedValue[];
  title: SourcedValue | null;
  company: SourcedValue | null;
}

export function mergeContactDetails(
  contact: ContactDetails | null,
  signature: SignatureDetails,
): MergedProfileDetails {
  const pick = (
    fromContact: string | undefined,
    fromSignature: string | undefined,
  ): SourcedValue | null => {
    if (fromContact && fromContact.trim()) {
      return { value: fromContact.trim(), source: "contact" };
    }
    if (fromSignature && fromSignature.trim()) {
      return { value: fromSignature.trim(), source: "signature" };
    }
    return null;
  };
  const phones: SourcedValue[] =
    contact && contact.phones.length > 0
      ? contact.phones.map((value) => ({ value, source: "contact" as const }))
      : signature.phones.map((value) => ({
          value,
          source: "signature" as const,
        }));
  return {
    name: pick(contact?.name, undefined),
    phones,
    title: pick(contact?.title, signature.title),
    company: pick(contact?.company, signature.company),
  };
}
