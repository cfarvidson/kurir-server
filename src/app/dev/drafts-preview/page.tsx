import { notFound } from "next/navigation";
import { PageMasthead } from "@/components/layout/page-masthead";
import { DraftsList, type DraftListItem } from "@/components/mail/drafts-list";

const fixtures: DraftListItem[] = [
  {
    type: "REPLY",
    contextMessageId: "msg-maya",
    to: "Maya Lindqvist",
    subject: "Re: Saturday climb?",
    snippet: "Yes - let's leave at eight and take the early train.",
    updatedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
    href: "#",
  },
  {
    type: "NEW",
    contextMessageId: "uuid-jonas",
    to: "jonas.ek@fastmail.com",
    subject: "Notes from Tuesday",
    snippet: "Quick recap of what we decided about the porch roof.",
    updatedAt: new Date(Date.now() - 80 * 60_000).toISOString(),
    href: "#",
  },
  {
    type: "FORWARD",
    contextMessageId: "msg-stripe",
    to: "sara.holm@gmail.com",
    subject: "Fwd: Receipt from Stripe",
    snippet: "Fyi - this is the one from the domain renewal.",
    updatedAt: new Date(Date.now() - 26 * 60 * 60_000).toISOString(),
    href: "#",
  },
  {
    type: "NEW",
    contextMessageId: "uuid-empty",
    to: "",
    subject: "",
    snippet: "Started this and never picked a recipient.",
    updatedAt: new Date(Date.now() - 50 * 60 * 60_000).toISOString(),
    href: "#",
  },
];

export default async function DraftsPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ empty?: string; dark?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const { empty, dark } = await searchParams;
  const drafts = empty ? [] : fixtures;

  return (
    <div className={dark ? "dark" : undefined}>
      <div className="min-h-screen bg-background text-foreground">
        <div className="mx-auto flex min-h-screen max-w-3xl flex-col">
          <PageMasthead
            eyebrow="Outbound"
            title="Drafts"
            meta={
              drafts.length === 0
                ? undefined
                : drafts.length === 1
                  ? "1 draft"
                  : `${drafts.length} drafts`
            }
          />
          <div className="flex-1">
            <DraftsList drafts={drafts} userId="preview" />
          </div>
        </div>
      </div>
    </div>
  );
}
