// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { ThreadPageContent } from "@/components/mail/thread-page-content";

/**
 * The reply target lives in ThreadPageContent (plan 055): a card's Reply
 * button re-targets the composer (keyed per target so each keeps its own
 * draft), dispatches the same event the `r` / `a` shortcuts use, and the
 * composer's draft presence feeds the card badge.
 */

let composerMounts = 0;
let lastComposerProps: Record<string, unknown> = {};

vi.mock("@/components/mail/reply-composer", () => ({
  ReplyComposer: (props: Record<string, unknown>) => {
    composerMounts += 1;
    lastComposerProps = props;
    return (
      <div data-testid="composer">
        composer for {String(props.messageId)} → {String(props.replyToName)}
      </div>
    );
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/imbox/a1",
}));
vi.mock("@/components/calendar/meeting-card", () => ({ MeetingCard: () => null }));
vi.mock("@/components/mail/email-body-frame", () => ({ EmailBodyFrame: () => null }));
vi.mock("@/components/mail/attachment-list", () => ({ AttachmentList: () => null }));
vi.mock("@/components/mail/blocked-images-banner", () => ({
  BlockedImagesBanner: () => null,
}));

const ME = "me@mine.example";

function message(id: string, from: string, name: string) {
  return {
    id,
    messageId: `<${id}@x>`,
    inReplyTo: null,
    subject: "Offer",
    fromAddress: from,
    fromName: name,
    toAddresses: [ME],
    ccAddresses: [],
    receivedAt: new Date("2026-09-01T10:00:00Z"),
    sentAt: new Date("2026-09-01T10:00:00Z"),
    textBody: "Hello",
    htmlBody: null,
    isRead: true,
    isAnswered: false,
    snippet: "Hello",
    sender: null,
    attachments: [],
    meeting: null,
  };
}

function options(id: string, address: string, name: string, extraTo: string[] = []) {
  return {
    messageId: id,
    replyToAddress: address,
    replyToName: name,
    replyAllExtraTo: extraTo,
    replyAllCc: [],
    subject: "Offer",
    rfcMessageId: `<${id}@x>`,
    references: [],
  };
}

function renderThread() {
  return render(
    <ThreadPageContent
      userId="u1"
      initialMessages={[
        message("a1", "anna@corp-a.example", "Anna"),
        message("b1", "bo@corp-b.example", "Bo"),
      ]}
      currentUserEmail={ME}
      userEmails={[ME]}
      replyOptions={{
        a1: options("a1", "anna@corp-a.example", "Anna", ["x@corp-a.example"]),
        b1: options("b1", "bo@corp-b.example", "Bo"),
      }}
      initialReplyTargetId="b1"
      emailConnectionId="conn-1"
      userTimezone="UTC"
    />,
  );
}

describe("ThreadPageContent reply target", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    composerMounts = 0;
    lastComposerProps = {};
  });

  it("re-targets and re-keys the composer from a card's Reply button and fires the reply event", () => {
    const onReply = vi.fn();
    const onReplyAll = vi.fn();
    window.addEventListener("keyboard-reply", onReply);
    window.addEventListener("keyboard-reply-all", onReplyAll);

    const { container } = renderThread();
    expect(screen.getByTestId("composer").textContent).toContain("b1 → Bo");
    const mountsBefore = composerMounts;

    // Expand Anna's (collapsed) card, then reply-all from it.
    fireEvent.click(screen.getByText("Anna"));
    const actions = container.querySelector("[data-card-actions]") as HTMLElement;
    fireEvent.click(
      Array.from(actions.querySelectorAll("button")).find(
        (b) => b.textContent === "Reply all",
      )!,
    );

    expect(screen.getByTestId("composer").textContent).toContain("a1 → Anna");
    expect(composerMounts).toBeGreaterThan(mountsBefore);
    expect(lastComposerProps.replyAllExtraTo).toEqual(["x@corp-a.example"]);
    expect(onReplyAll).toHaveBeenCalledTimes(1);
    expect(onReply).not.toHaveBeenCalled();

    window.removeEventListener("keyboard-reply", onReply);
    window.removeEventListener("keyboard-reply-all", onReplyAll);
  });

  it("shows the draft badge on the target card while the composer reports content", () => {
    const { container } = renderThread();
    const badge = () => container.querySelector('[data-card-badge="draft"]');
    expect(badge()).toBeNull();

    act(() => {
      (lastComposerProps.onDraftPresence as (has: boolean) => void)(true);
    });
    expect(badge()).not.toBeNull();

    act(() => {
      (lastComposerProps.onDraftPresence as (has: boolean) => void)(false);
    });
    expect(badge()).toBeNull();
  });

  it("marks the target card replied as soon as a reply is sent", () => {
    const { container } = renderThread();
    expect(container.querySelector('[data-card-badge="replied"]')).toBeNull();

    act(() => {
      (lastComposerProps.onSent as (body: string) => void)("Thanks Bo");
    });

    expect(container.querySelectorAll('[data-card-badge="replied"]')).toHaveLength(1);
  });
});
