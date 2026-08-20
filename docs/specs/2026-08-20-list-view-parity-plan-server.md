# List view parity (kurir-server) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web mail lists, search, select bar, Sent, and Files match the shared list contract so iOS/macOS can consume the same search `category` and the same row/actions/copy.

**Architecture:** A pure `list-contract.ts` module is the source of truth for row chrome, action flags, empty copy, and search SQL. Pages and `MessageRow` call it. `GET /api/mobile/search?category=` reuses the same SQL. UI wiring is a second pass after the helpers are green.

**Tech Stack:** Next.js 16, Vitest, Prisma, existing `InfiniteMessageList` / `MessageRow` / `SearchResults`.

**Spec:** `docs/specs/2026-08-20-list-view-parity-design.md`

## Global Constraints

- UI strings in English. No em dashes in comments or copy.
- DESIGN.md: no avatars, no pill badges, terracotta unread tick, `tabular-nums`, Playfair only on mastheads/empty titles.
- TDD: failing test first, watch it fail, then minimal code. Never `git add -A`. Stage explicit paths.
- Run tests with `pnpm test <file>`.
- `GET /api/mobile/search` without `category` stays unfiltered (back-compat).
- Search hits stay per-message. Do not collapse them. Do not show `·N` on search rows.
- Reply Later on web is already a focus stack. Do not turn it into `MessageRow`.
- Contacts on web already have A-O sections and category filters. Do not rework them.
- Server search `category` must ship before native starts sending it (this plan is first).

---

## Files

- Create: `src/lib/mail/list-contract.ts`
- Create: `src/__tests__/unit/list-contract.test.ts`
- Modify: `src/lib/mail/search.ts`
- Modify: `src/app/api/mobile/search/route.ts`
- Modify: `src/__tests__/integration/mobile-search.test.ts`
- Modify: `src/lib/mail/messages.ts`
- Modify: `src/__tests__/unit/category-filters.test.ts`
- Modify: `src/app/api/messages/route.ts`
- Modify: `src/components/mail/message-list.tsx`
- Modify: `src/components/mail/infinite-message-list.tsx`
- Modify: `src/components/mail/search-results.tsx`
- Modify: `src/components/mail/selection-action-bar.tsx`
- Modify: `src/app/(mail)/imbox/page.tsx`
- Modify: `src/app/(mail)/feed/page.tsx`
- Modify: `src/app/(mail)/paper-trail/page.tsx`
- Modify: `src/app/(mail)/snoozed/page.tsx`
- Modify: `src/app/(mail)/follow-up/page.tsx`
- Modify: `src/app/(mail)/archive/page.tsx`
- Modify: `src/app/(mail)/sent/page.tsx`
- Modify: `src/lib/mail/files.ts`
- Modify: `src/components/mail/files-list.tsx`
- Modify: `src/components/mail/drafts-list.tsx`
- Modify: `src/actions/read-status.ts` (bulk)
- Modify: `src/actions/senders.ts` (bulk reject used by select bar)
- Modify: `src/app/api/mobile/scheduled/[id]/route.ts`
- Modify: `src/__tests__/integration/mobile-scheduled.test.ts`

---

### Task 1: Pure list contract

**Files:**
- Create: `src/lib/mail/list-contract.ts`
- Test: `src/__tests__/unit/list-contract.test.ts`

**Interfaces:**
- Consumes: `Prisma` from `@prisma/client`
- Produces:

```ts
export type MailListId =
  | "imbox"
  | "feed"
  | "paper-trail"
  | "archive"
  | "snoozed"
  | "follow-up"
  | "sent"
  | "reply-later";

export type SearchCategory = Exclude<MailListId, "reply-later">;

export type ListActionSet = {
  followUp: boolean;
  snooze: boolean;
  archive: boolean;
  unarchive: boolean;
};

export type EmptyCopy = { title: string; description: string };

export function threadCountLabel(count: number | undefined): string | null;
export function primaryLine(input: {
  list: MailListId;
  displayName?: string | null;
  fromName?: string | null;
  fromAddress: string;
  toAddresses?: string[];
  cc?: string | null;
}): string;
export function listActionSet(list: MailListId): ListActionSet;
export function emptyCopy(list: MailListId): EmptyCopy;
export function showsSections(list: MailListId): boolean;
export function showsSearch(list: MailListId): boolean;
export function searchCategoryFilter(
  category: SearchCategory | null,
): import("@prisma/client").Prisma.Sql;
export function uniqueBlockSenderIds(
  rows: { senderId: string | null; fromAddress: string }[],
  isOwn: (email: string) => boolean,
): string[];
export function bulkReadMarksRead(rows: { isRead: boolean }[]): boolean;
```

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/unit/list-contract.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  threadCountLabel,
  primaryLine,
  listActionSet,
  emptyCopy,
  showsSections,
  showsSearch,
  searchCategoryFilter,
  uniqueBlockSenderIds,
  bulkReadMarksRead,
} from "@/lib/mail/list-contract";

describe("threadCountLabel", () => {
  it("returns ·N only when count is greater than 1", () => {
    expect(threadCountLabel(undefined)).toBeNull();
    expect(threadCountLabel(1)).toBeNull();
    expect(threadCountLabel(4)).toBe("·4");
  });
});

describe("primaryLine", () => {
  it("uses displayName then fromName then fromAddress on inbound lists", () => {
    expect(
      primaryLine({
        list: "imbox",
        displayName: "Ada",
        fromName: "A. Lovelace",
        fromAddress: "ada@x.y",
      }),
    ).toBe("Ada");
  });

  it("uses To: addresses on Sent, then Cc, then Bcc only", () => {
    expect(
      primaryLine({
        list: "sent",
        fromAddress: "me@x.y",
        toAddresses: ["ada@x.y", "al@x.y"],
      }),
    ).toBe("To: ada@x.y, al@x.y");
    expect(
      primaryLine({
        list: "sent",
        fromAddress: "me@x.y",
        toAddresses: [],
        cc: "cc@x.y",
      }),
    ).toBe("Cc: cc@x.y");
    expect(
      primaryLine({
        list: "sent",
        fromAddress: "me@x.y",
        toAddresses: [],
      }),
    ).toBe("Bcc only");
  });
});

describe("listActionSet", () => {
  it("matches the spec matrix", () => {
    expect(listActionSet("imbox")).toEqual({
      followUp: true,
      snooze: true,
      archive: true,
      unarchive: false,
    });
    expect(listActionSet("follow-up")).toEqual({
      followUp: true,
      snooze: false,
      archive: true,
      unarchive: false,
    });
    expect(listActionSet("sent")).toEqual({
      followUp: true,
      snooze: false,
      archive: false,
      unarchive: false,
    });
    expect(listActionSet("archive")).toEqual({
      followUp: true,
      snooze: false,
      archive: false,
      unarchive: true,
    });
    expect(listActionSet("reply-later")).toEqual({
      followUp: false,
      snooze: false,
      archive: false,
      unarchive: false,
    });
  });
});

describe("emptyCopy", () => {
  it("uses the web strings from the spec table", () => {
    expect(emptyCopy("imbox")).toEqual({
      title: "Your Imbox is empty",
      description:
        "Approve senders in the Screener to see their emails here.",
    });
    expect(emptyCopy("reply-later")).toEqual({
      title: "All caught up",
      description: "Nothing left to reply to. Nice work.",
    });
  });
});

describe("showsSections / showsSearch", () => {
  it("sections only the three main lists", () => {
    expect(showsSections("imbox")).toBe(true);
    expect(showsSections("archive")).toBe(false);
    expect(showsSections("reply-later")).toBe(false);
  });

  it("search on seven lists, not Reply Later", () => {
    expect(showsSearch("imbox")).toBe(true);
    expect(showsSearch("sent")).toBe(true);
    expect(showsSearch("reply-later")).toBe(false);
  });
});

describe("searchCategoryFilter", () => {
  it("returns empty SQL when category is omitted", () => {
    expect(searchCategoryFilter(null)).toEqual(Prisma.empty);
  });

  it("adds isReplyLater = false on the three main lists", () => {
    const sql = searchCategoryFilter("imbox").strings.join("");
    expect(sql).toContain('"isInImbox" = true');
    expect(sql).toContain('"isSnoozed" = false');
    expect(sql).toContain('"isReplyLater" = false');
  });

  it("filters Sent via the sent folder specialUse", () => {
    const sql = searchCategoryFilter("sent").strings.join("");
    expect(sql).toContain('"specialUse"');
    expect(sql).toContain("sent");
  });
});

describe("uniqueBlockSenderIds", () => {
  it("drops own addresses and duplicates, keeps order", () => {
    const own = (email: string) => email === "me@x.y";
    expect(
      uniqueBlockSenderIds(
        [
          { senderId: "s1", fromAddress: "ada@x.y" },
          { senderId: "s1", fromAddress: "ada@x.y" },
          { senderId: "s2", fromAddress: "me@x.y" },
          { senderId: null, fromAddress: "al@x.y" },
        ],
        own,
      ),
    ).toEqual(["s1"]);
  });
});

describe("bulkReadMarksRead", () => {
  it("is true when any selected row is unread", () => {
    expect(bulkReadMarksRead([{ isRead: true }, { isRead: false }])).toBe(
      true,
    );
    expect(bulkReadMarksRead([{ isRead: true }])).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/__tests__/unit/list-contract.test.ts`

Expected: FAIL, cannot find module `@/lib/mail/list-contract`

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/mail/list-contract.ts` implementing the signatures above. `searchCategoryFilter("sent")` must be:

```ts
Prisma.sql`AND EXISTS (
  SELECT 1 FROM "Folder" f
  WHERE f.id = "Message"."folderId" AND f."specialUse" = 'sent'
)`
```

`searchCategoryFilter(null)` returns `Prisma.empty`.

Feed / paper-trail SQL must also include `"isReplyLater" = false` (today's page SQL does not).

- [ ] **Step 4: Run tests and make sure they pass**

Run: `pnpm test src/__tests__/unit/list-contract.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/mail/list-contract.ts src/__tests__/unit/list-contract.test.ts
git commit -m "feat: add shared list contract helpers"
```

---

### Task 2: Mobile search category param

**Files:**
- Modify: `src/app/api/mobile/search/route.ts`
- Modify: `src/__tests__/integration/mobile-search.test.ts`

**Interfaces:**
- Consumes: `searchCategoryFilter` from `@/lib/mail/list-contract`, `searchMessages` from `@/lib/mail/search`
- Produces: `GET /api/mobile/search?q=&category=&limit=` where `category` is optional `SearchCategory`. Unknown category -> 400 `{ error: "Invalid category" }`.

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/integration/mobile-search.test.ts`:

```ts
  it("passes an empty filter when category is omitted", async () => {
    await mockAuthed();
    const { searchMessages } = await import("@/lib/mail/search");
    vi.mocked(searchMessages).mockResolvedValue([]);
    const { GET } = await import("@/app/api/mobile/search/route");
    await GET(makeRequest({ q: "invoice" }));
    expect(searchMessages).toHaveBeenCalledWith(
      "user-1",
      "invoice",
      Prisma.empty,
      50,
    );
  });

  it("applies the list filter when category is a known list", async () => {
    await mockAuthed();
    const { searchMessages } = await import("@/lib/mail/search");
    const { searchCategoryFilter } = await import("@/lib/mail/list-contract");
    vi.mocked(searchMessages).mockResolvedValue([]);
    const { GET } = await import("@/app/api/mobile/search/route");
    await GET(makeRequest({ q: "invoice", category: "feed" }));
    expect(searchMessages).toHaveBeenCalledWith(
      "user-1",
      "invoice",
      searchCategoryFilter("feed"),
      50,
    );
  });

  it("returns 400 for an unknown category", async () => {
    await mockAuthed();
    const { GET } = await import("@/app/api/mobile/search/route");
    const res = await GET(makeRequest({ q: "invoice", category: "nope" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid category" });
  });
```

Add `import { Prisma } from "@prisma/client";` at the top of the test file if missing.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/__tests__/integration/mobile-search.test.ts`

Expected: FAIL, unknown category currently still searches (or the new tests error because the route ignores `category`)

- [ ] **Step 3: Write minimal implementation**

In `src/app/api/mobile/search/route.ts`, after parsing `q`:

```ts
import { searchCategoryFilter, type SearchCategory } from "@/lib/mail/list-contract";

const SEARCH_CATEGORIES = new Set<SearchCategory>([
  "imbox",
  "feed",
  "paper-trail",
  "archive",
  "snoozed",
  "follow-up",
  "sent",
]);

const categoryParam = req.nextUrl.searchParams.get("category");
if (categoryParam && !SEARCH_CATEGORIES.has(categoryParam as SearchCategory)) {
  return NextResponse.json({ error: "Invalid category" }, { status: 400 });
}
const category = (categoryParam as SearchCategory | null) ?? null;
const hits = await searchMessages(
  userId,
  q,
  searchCategoryFilter(category),
  limit,
);
```

- [ ] **Step 4: Run tests and make sure they pass**

Run: `pnpm test src/__tests__/integration/mobile-search.test.ts`

Expected: PASS (existing tests still pass: omitted category stays empty filter)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/mobile/search/route.ts src/__tests__/integration/mobile-search.test.ts
git commit -m "feat: filter mobile search by optional category"
```

---

### Task 3: Enrich search hits for row chrome

**Files:**
- Modify: `src/lib/mail/search.ts`
- Modify: `src/__tests__/unit/search-query.test.ts` (only if you add a SELECT-shape test; otherwise add `src/__tests__/unit/search-messages-select.test.ts`)

**Interfaces:**
- Consumes: none new
- Produces: `MessageSearchResult` also has `snoozedUntil: Date | null`, `followUpAt: Date | null`, `fromName` already present. The raw SQL SELECT adds `"snoozedUntil", "followUpAt"`.

Search stays per-message. Do not add `threadCount`.

- [ ] **Step 1: Write the failing test**

Add to a new `src/__tests__/unit/search-select.test.ts` that asserts the SELECT list in `search.ts` source, or mock `$queryRaw` and inspect. Simplest honest test: export the column list.

In `src/lib/mail/search.ts` export:

```ts
export const SEARCH_SELECT_COLUMNS = [
  "id",
  "subject",
  "snippet",
  "fromAddress",
  "fromName",
  "toAddresses",
  "receivedAt",
  "isRead",
  "hasAttachments",
  "snoozedUntil",
  "followUpAt",
] as const;
```

Use that array when building the SQL (join into the SELECT). Test:

```ts
import { describe, it, expect } from "vitest";
import { SEARCH_SELECT_COLUMNS } from "@/lib/mail/search";

it("selects snooze and follow-up times for list chrome", () => {
  expect(SEARCH_SELECT_COLUMNS).toContain("snoozedUntil");
  expect(SEARCH_SELECT_COLUMNS).toContain("followUpAt");
  expect(SEARCH_SELECT_COLUMNS).not.toContain("threadId");
});
```

This test will fail until the export exists.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/__tests__/unit/search-select.test.ts`

Expected: FAIL, cannot find `SEARCH_SELECT_COLUMNS`

- [ ] **Step 3: Write minimal implementation**

Add the columns to `MessageSearchResult` and the SQL SELECT. Build the SELECT from `SEARCH_SELECT_COLUMNS` so the test cannot drift from the query.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `pnpm test src/__tests__/unit/search-select.test.ts src/__tests__/unit/search-query.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/mail/search.ts src/__tests__/unit/search-select.test.ts
git commit -m "feat: return snooze and follow-up fields on search hits"
```

---

### Task 4: Wire SearchResults action flags

**Files:**
- Modify: `src/components/mail/search-results.tsx`
- Modify: `src/app/(mail)/imbox/page.tsx`
- Modify: `src/app/(mail)/feed/page.tsx`
- Modify: `src/app/(mail)/paper-trail/page.tsx`
- Modify: `src/app/(mail)/snoozed/page.tsx`
- Modify: `src/app/(mail)/follow-up/page.tsx`
- Modify: `src/app/(mail)/archive/page.tsx`
- Modify: `src/app/(mail)/sent/page.tsx`

**Interfaces:**
- Consumes: `listActionSet` from `@/lib/mail/list-contract`, `searchCategoryFilter`
- Produces: `SearchResults` accepts `showFollowUpAction` and `showUnarchiveAction` (archive already has `showArchiveAction` / `showSnoozeAction`). Each page passes the set for its list.

- [ ] **Step 1: Write the failing test**

There is no page-level test today. Add `src/__tests__/unit/search-results-flags.test.ts` that locks the mapping the pages must use:

```ts
import { describe, it, expect } from "vitest";
import { listActionSet, type MailListId } from "@/lib/mail/list-contract";

const searchable: MailListId[] = [
  "imbox",
  "feed",
  "paper-trail",
  "snoozed",
  "follow-up",
  "sent",
  "archive",
];

it("searchable lists expose follow-up except none that the matrix forbids", () => {
  for (const list of searchable) {
    expect(listActionSet(list).followUp).toBe(true);
  }
});

it("only Archive search unarchives", () => {
  expect(listActionSet("archive").unarchive).toBe(true);
  expect(listActionSet("imbox").unarchive).toBe(false);
});
```

That test passes from Task 1. The wiring still needs a component test so a missing prop fails.

Create `src/components/mail/__tests__/search-results.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/mail/search", () => ({
  searchMessages: vi.fn(async () => [
    {
      id: "m1",
      subject: "Hello",
      snippet: "Hi",
      fromAddress: "ada@x.y",
      fromName: "Ada",
      toAddresses: [],
      receivedAt: new Date(),
      isRead: true,
      hasAttachments: false,
      snoozedUntil: null,
      followUpAt: null,
    },
  ]),
}));
vi.mock("@/lib/mail/search-contacts", () => ({
  searchContacts: vi.fn(async () => []),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
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
vi.mock("@/lib/mail/optimistic-archive", () => ({
  usePendingArchiveFilter: () => () => false,
}));

import { SearchResults } from "../search-results";

it("forwards follow-up and unarchive to MessageList", async () => {
  const ui = await SearchResults({
    userId: "u1",
    query: "hello",
    categoryFilter: Prisma.empty,
    basePath: "/archive",
    showFollowUpAction: true,
    showUnarchiveAction: true,
  });
  render(ui);
  expect(screen.getByTitle("Follow up")).toBeDefined();
  expect(screen.getByTitle("Unarchive")).toBeDefined();
});
```

`SearchResults` is an async server component. `render(ui)` of the awaited element is the pattern used elsewhere if any; if this is awkward, assert on the props type by making `SearchResults` pass the flags into `MessageList` and unit-test a tiny helper:

```ts
export function searchActionProps(list: MailListId) {
  const set = listActionSet(list);
  return {
    showFollowUpAction: set.followUp,
    showSnoozeAction: set.snooze,
    showArchiveAction: set.archive,
    showUnarchiveAction: set.unarchive,
  };
}
```

Put `searchActionProps` in `list-contract.ts`. Test it in `list-contract.test.ts`. Then each page uses `searchActionProps("imbox")` etc. That is the TDD seam. Skip the jsdom SearchResults test if the helper exists.

Add to `list-contract.test.ts`:

```ts
import { searchActionProps } from "@/lib/mail/list-contract";

it("maps Archive search to follow-up + unarchive", () => {
  expect(searchActionProps("archive")).toEqual({
    showFollowUpAction: true,
    showSnoozeAction: false,
    showArchiveAction: false,
    showUnarchiveAction: true,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/__tests__/unit/list-contract.test.ts`

Expected: FAIL, `searchActionProps` is not exported

- [ ] **Step 3: Write minimal implementation**

Add `searchActionProps` to `list-contract.ts`. Update `SearchResults` props with `showFollowUpAction` and `showUnarchiveAction` and pass them to `MessageList`. Update every searchable page to spread `searchActionProps("<list>")` and to use `searchCategoryFilter("<list>")` instead of inline `Prisma.sql` (Imbox/Feed/Paper Trail pick up `isReplyLater = false` this way). Sent search uses `searchCategoryFilter("sent")` instead of a folderId fragment.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `pnpm test src/__tests__/unit/list-contract.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/mail/list-contract.ts src/__tests__/unit/list-contract.test.ts \
  src/components/mail/search-results.tsx \
  src/app/\(mail\)/imbox/page.tsx src/app/\(mail\)/feed/page.tsx \
  src/app/\(mail\)/paper-trail/page.tsx src/app/\(mail\)/snoozed/page.tsx \
  src/app/\(mail\)/follow-up/page.tsx src/app/\(mail\)/archive/page.tsx \
  src/app/\(mail\)/sent/page.tsx
git commit -m "feat: search rows use the same actions as their list"
```

---

### Task 5: MessageRow chrome (snippet, follow-up meta, primary line)

**Files:**
- Modify: `src/components/mail/message-list.tsx`
- Modify: `src/lib/mail/messages.ts` (`MESSAGE_SELECT` needs `toAddresses` for Sent)

**Interfaces:**
- Consumes: `threadCountLabel`, `primaryLine` from `@/lib/mail/list-contract`
- Produces: `MessageRow` snippet uses `line-clamp-2` (two lines). Follow-up time renders under the snippet when `message.followUpAt` is set. Thread count uses `threadCountLabel`. Sent uses `primaryLine` with `toAddresses`.

- [ ] **Step 1: Write the failing tests**

Add `src/components/mail/__tests__/message-row-chrome.test.tsx`. Extract the chrome decisions into helpers already in `list-contract` so this file tests rendering:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: vi.fn() }),
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

import { MessageRow } from "../message-list";

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
  followUpAt: new Date("2026-08-21T08:00:00.000Z"),
  isFollowUp: true,
  sender: { displayName: "Ada", email: "ada@x.y", unthread: false },
};

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
  expect(document.querySelector("svg.lucide-paperclip")).not.toBeNull();
  expect(screen.getByText(/follow/i)).toBeDefined();
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/components/mail/__tests__/message-row-chrome.test.tsx`

Expected: FAIL, snippet is `truncate` (one line) and follow-up time is not in the row body

- [ ] **Step 3: Write minimal implementation**

In `message-list.tsx`:
- Replace the thread count span with `threadCountLabel(message.threadCount)`
- Change snippet class from `truncate` to `line-clamp-2`
- Under snippet, if `message.followUpAt`, render a muted line with the Bell icon and `formatSnoozeUntil` (same formatter as snooze; it already handles future dates)
- Keep snooze meta behind `showSnoozedUntil`
- Add optional `list?: MailListId` (default `"imbox"`) and use `primaryLine` for the sender/To text
- Add `toAddresses?: string[]` on `MessageItem`

Add `toAddresses: true` to `MESSAGE_SELECT`.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `pnpm test src/components/mail/__tests__/message-row-chrome.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/mail/message-list.tsx \
  src/components/mail/__tests__/message-row-chrome.test.tsx \
  src/lib/mail/messages.ts
git commit -m "feat: align message row chrome with the list contract"
```

---

### Task 6: Leading swipe marks read

**Files:**
- Modify: `src/components/mail/message-list.tsx`

**Interfaces:**
- Consumes: `toggleReadStatus` from `@/actions/read-status`
- Produces: `SwipeableRow` `onSwipeRight` stays archive/unarchive. Add a way to swipe toward read. Spec: leading = Read/Unread (blue), trailing = archive + snooze.

Today web: right = archive, left = snooze. Spec wants leading = read, trailing = archive (full swipe) + snooze as the second action.

Native iOS leading is read, trailing is archive then snooze. Match that:
- `onSwipeRight` (leading, positive x) = toggle read, color `bg-blue-500`, envelope icon
- `onSwipeLeft` (trailing) = archive (or unarchive), keep green/terracotta via existing `swipeRightColor` move
- Snooze stays keyboard / hover / select bar on web for this task if a second trailing button is not supported by `SwipeableRow`

`SwipeableRow` only has one left and one right callback. Do not invent a two-button trailing control on web. Spec's "second trailing button" is the iOS swipe-action extra. Web leading = read, trailing = archive (or unarchive). Snooze remains hover + `s` + select bar. That is the honest mapping of a two-callback row.

If `showArchiveAction` is false and `showUnarchiveAction` is false (Sent), trailing is disabled. Leading read still works.

- [ ] **Step 1: Write the failing test**

Extend `message-row-chrome.test.tsx` or add a unit test around a small helper in `list-contract.ts`:

```ts
export function swipeActions(list: MailListId): {
  leading: "read" | null;
  trailing: "archive" | "unarchive" | null;
} {
  if (list === "reply-later") return { leading: null, trailing: null };
  const set = listActionSet(list);
  return {
    leading: "read",
    trailing: set.unarchive ? "unarchive" : set.archive ? "archive" : null,
  };
}
```

Test:

```ts
expect(swipeActions("imbox")).toEqual({ leading: "read", trailing: "archive" });
expect(swipeActions("archive")).toEqual({ leading: "read", trailing: "unarchive" });
expect(swipeActions("sent")).toEqual({ leading: "read", trailing: null });
expect(swipeActions("reply-later")).toEqual({ leading: null, trailing: null });
```

Then in `MessageRow`, call `toggleReadStatus(message.id)` from the leading swipe and `router.refresh()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/__tests__/unit/list-contract.test.ts`

Expected: FAIL, `swipeActions` is not exported

- [ ] **Step 3: Write minimal implementation**

Add `swipeActions`. In `MessageRow`, set `onSwipeRight` to read toggle (blue, envelope icon) and `onSwipeLeft` to archive/unarchive when `swipeActions(list).trailing` is set. Remove the current "right = archive, left = snooze" pairing. Default swipe snooze (`handleSwipeSnooze`) goes away on web; hover Snooze and `s` remain.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `pnpm test src/__tests__/unit/list-contract.test.ts src/__tests__/unit/swipe.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/mail/list-contract.ts src/__tests__/unit/list-contract.test.ts \
  src/components/mail/message-list.tsx
git commit -m "feat: leading swipe toggles read on web lists"
```

---

### Task 7: Select bar Read and Block

**Files:**
- Modify: `src/components/mail/selection-action-bar.tsx`
- Modify: `src/components/mail/infinite-message-list.tsx`
- Modify: `src/actions/read-status.ts`
- Modify: `src/actions/senders.ts`

**Interfaces:**
- Consumes: `listActionSet`, `uniqueBlockSenderIds`, `bulkReadMarksRead`, `isOwnAddress` / `getOwnAddresses`, `rejectSenderForUser`, `setThreadReadState`
- Produces:

```ts
export async function setConversationsRead(
  messageIds: string[],
  isRead: boolean,
): Promise<void>;

export async function rejectSenders(senderIds: string[]): Promise<void>;
```

Select bar props gain `showSnoozeAction` already. Add `showReadAction` (always true on mail lists) and `showBlockAction` (false on Sent). Pass selected rows' `isRead`, `senderId`, `fromAddress`.

- [ ] **Step 1: Write the failing tests**

`src/__tests__/unit/selection-bar-policy.test.ts` can stay as list-contract tests (already have uniqueBlockSenderIds / bulkReadMarksRead).

Add action tests in `src/__tests__/unit/read-status-actions.test.ts` (create if missing) and extend `src/__tests__/unit/senders-actions.test.ts`.

For `setConversationsRead`, follow the pattern in `archive-actions.test.ts`: mock `auth`, `db`, `setThreadReadState`. Assert it calls `setThreadReadState` once per id with the given `isRead`.

For `rejectSenders`, assert it calls `rejectSenderForUser` once per unique id.

A jsdom test for the bar labels:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { SelectionActionBar } from "../selection-action-bar";

it("shows Read and Block sender when those flags are on", () => {
  render(
    <SelectionActionBar
      selectedMessageIds={["m1"]}
      onComplete={() => {}}
      onQueryInvalidate={() => {}}
      showReadAction
      showBlockAction
      readLabel="Read"
    />,
  );
  expect(screen.getByText("Read")).toBeDefined();
  expect(screen.getByText("Block sender")).toBeDefined();
  expect(screen.queryByText("Snooze")).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/components/mail/__tests__/selection-action-bar.test.tsx`

Expected: FAIL, unknown props / missing button copy

- [ ] **Step 3: Write minimal implementation**

Add the server actions. Extend the bar with Read (primary-outline) and Block (destructive text). Confirm Block when `uniqueBlockSenderIds` length >= 2, or when a single sender has >= 10 messages if you already have a count; if the count is not in the list payload, confirm only for 2+ senders on web this round (the 10-message threshold needs a count the list does not have). Document that in the commit body. Native already fetches `messageCount` from GRDB; web can `findMany` count in the action before reject.

In `rejectSenders`, for a single id, load `_count.messages` and if >= 10 throw a typed result `{ needsConfirm: true, count }` OR accept `{ confirmed?: boolean }` from the client. Keep it simple: the client always confirms at 2+ senders; for one sender the action loads count and returns `{ needsConfirm: true, count }` when count >= 10 and `confirmed` is not set. The bar then shows `Block N messages from Name?`.

Pass `showSnoozeAction={listActionSet(category).snooze}` from `InfiniteMessageList` (Follow Up and Archive hide it).

Add `senderId` to `MESSAGE_SELECT` / `MessageItem.sender` (`id: true`).

- [ ] **Step 4: Run tests and make sure they pass**

Run: `pnpm test src/components/mail/__tests__/selection-action-bar.test.tsx src/__tests__/unit/senders-actions.test.ts src/__tests__/unit/list-contract.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/mail/selection-action-bar.tsx \
  src/components/mail/__tests__/selection-action-bar.test.tsx \
  src/components/mail/infinite-message-list.tsx \
  src/actions/read-status.ts src/actions/senders.ts \
  src/lib/mail/messages.ts src/components/mail/message-list.tsx
git commit -m "feat: select bar reads, blocks, and hides snooze per list"
```

---

### Task 8: Sent as an infinite list

**Files:**
- Modify: `src/lib/mail/messages.ts`
- Modify: `src/__tests__/unit/category-filters.test.ts`
- Modify: `src/app/api/messages/route.ts`
- Modify: `src/app/(mail)/sent/page.tsx`
- Modify: `src/components/mail/infinite-message-list.tsx`

**Interfaces:**
- Consumes: `getMessages`, `listActionSet("sent")`, `emptyCopy("sent")`
- Produces: `Category` includes `"sent"`. `getMessages(..., "sent")` filters `folder: { specialUse: "sent" }` (not category flags). Chronological cursor like archive. `InfiniteMessageList` category union includes `"sent"`. Page uses it with `showFollowUpAction`, `showSelectionToggle`, no archive/snooze.

- [ ] **Step 1: Write the failing test**

In `src/__tests__/unit/category-filters.test.ts`:

```ts
  it("filters Sent by folder specialUse, not category flags", async () => {
    const where = await capturedWhere("sent");
    expect(where).toEqual({
      userId: "user-1",
      isDeleted: false,
      folder: { specialUse: "sent" },
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/__tests__/unit/category-filters.test.ts`

Expected: FAIL, `sent` is not a Category / where is undefined

- [ ] **Step 3: Write minimal implementation**

Add `sent` to `CATEGORY_FILTERS` as a special case inside `getMessages` (do not spread a boolean map that does not exist). `orderBy` chronological. `encodeChronoCursor`. Include `toAddresses` in the select (Task 5). Zod enum on `/api/messages` gains `"sent"`. `InfiniteMessageList` category type adds `"sent"`. Rewrite `sent/page.tsx` like `archive/page.tsx`: empty `EmptyState` using `emptyCopy("sent")`, else `InfiniteMessageList` with `category="sent"` and `list`/`basePath` so `MessageRow` uses `primaryLine` To: addresses. Keep the "No sent folder found" branch if `getMessages` returns empty because no folder exists: `getMessages` for sent should not 500 when the folder is missing, it should return `{ messages: [], nextCursor: null }`.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `pnpm test src/__tests__/unit/category-filters.test.ts src/__tests__/unit/messages-cursor.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/mail/messages.ts src/__tests__/unit/category-filters.test.ts \
  src/app/api/messages/route.ts src/app/\(mail\)/sent/page.tsx \
  src/components/mail/infinite-message-list.tsx
git commit -m "feat: paginate Sent through InfiniteMessageList"
```

---

### Task 9: Files infinite scroll and correct open route

**Files:**
- Modify: `src/lib/mail/files.ts`
- Modify: `src/components/mail/files-list.tsx`

**Interfaces:**
- Consumes: `getThreadRoute` from `@/lib/mail/route-helpers`
- Produces: `FileRow.message` includes `isInImbox`, `isInFeed`, `isInPaperTrail`, `isArchived`. Open link is `${getThreadRoute(message)}/${message.id}`. List uses an IntersectionObserver sentinel like `InfiniteMessageList` instead of a Load more button. `loadMoreFiles` stays as the fetch.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { getThreadRoute } from "@/lib/mail/route-helpers";

it("opens a Feed attachment on /feed, not /imbox", () => {
  expect(
    getThreadRoute({
      isInImbox: false,
      isInFeed: true,
      isInPaperTrail: false,
      isArchived: false,
    }),
  ).toBe("/feed");
});
```

That already passes. Add `src/__tests__/unit/file-open-href.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fileOpenHref } from "@/lib/mail/files";

it("joins getThreadRoute with the message id", () => {
  expect(
    fileOpenHref({
      id: "m1",
      isInImbox: false,
      isInFeed: true,
      isInPaperTrail: false,
      isArchived: false,
    }),
  ).toBe("/feed/m1");
});

it("returns null without a message", () => {
  expect(fileOpenHref(null)).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/__tests__/unit/file-open-href.test.ts`

Expected: FAIL, `fileOpenHref` is not exported

- [ ] **Step 3: Write minimal implementation**

```ts
export function fileOpenHref(
  message: {
    id: string;
    isInImbox: boolean;
    isInFeed: boolean;
    isInPaperTrail: boolean;
    isArchived: boolean;
  } | null,
): string | null {
  if (!message) return null;
  return `${getThreadRoute(message)}/${message.id}`;
}
```

Select the four flags in `getFiles`. Replace the hardcoded `/imbox/` link. Replace the Load more button with a sentinel `div` + IntersectionObserver calling `loadMoreFiles` (copy the pattern from `infinite-message-list.tsx`).

- [ ] **Step 4: Run tests and make sure they pass**

Run: `pnpm test src/__tests__/unit/file-open-href.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/mail/files.ts src/__tests__/unit/file-open-href.test.ts \
  src/components/mail/files-list.tsx
git commit -m "feat: Files infinite scroll and folder-aware open links"
```

---

### Task 10: Empty copy + two-line draft snippet

**Files:**
- Modify: `src/app/(mail)/imbox/page.tsx` (and the other list pages' EmptyState)
- Modify: `src/components/mail/drafts-list.tsx`

**Interfaces:**
- Consumes: `emptyCopy`
- Produces: every mail empty state uses `emptyCopy(list).title` / `.description`. Draft snippet class `line-clamp-2`.

- [ ] **Step 1: Write the failing test**

`emptyCopy` already exists. Add:

```ts
it("covers every mailbox in the spec table", () => {
  const lists = [
    "imbox",
    "feed",
    "paper-trail",
    "snoozed",
    "follow-up",
    "archive",
    "sent",
    "reply-later",
  ] as const;
  for (const list of lists) {
    expect(emptyCopy(list).title.length).toBeGreaterThan(0);
    expect(emptyCopy(list).description.length).toBeGreaterThan(0);
  }
});
```

For drafts, add to `src/__tests__/unit/drafts-list.test.tsx` an assertion that the snippet node has `line-clamp-2` once you render a row with a long snippet. If that file already renders rows, add the class check. If not, add one case.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/__tests__/unit/list-contract.test.ts src/__tests__/unit/drafts-list.test.tsx`

Expected: drafts snippet still `truncate`

- [ ] **Step 3: Write minimal implementation**

Replace inline empty titles with `emptyCopy(...)`. Draft snippet: `line-clamp-2` instead of `truncate`.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `pnpm test src/__tests__/unit/list-contract.test.ts src/__tests__/unit/drafts-list.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/\(mail\) src/components/mail/drafts-list.tsx \
  src/__tests__/unit/list-contract.test.ts src/__tests__/unit/drafts-list.test.tsx
git commit -m "feat: empty states and draft snippets follow the list contract"
```

---

### Task 11: PATCH scheduled message for native Edit

**Files:**
- Modify: `src/app/api/mobile/scheduled/[id]/route.ts`
- Modify: `src/__tests__/integration/mobile-scheduled.test.ts`

**Interfaces:**
- Consumes: `editScheduledMessageForUser` (same core as `editScheduledMessage` in `src/actions/scheduled-messages.ts`). If the action has no `ForUser` export, extract one next to `cancelScheduledForUser`.
- Produces: `PATCH /api/mobile/scheduled/:id` with `{ to?, cc?, bcc?, subject?, textBody?, scheduledFor?, emailConnectionId? }`. 404 if not owned, 409 if not PENDING. Body validated with the same zod fields the web action uses.

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/integration/mobile-scheduled.test.ts` (follow existing auth/rate-limit patterns):

```ts
it("returns 405 until PATCH exists, then 401 without auth", async () => {
  const { PATCH } = await import("@/app/api/mobile/scheduled/[id]/route");
  const res = await PATCH(makeRequest({}), { params: Promise.resolve({ id: "s1" }) });
  expect(res.status).toBe(401);
});
```

If PATCH is missing the import fails. That is the red.

Then mock `editScheduledMessageForUser` and assert 200 + the core is called with `userId` and `id`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/__tests__/integration/mobile-scheduled.test.ts`

Expected: FAIL, `PATCH` is not exported

- [ ] **Step 3: Write minimal implementation**

Export `PATCH` from `src/app/api/mobile/scheduled/[id]/route.ts`. Reuse the web edit core. Do not invent a new scheduler.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `pnpm test src/__tests__/integration/mobile-scheduled.test.ts src/__tests__/unit/scheduled-messages-actions.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/mobile/scheduled/[id]/route.ts \
  src/lib/mail/scheduled-messages.ts \
  src/__tests__/integration/mobile-scheduled.test.ts
git commit -m "feat: PATCH scheduled messages for native edit"
```

---

## Stop

Do not start the iOS plan until this branch is green (`pnpm test` for the files above) and `GET /api/mobile/search?category=feed` plus `PATCH /api/mobile/scheduled/:id` exist. Native work is `docs/specs/2026-08-20-list-view-parity-plan-ios.md`.
