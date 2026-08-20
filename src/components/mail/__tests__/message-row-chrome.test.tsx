// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { formatDistanceToNow, formatSnoozeUntil } from "@/lib/date";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/mail/optimistic-archive", () => ({
  usePendingArchiveFilter: () => () => false,
}));
vi.mock("@/actions/archive", () => ({
  archiveConversation: vi.fn(),
  unarchiveConversation: vi.fn(),
}));
vi.mock("@/actions/snooze", () => ({
  snoozeConversation: vi.fn(),
  unsnoozeConversation: vi.fn(),
}));
vi.mock("@/actions/follow-up", () => ({ setFollowUp: vi.fn() }));
vi.mock("@/actions/read-status", () => ({ toggleReadStatus: vi.fn() }));

import { MessageRow } from "../message-list";

const followUpAt = new Date("2026-08-21T08:00:00.000Z");

const base = {
  id: "m1",
  subject: "Hello",
  snippet: "First line of the snippet that should wrap onto two lines in the row.",
  fromAddress: "ada@x.y",
  fromName: "Ada",
  receivedAt: new Date(),
  isRead: true,
  hasAttachments: true,
  threadId: "t1",
  threadCount: 3,
  snoozedUntil: null as Date | null,
  followUpAt,
  isFollowUp: true,
  sender: { displayName: "Ada", email: "ada@x.y", unthread: false },
};

function paperclipIcon(): Element | null {
  return (
    document.querySelector("svg.lucide-paperclip") ??
    document.querySelector('svg[class*="paperclip"]') ??
    document.querySelector('svg[aria-label="Attachment"]')
  );
}

describe("MessageRow chrome", () => {
  it("shows ·N, a paperclip, and follow-up time", () => {
    render(
      <MessageRow
        message={base}
        basePath="/imbox"
        showArchiveAction={false}
        showFollowUpAction
      />,
    );
    expect(screen.getByText("·3")).toBeDefined();
    expect(paperclipIcon()).not.toBeNull();
    expect(screen.getByText(/follow/i)).toBeDefined();
    expect(
      screen.getByText(formatSnoozeUntil(followUpAt)),
    ).toBeDefined();
  });

  it("clamps the snippet to two lines", () => {
    const { container } = render(
      <MessageRow
        message={base}
        basePath="/imbox"
        showArchiveAction={false}
      />,
    );
    const snippet = container.querySelector(".line-clamp-2");
    expect(snippet?.textContent).toContain("First line of the snippet");
  });

  it("shows To: recipients as the primary line on Sent", () => {
    render(
      <MessageRow
        message={{
          ...base,
          fromName: "Me",
          fromAddress: "me@x.y",
          toAddresses: ["ada@x.y"],
          sender: null,
          followUpAt: null,
          hasAttachments: false,
          threadCount: 1,
        }}
        list="sent"
        basePath="/sent"
        showArchiveAction={false}
      />,
    );
    expect(screen.getByText("To: ada@x.y")).toBeDefined();
  });

  it("shows a past follow-up time, not snooze waking-up copy", () => {
    const overdue = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const { container } = render(
      <MessageRow
        message={{
          ...base,
          followUpAt: overdue,
          hasAttachments: false,
          threadCount: 1,
        }}
        basePath="/follow-up"
        showArchiveAction={false}
      />,
    );
    expect(container.textContent).not.toMatch(/waking up/i);
    expect(screen.getByText(formatDistanceToNow(overdue))).toBeDefined();
  });
});
