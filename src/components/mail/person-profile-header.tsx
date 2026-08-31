"use client";

import { Phone, Briefcase, Building2 } from "lucide-react";
import type { SourcedValue } from "@/lib/mail/person-details";
import { cn } from "@/lib/utils";

/** The JSON shape `getContactContext().profile` carries for the header. */
export interface PersonProfileHeaderData {
  phones: SourcedValue[];
  title: SourcedValue | null;
  company: SourcedValue | null;
}

function SourceTag({ source }: { source: SourcedValue["source"] }) {
  if (source !== "signature") return null;
  return (
    <span className="eyebrow ml-1.5 text-[9px] text-muted-foreground/80">
      from signature
    </span>
  );
}

function DetailRow({
  icon: Icon,
  item,
  href,
}: {
  icon: typeof Phone;
  item: SourcedValue;
  href?: string;
}) {
  const body = (
    <span className="truncate">
      {item.value}
      <SourceTag source={item.source} />
    </span>
  );
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs">
      <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
      {href ? (
        <a
          href={href}
          className="min-w-0 truncate text-foreground transition-colors hover:text-primary"
        >
          {body}
        </a>
      ) : (
        <span className="min-w-0 truncate text-foreground">{body}</span>
      )}
    </div>
  );
}

/**
 * Contact details at the top of the person pane: phones, title, company.
 * Values from a Contact record show plain; values lifted from a signature
 * carry a "from signature" tag. Renders nothing when there is nothing.
 * Client component fed by the JSON of `getContactContext`.
 */
export function PersonProfileHeader({
  profile,
  className,
}: {
  profile: PersonProfileHeaderData;
  className?: string;
}) {
  const hasAny =
    profile.phones.length > 0 || profile.title !== null || profile.company !== null;
  if (!hasAny) return null;

  return (
    <div className={cn("space-y-1", className)} data-testid="person-profile-header">
      {profile.title && <DetailRow icon={Briefcase} item={profile.title} />}
      {profile.company && <DetailRow icon={Building2} item={profile.company} />}
      {profile.phones.map((phone, index) => (
        <DetailRow
          key={`${index}-${phone.value}`}
          icon={Phone}
          item={phone}
          href={`tel:${phone.value.replace(/[^\d+]/g, "")}`}
        />
      ))}
    </div>
  );
}
