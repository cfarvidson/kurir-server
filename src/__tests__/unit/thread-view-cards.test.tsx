// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { ThreadView, branchesByCard } from "@/components/mail/thread-view";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/imbox/a1",
}));

// Body/attachment/meeting renderers pull in server actions (next-auth);
// the cards under test render plain-text bodies only.
vi.mock("@/components/calendar/meeting-card", () => ({
  MeetingCard: () => null,
}));
vi.mock("@/components/mail/email-body-frame", () => ({
  EmailBodyFrame: () => null,
}));
vi.mock("@/components/mail/attachment-list", () => ({
  AttachmentList: () => null,
}));
vi.mock("@/components/mail/blocked-images-banner", () => ({
  BlockedImagesBanner: () => null,
}));

const ME = "me@mine.example";

function message(partial: Record<string, unknown> & { id: string }) {
  return {
    messageId: `<${partial.id}@x>`,
    inReplyTo: null,
    subject: "Offer",
    fromAddress: "anna@corp-a.example",
    fromName: "Anna",
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
    ...partial,
  };
}

describe("ThreadView per-card reply (plan 055)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("puts Reply / Reply all / Forward on the expanded card and reports the card id", () => {
    const onReply = vi.fn();
    render(
      <ThreadView
        messages={[
          message({ id: "a1" }),
          message({
            id: "b1",
            fromAddress: "bo@corp-b.example",
            fromName: "Bo",
            toAddresses: [ME, "anna@corp-a.example"],
          }),
        ]}
        currentUserEmail={ME}
        replyTargetId="b1"
        replyAllIds={new Set(["b1"])}
        onReply={onReply}
      />,
    );

    // Only the last card is expanded, so only it shows actions.
    const actions = screen.getAllByText("Reply", { selector: "button" });
    expect(actions).toHaveLength(1);
    expect(actions[0].getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(actions[0]);
    expect(onReply).toHaveBeenCalledWith("b1", "reply");

    fireEvent.click(screen.getByText("Reply all", { selector: "button" }));
    expect(onReply).toHaveBeenCalledWith("b1", "replyAll");

    fireEvent.click(screen.getByText("Forward", { selector: "button" }));
    expect(push).toHaveBeenCalledWith("/compose?forward=b1&from=%2Fimbox%2Fa1");
  });

  it("offers Reply on the user's own card too, and hides Reply all without extra recipients", () => {
    const onReply = vi.fn();
    render(
      <ThreadView
        messages={[
          message({ id: "a1" }),
          message({
            id: "s1",
            fromAddress: ME,
            fromName: null,
            toAddresses: ["anna@corp-a.example"],
            inReplyTo: "<a1@x>",
          }),
        ]}
        currentUserEmail={ME}
        recipientNames={{ "anna@corp-a.example": "Corp A" }}
        onReply={onReply}
      />,
    );

    expect(screen.getByText("You → Corp A")).toBeTruthy();
    fireEvent.click(screen.getByText("Reply", { selector: "button" }));
    expect(onReply).toHaveBeenCalledWith("s1", "reply");
    expect(screen.queryByText("Reply all", { selector: "button" })).toBeNull();
  });

  it("marks replied and drafted cards, collapsed or not", () => {
    const { container } = render(
      <ThreadView
        messages={[
          message({ id: "a1" }),
          message({ id: "b1", fromAddress: "bo@corp-b.example", fromName: "Bo" }),
        ]}
        currentUserEmail={ME}
        answeredIds={new Set(["a1"])}
        draftIds={new Set(["b1"])}
      />,
    );

    expect(container.querySelectorAll('[data-card-badge="replied"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-card-badge="draft"]')).toHaveLength(1);
  });

  it("lists branches under the broadcast card they replied to", () => {
    const { container } = render(
      <ThreadView
        messages={[
          message({
            id: "m0",
            fromAddress: ME,
            fromName: null,
            toAddresses: [ME],
            bccAddresses: ["a@x", "b@x", "c@x"],
          }),
        ]}
        currentUserEmail={ME}
        branches={[
          {
            threadId: "<a1@x>",
            href: "/imbox/a1",
            senderName: "Corp A",
            count: 2,
            rootInReplyTo: "<m0@x>",
          },
          {
            threadId: "<b1@x>",
            href: "/imbox/b1",
            senderName: "Bo",
            count: 1,
            rootInReplyTo: "<m0@x>",
          },
        ]}
      />,
    );

    expect(screen.getByText("You → 3 recipients")).toBeTruthy();
    const list = container.querySelector("[data-thread-branches]") as HTMLElement;
    expect(list.textContent).toContain("2 replies opened as separate threads");
    expect(
      within(list).getByText("Corp A").closest("a")?.getAttribute("href"),
    ).toBe("/imbox/a1");
    expect(within(list).getByText("Bo").closest("a")?.getAttribute("href")).toBe(
      "/imbox/b1",
    );
  });
});

describe("branchesByCard", () => {
  const isOwn = (a: string) => a === ME;
  const branch = (rootInReplyTo: string | null) => ({
    threadId: "t",
    href: "/imbox/x",
    senderName: "X",
    count: 1,
    rootInReplyTo,
  });

  it("hangs a branch under the card it replied to, else the last own card, else the first", () => {
    const msgs = [
      message({ id: "m0", fromAddress: ME }),
      message({ id: "a1" }),
      message({ id: "s1", fromAddress: ME }),
    ];
    expect([...branchesByCard(msgs, [branch("<m0@x>")], isOwn).keys()]).toEqual(["m0"]);
    expect([...branchesByCard(msgs, [branch("<gone@x>")], isOwn).keys()]).toEqual(["s1"]);
    expect(
      [...branchesByCard([message({ id: "a1" })], [branch(null)], isOwn).keys()],
    ).toEqual(["a1"]);
    expect(branchesByCard(msgs, [], isOwn).size).toBe(0);
  });
});
