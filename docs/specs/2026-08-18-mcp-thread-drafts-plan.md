# MCP Thread Drafts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reply drafts (MCP or human) are recognizable in Drafts and open on the thread with the composer showing the saved text.

**Architecture:** Pure `presentDraft` / `pickReplyDraftForThread` / `draftCatalogHref` helpers enrich list rows and pin the reply composer to the draft's `contextMessageId`. No Prisma or key change. Server ships first (web + MCP + mobile API); iOS/macOS consume the new JSON fields.

**Tech Stack:** Next.js, Vitest, Prisma `Draft` model, MCP tools in `src/lib/mcp/tools/mail.ts`; SwiftUI + GRDB + XCTest in `kurir-ios`.

**Spec:** `docs/specs/2026-08-18-mcp-thread-drafts-design.md`

## Global Constraints

- Draft unique key stays `(userId, type, contextMessageId)`. No Prisma migration.
- UI strings in English. No em dashes in comments or copy.
- Empty reply subject is filled from the original subject as-is. Do not prepend `Re:`.
- `save_draft` REPLY/FORWARD with a bad id errors exactly: `contextMessageId must be a message id from get_thread, not a threadId`
- That string must not contain "not found" (`wrap()` remaps `/not found/i` to `not found or not yours`).
- FORWARD stays on the compose page. Orphan REPLY stays detached compose.
- No sidebar Drafts count. No Draft badge on category lists. No `get_draft` tool.
- Two repos: `/Users/cfa/code/kurir-server` (this branch `cfarvidson/mcp-thread-drafts`) and `/Users/cfa/code/kurir-ios` (new branch `cfarvidson/mcp-thread-drafts`).
- Never `git add -A`. Stage explicit paths. Server: `pnpm test <file>`. iOS: existing XCTest target.
- TDD: failing test first, watch it fail, then minimal code.

---

## Files

### kurir-server

- Create: `src/lib/mail/draft-presentation.ts`
- Create: `src/__tests__/unit/draft-presentation.test.ts`
- Modify: `src/app/(mail)/drafts/page.tsx`
- Modify: `src/components/mail/drafts-list.tsx`
- Modify: `src/__tests__/unit/drafts-list.test.tsx`
- Modify: `src/app/api/mobile/drafts/route.ts`
- Modify: `src/__tests__/integration/mobile-drafts.test.ts`
- Modify: `src/lib/mcp/tools/mail.ts`
- Modify: `src/__tests__/unit/mcp-tools-mail.test.ts`
- Modify: `src/lib/mcp/tools/send.ts` (description only)
- Modify: `src/components/mail/thread-detail-view.tsx`
- Modify: `src/components/mail/thread-page-content.tsx`
- Modify: `src/components/mail/reply-composer.tsx`

### kurir-ios

- Create: `Kurir/Sources/Mail/DraftPresentation.swift`
- Modify: `Kurir/Sources/Networking/APIModels.swift` (`APIDraft`)
- Modify: `Kurir/Sources/Mail/DraftStore.swift` (`DraftListItem`)
- Modify: `Kurir/Sources/Mail/DraftsListView.swift`
- Modify: `Kurir/Sources/Mail/ThreadView.swift`
- Modify: `Kurir/Tests/DraftTests.swift`

---

## Part A: kurir-server

### Task 1: Pure presentation helpers

**Files:**
- Create: `src/lib/mail/draft-presentation.ts`
- Test: `src/__tests__/unit/draft-presentation.test.ts`

**Interfaces:**
- Consumes: `getThreadRoute` from `@/lib/mail/route-helpers`, `DraftType` from `@prisma/client`
- Produces:

```ts
export type DraftFolder = "imbox" | "feed" | "paper-trail" | "archive";

export type DraftPresentation = {
  displaySubject: string;
  displayFrom: string | null;
  folder: DraftFolder | null;
};

export type DraftContextMessage = {
  subject: string | null;
  fromName: string | null;
  fromAddress: string;
  isInImbox: boolean;
  isInFeed: boolean;
  isInPaperTrail: boolean;
  isArchived: boolean;
};

export function presentDraft(
  draft: { type: string; subject: string },
  message: DraftContextMessage | null,
): DraftPresentation;

export function draftFolderFromMessage(
  message: Pick<
    DraftContextMessage,
    "isInImbox" | "isInFeed" | "isInPaperTrail" | "isArchived"
  >,
): DraftFolder;

export function draftCatalogHref(input: {
  type: string;
  contextMessageId: string;
  folder: DraftFolder | null;
}): string;

export function pickReplyDraftForThread<
  T extends { type: string; contextMessageId: string; updatedAt: Date },
>(drafts: T[], messageIds: string[]): T | null;

export function replyDraftSubject(
  savedSubject: string | undefined,
  originalSubject: string,
): string;

export const CONTEXT_MESSAGE_ID_ERROR =
  "contextMessageId must be a message id from get_thread, not a threadId";
```

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/unit/draft-presentation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  presentDraft,
  draftFolderFromMessage,
  draftCatalogHref,
  pickReplyDraftForThread,
  replyDraftSubject,
} from "@/lib/mail/draft-presentation";

const feedMsg = {
  subject: "Q3 budget",
  fromName: "Ada Lovelace",
  fromAddress: "ada@x.y",
  isInImbox: false,
  isInFeed: true,
  isInPaperTrail: false,
  isArchived: false,
};

describe("presentDraft", () => {
  it("uses original subject and from when reply subject is empty", () => {
    expect(
      presentDraft({ type: "REPLY", subject: "  " }, feedMsg),
    ).toEqual({
      displaySubject: "Q3 budget",
      displayFrom: "Ada Lovelace",
      folder: "feed",
    });
  });

  it("lets a non-empty draft subject win", () => {
    expect(
      presentDraft({ type: "REPLY", subject: "My take" }, feedMsg)
        .displaySubject,
    ).toBe("My take");
  });

  it("falls back to fromAddress when name is missing", () => {
    expect(
      presentDraft(
        { type: "REPLY", subject: "" },
        { ...feedMsg, fromName: null },
      ).displayFrom,
    ).toBe("ada@x.y");
  });

  it("returns null from and folder for an orphan reply", () => {
    expect(presentDraft({ type: "REPLY", subject: "" }, null)).toEqual({
      displaySubject: "",
      displayFrom: null,
      folder: null,
    });
  });

  it("does not set displayFrom on NEW or FORWARD", () => {
    expect(
      presentDraft({ type: "NEW", subject: "Hi" }, null).displayFrom,
    ).toBeNull();
    expect(
      presentDraft({ type: "FORWARD", subject: "Hi" }, feedMsg).displayFrom,
    ).toBeNull();
  });
});

describe("draftFolderFromMessage", () => {
  it("follows getThreadRoute flags", () => {
    const base = {
      isInImbox: false,
      isInFeed: false,
      isInPaperTrail: false,
      isArchived: false,
    };
    expect(draftFolderFromMessage({ ...base, isInImbox: true })).toBe("imbox");
    expect(draftFolderFromMessage({ ...base, isInFeed: true })).toBe("feed");
    expect(
      draftFolderFromMessage({ ...base, isInPaperTrail: true }),
    ).toBe("paper-trail");
    expect(draftFolderFromMessage({ ...base, isArchived: true })).toBe(
      "archive",
    );
    expect(draftFolderFromMessage(base)).toBe("imbox");
  });
});

describe("draftCatalogHref", () => {
  it("opens a reply on the folder thread", () => {
    expect(
      draftCatalogHref({
        type: "REPLY",
        contextMessageId: "msg-1",
        folder: "feed",
      }),
    ).toBe("/feed/msg-1");
  });

  it("opens an orphan reply as detached compose", () => {
    expect(
      draftCatalogHref({
        type: "REPLY",
        contextMessageId: "msg-1",
        folder: null,
      }),
    ).toBe("/compose?draftType=REPLY&draft=msg-1&from=/drafts");
  });

  it("keeps NEW and FORWARD on compose", () => {
    expect(
      draftCatalogHref({
        type: "NEW",
        contextMessageId: "uuid-1",
        folder: null,
      }),
    ).toBe("/compose?draft=uuid-1&from=/drafts");
    expect(
      draftCatalogHref({
        type: "FORWARD",
        contextMessageId: "msg-1",
        folder: "imbox",
      }),
    ).toBe("/compose?forward=msg-1&from=/drafts");
  });
});

describe("pickReplyDraftForThread", () => {
  it("returns the newest REPLY in the thread", () => {
    const older = {
      type: "REPLY",
      contextMessageId: "m1",
      updatedAt: new Date("2026-08-01T00:00:00Z"),
    };
    const newer = {
      type: "REPLY",
      contextMessageId: "m2",
      updatedAt: new Date("2026-08-02T00:00:00Z"),
    };
    const other = {
      type: "REPLY",
      contextMessageId: "other",
      updatedAt: new Date("2026-08-03T00:00:00Z"),
    };
    expect(
      pickReplyDraftForThread([older, newer, other], ["m1", "m2"])
        ?.contextMessageId,
    ).toBe("m2");
  });

  it("returns null when the thread has no reply draft", () => {
    expect(
      pickReplyDraftForThread(
        [
          {
            type: "NEW",
            contextMessageId: "m1",
            updatedAt: new Date(),
          },
        ],
        ["m1"],
      ),
    ).toBeNull();
  });
});

describe("replyDraftSubject", () => {
  it("keeps a saved subject and otherwise copies the original as-is", () => {
    expect(replyDraftSubject("My take", "Q3 budget")).toBe("My take");
    expect(replyDraftSubject("  ", "Q3 budget")).toBe("Q3 budget");
    expect(replyDraftSubject(undefined, "Re: Hi")).toBe("Re: Hi");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/cfa/code/kurir-server && pnpm exec vitest run src/__tests__/unit/draft-presentation.test.ts`

Expected: FAIL, cannot find module `@/lib/mail/draft-presentation`.

- [ ] **Step 3: Implement the helpers**

Create `src/lib/mail/draft-presentation.ts`:

```ts
import { getThreadRoute } from "@/lib/mail/route-helpers";

export const CONTEXT_MESSAGE_ID_ERROR =
  "contextMessageId must be a message id from get_thread, not a threadId";

export type DraftFolder = "imbox" | "feed" | "paper-trail" | "archive";

export type DraftPresentation = {
  displaySubject: string;
  displayFrom: string | null;
  folder: DraftFolder | null;
};

export type DraftContextMessage = {
  subject: string | null;
  fromName: string | null;
  fromAddress: string;
  isInImbox: boolean;
  isInFeed: boolean;
  isInPaperTrail: boolean;
  isArchived: boolean;
};

export function draftFolderFromMessage(
  message: Pick<
    DraftContextMessage,
    "isInImbox" | "isInFeed" | "isInPaperTrail" | "isArchived"
  >,
): DraftFolder {
  return getThreadRoute(message).slice(1) as DraftFolder;
}

export function presentDraft(
  draft: { type: string; subject: string },
  message: DraftContextMessage | null,
): DraftPresentation {
  const saved = draft.subject.trim();
  const original = message?.subject?.trim() ?? "";
  const displaySubject = saved || original;
  const displayFrom =
    draft.type === "REPLY" && message
      ? message.fromName?.trim() || message.fromAddress
      : null;
  const folder = message ? draftFolderFromMessage(message) : null;
  return { displaySubject, displayFrom, folder };
}

export function draftCatalogHref(input: {
  type: string;
  contextMessageId: string;
  folder: DraftFolder | null;
}): string {
  const id = encodeURIComponent(input.contextMessageId);
  if (input.type === "NEW") return `/compose?draft=${id}&from=/drafts`;
  if (input.type === "FORWARD") {
    return `/compose?forward=${id}&from=/drafts`;
  }
  if (input.type === "REPLY" && input.folder) {
    return `/${input.folder}/${id}`;
  }
  return `/compose?draftType=${input.type}&draft=${id}&from=/drafts`;
}

export function pickReplyDraftForThread<
  T extends { type: string; contextMessageId: string; updatedAt: Date },
>(drafts: T[], messageIds: string[]): T | null {
  const idSet = new Set(messageIds);
  const matches = drafts.filter(
    (d) => d.type === "REPLY" && idSet.has(d.contextMessageId),
  );
  if (matches.length === 0) return null;
  return matches.reduce((best, d) =>
    d.updatedAt > best.updatedAt ? d : best,
  );
}

export function replyDraftSubject(
  savedSubject: string | undefined,
  originalSubject: string,
): string {
  const saved = (savedSubject ?? "").trim();
  return saved || originalSubject.trim();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/cfa/code/kurir-server && pnpm exec vitest run src/__tests__/unit/draft-presentation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/cfa/code/kurir-server
git add src/lib/mail/draft-presentation.ts src/__tests__/unit/draft-presentation.test.ts
git commit -m "feat(drafts): present reply drafts with thread subject and folder"
```

---

### Task 2: DB wrappers

**Files:**
- Modify: `src/lib/mail/draft-presentation.ts`
- Modify: `src/__tests__/unit/draft-presentation.test.ts`

**Interfaces:**
- Consumes: `listDraftsForUser` from `@/lib/mail/drafts`, `db` from `@/lib/db`, Task 1 helpers
- Produces:

```ts
export type PresentedDraft = Awaited<
  ReturnType<typeof listDraftsForUser>
>[number] &
  DraftPresentation;

export async function presentDraftsForUser(
  userId: string,
): Promise<PresentedDraft[]>;

export async function findReplyDraftForThread(
  userId: string,
  messageIds: string[],
): Promise<Awaited<ReturnType<typeof listDraftsForUser>>[number] | null>;

export async function loadDraftContextMessage(
  userId: string,
  messageId: string,
): Promise<(DraftContextMessage & { id: string; emailConnectionId: string }) | null>;
```

- [ ] **Step 1: Write the failing tests**

Add to the same test file, after mocking:

At the top of the test file (before the existing imports of the module under test), add mocks. Because the file already imports the module, put the new DB tests in a **second describe after vi.mock**. Vitest hoists `vi.mock`, so add this at the top of the file (before the first import of the module):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mail/drafts", () => ({
  listDraftsForUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    message: { findMany: vi.fn(), findFirst: vi.fn() },
    draft: { findMany: vi.fn() },
  },
}));
```

Then after the existing pure tests:

```ts
import { listDraftsForUser } from "@/lib/mail/drafts";
import { db } from "@/lib/db";
import {
  presentDraftsForUser,
  findReplyDraftForThread,
  loadDraftContextMessage,
} from "@/lib/mail/draft-presentation";

describe("presentDraftsForUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("joins context messages and attaches display fields", async () => {
    vi.mocked(listDraftsForUser).mockResolvedValue([
      {
        id: "d1",
        type: "REPLY",
        contextMessageId: "m1",
        subject: "",
        to: "ada@x.y",
        body: "hi",
        updatedAt: new Date("2026-08-02T00:00:00Z"),
      },
    ] as never);
    vi.mocked(db.message.findMany).mockResolvedValue([
      {
        id: "m1",
        subject: "Q3 budget",
        fromName: "Ada Lovelace",
        fromAddress: "ada@x.y",
        isInImbox: false,
        isInFeed: true,
        isInPaperTrail: false,
        isArchived: false,
      },
    ] as never);

    const rows = await presentDraftsForUser("u1");
    expect(db.message.findMany).toHaveBeenCalledWith({
      where: { userId: "u1", id: { in: ["m1"] } },
      select: {
        id: true,
        subject: true,
        fromName: true,
        fromAddress: true,
        isInImbox: true,
        isInFeed: true,
        isInPaperTrail: true,
        isArchived: true,
      },
    });
    expect(rows[0]).toMatchObject({
      displaySubject: "Q3 budget",
      displayFrom: "Ada Lovelace",
      folder: "feed",
    });
  });
});

describe("findReplyDraftForThread", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null for an empty id list without querying", async () => {
    expect(await findReplyDraftForThread("u1", [])).toBeNull();
    expect(db.draft.findMany).not.toHaveBeenCalled();
  });

  it("asks for the newest REPLY in the id set", async () => {
    vi.mocked(db.draft.findMany).mockResolvedValue([
      { id: "d2", contextMessageId: "m2" },
    ] as never);
    const row = await findReplyDraftForThread("u1", ["m1", "m2"]);
    expect(db.draft.findMany).toHaveBeenCalledWith({
      where: {
        userId: "u1",
        type: "REPLY",
        contextMessageId: { in: ["m1", "m2"] },
      },
      orderBy: { updatedAt: "desc" },
      take: 1,
    });
    expect(row?.contextMessageId).toBe("m2");
  });
});

describe("loadDraftContextMessage", () => {
  it("returns null when the message is not the user's", async () => {
    vi.mocked(db.message.findFirst).mockResolvedValue(null);
    expect(await loadDraftContextMessage("u1", "th-not-a-message")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/cfa/code/kurir-server && pnpm exec vitest run src/__tests__/unit/draft-presentation.test.ts`

Expected: FAIL, `presentDraftsForUser` is not exported.

- [ ] **Step 3: Implement the wrappers**

Append to `src/lib/mail/draft-presentation.ts`:

```ts
import { db } from "@/lib/db";
import { listDraftsForUser } from "@/lib/mail/drafts";

const contextSelect = {
  id: true,
  subject: true,
  fromName: true,
  fromAddress: true,
  isInImbox: true,
  isInFeed: true,
  isInPaperTrail: true,
  isArchived: true,
  emailConnectionId: true,
} as const;

export async function presentDraftsForUser(userId: string) {
  const drafts = await listDraftsForUser(userId);
  const ids = drafts
    .filter((d) => d.type !== "NEW")
    .map((d) => d.contextMessageId);
  const messages = ids.length
    ? await db.message.findMany({
        where: { userId, id: { in: ids } },
        select: {
          id: true,
          subject: true,
          fromName: true,
          fromAddress: true,
          isInImbox: true,
          isInFeed: true,
          isInPaperTrail: true,
          isArchived: true,
        },
      })
    : [];
  const byId = new Map(messages.map((m) => [m.id, m]));
  return drafts.map((draft) => ({
    ...draft,
    ...presentDraft(draft, byId.get(draft.contextMessageId) ?? null),
  }));
}

export async function findReplyDraftForThread(
  userId: string,
  messageIds: string[],
) {
  if (messageIds.length === 0) return null;
  const rows = await db.draft.findMany({
    where: {
      userId,
      type: "REPLY",
      contextMessageId: { in: messageIds },
    },
    orderBy: { updatedAt: "desc" },
    take: 1,
  });
  return rows[0] ?? null;
}

export async function loadDraftContextMessage(
  userId: string,
  messageId: string,
) {
  return db.message.findFirst({
    where: { userId, id: messageId },
    select: contextSelect,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/cfa/code/kurir-server && pnpm exec vitest run src/__tests__/unit/draft-presentation.test.ts`

Expected: PASS. If the mock of `@/lib/mail/drafts` breaks nothing (this file no longer needs the real `listDraftsForUser` in the pure tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/mail/draft-presentation.ts src/__tests__/unit/draft-presentation.test.ts
git commit -m "feat(drafts): load presented drafts and pin reply by thread"
```

---

### Task 3: Web Drafts catalog

**Files:**
- Modify: `src/app/(mail)/drafts/page.tsx`
- Modify: `src/components/mail/drafts-list.tsx`
- Modify: `src/__tests__/unit/drafts-list.test.tsx`

**Interfaces:**
- Consumes: `presentDraftsForUser`, `draftCatalogHref` from Task 1-2
- Produces: `DraftListItem.displayFrom?: string | null`; `draftPrimaryLine({ type, to, displayFrom })`

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/unit/drafts-list.test.tsx` inside `describe("draft row helpers")`:

```ts
it("uses displayFrom as the primary line for a reply", () => {
  expect(
    draftPrimaryLine({
      type: "REPLY",
      to: "ada@x.y",
      displayFrom: "Ada Lovelace",
    }),
  ).toBe("Ada Lovelace");
});

it("falls back to To: when displayFrom is missing", () => {
  expect(
    draftPrimaryLine({ type: "REPLY", to: "ada@x.y", displayFrom: null }),
  ).toBe("To: ada@x.y");
});
```

Import `draftPrimaryLine` from `@/components/mail/drafts-list`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/cfa/code/kurir-server && pnpm exec vitest run src/__tests__/unit/drafts-list.test.tsx`

Expected: FAIL, `draftPrimaryLine` is not exported.

- [ ] **Step 3: Implement list helpers and page wiring**

In `drafts-list.tsx`, extend `DraftListItem` with `displayFrom?: string | null` and add:

```ts
export function draftPrimaryLine(draft: {
  type: string;
  to: string;
  displayFrom?: string | null;
}): string {
  if (draft.type === "REPLY" && draft.displayFrom?.trim()) {
    return draft.displayFrom.trim();
  }
  return draftRecipientLine(draft.to);
}
```

In `DraftRow`, replace `draftRecipientLine(draft.to)` with `draftPrimaryLine(draft)`.

Rewrite `getDrafts` in `src/app/(mail)/drafts/page.tsx` to drop the local `existingIds` join and use the presenter:

```ts
import {
  presentDraftsForUser,
  draftCatalogHref,
} from "@/lib/mail/draft-presentation";

async function getDrafts(userId: string): Promise<DraftListItem[]> {
  const drafts = await presentDraftsForUser(userId);
  return drafts.map((d) => ({
    type: d.type,
    contextMessageId: d.contextMessageId,
    to: d.to,
    subject: d.displaySubject,
    snippet: d.body.replace(/\s+/g, " ").trim().slice(0, 150),
    updatedAt: d.updatedAt.toISOString(),
    href: draftCatalogHref({
      type: d.type,
      contextMessageId: d.contextMessageId,
      folder: d.folder,
    }),
    displayFrom: d.displayFrom,
  }));
}
```

Remove the unused `db` import if nothing else in the file uses it.

Update the existing "shows a labeled Delete control" test: the REPLY fixture still has no `displayFrom`, so both rows stay `To: ada@x.y`. Add `displayFrom: "Ada"` to one fixture in a new render assertion if you want a UI check; the helper tests are enough.

- [ ] **Step 4: Run tests**

Run: `cd /Users/cfa/code/kurir-server && pnpm exec vitest run src/__tests__/unit/drafts-list.test.tsx src/__tests__/unit/draft-presentation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(mail\)/drafts/page.tsx src/components/mail/drafts-list.tsx src/__tests__/unit/drafts-list.test.tsx
git commit -m "feat(drafts): show thread from and folder href on reply rows"
```

---

### Task 4: Mobile GET /api/mobile/drafts

**Files:**
- Modify: `src/app/api/mobile/drafts/route.ts`
- Modify: `src/__tests__/integration/mobile-drafts.test.ts`

**Interfaces:**
- Consumes: `presentDraftsForUser`
- Produces: each GET item includes `displaySubject`, `displayFrom`, `folder`

- [ ] **Step 1: Write the failing test**

In `src/__tests__/integration/mobile-drafts.test.ts`, the GET test currently mocks `db.draft.findMany`. After this change GET goes through `presentDraftsForUser` -> `listDraftsForUser` (real, uses `db.draft.findMany`) + `db.message.findMany`.

Extend test `(c)` after `expect(body.drafts[0].contextMessageId)`:

```ts
expect(body.drafts[0]).toMatchObject({
  displaySubject: "S",
  displayFrom: null,
  folder: null,
});
```

If the current mock does not include `type: "NEW"`, add it (it already does). Mock `db.message.findMany` to `[]` in that test if the wrapper calls it (NEW-only list should pass `id: { in: [] }` skipped, so no call).

Add a new test after (c):

```ts
it("(g) GET enriches a REPLY draft from the context message", async () => {
  await mockAuthed("user-1");
  const { db } = await import("@/lib/db");
  vi.mocked(db.draft.findMany).mockResolvedValue([
    {
      type: "REPLY",
      contextMessageId: "m1",
      to: "ada@x.y",
      subject: "",
      body: "hello",
      emailConnectionId: null,
      attachmentIds: [],
      updatedAt: new Date("2026-08-02T00:00:00.000Z"),
    },
  ] as never);
  vi.mocked(db.message.findMany).mockResolvedValue([
    {
      id: "m1",
      subject: "Q3 budget",
      fromName: "Ada Lovelace",
      fromAddress: "ada@x.y",
      isInImbox: false,
      isInFeed: true,
      isInPaperTrail: false,
      isArchived: false,
    },
  ] as never);

  const { GET } = await import("@/app/api/mobile/drafts/route");
  const res = await GET({ headers: { get: () => null } } as any);
  const body = await res.json();
  expect(body.drafts[0]).toMatchObject({
    displaySubject: "Q3 budget",
    displayFrom: "Ada Lovelace",
    folder: "feed",
  });
});
```

Confirm `db.message.findMany` is mocked in this file's `db` mock. If the integration mock is a partial `db.draft` only, add `message: { findMany: vi.fn().mockResolvedValue([]) }` to the existing db mock at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/cfa/code/kurir-server && pnpm exec vitest run src/__tests__/integration/mobile-drafts.test.ts`

Expected: FAIL, `displaySubject` is undefined.

- [ ] **Step 3: Wire GET**

In `src/app/api/mobile/drafts/route.ts`, replace `listDraftsForUser` in GET with `presentDraftsForUser`. Keep `loadAttachmentMeta`. Map:

```ts
const drafts = await presentDraftsForUser(userId);
// ... attachment meta unchanged ...
return NextResponse.json({
  drafts: drafts.map((d) => ({
    type: d.type,
    contextMessageId: d.contextMessageId,
    to: d.to,
    subject: d.subject,
    body: d.body,
    emailConnectionId: d.emailConnectionId,
    attachmentIds: d.attachmentIds,
    attachments: d.attachmentIds.flatMap((id) => {
      const row = metaById.get(id);
      return row ? [row] : [];
    }),
    updatedAt: d.updatedAt,
    displaySubject: d.displaySubject,
    displayFrom: d.displayFrom,
    folder: d.folder,
  })),
});
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/cfa/code/kurir-server && pnpm exec vitest run src/__tests__/integration/mobile-drafts.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/mobile/drafts/route.ts src/__tests__/integration/mobile-drafts.test.ts
git commit -m "feat(drafts): enrich mobile draft list with thread display fields"
```

---

### Task 5: MCP list_mail drafts, get_thread.draft, descriptions

**Files:**
- Modify: `src/lib/mcp/tools/mail.ts`
- Modify: `src/lib/mcp/tools/send.ts`
- Modify: `src/__tests__/unit/mcp-tools-mail.test.ts`

**Interfaces:**
- Consumes: `presentDraftsForUser`, `presentDraft`, `findReplyDraftForThread`
- Produces: `list_mail` draft rows include the three fields; `get_thread` returns `draft: object | null`; `save_draft` description text as in the spec; `send_mail` description mentions `draft`

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/unit/mcp-tools-mail.test.ts`:

Change the drafts mock to also export `saveDraftForUser` (already) and add:

```ts
vi.mock("@/lib/mail/draft-presentation", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/mail/draft-presentation")>();
  return {
    ...actual,
    presentDraftsForUser: vi.fn(),
    findReplyDraftForThread: vi.fn(),
  };
});
```

Prefer **not** mocking the whole module if the handlers call the real wrappers that themselves use mocked `db` / `listDraftsForUser`. Simpler path: keep mocking `listDraftsForUser` and `db`, and let the real `presentDraftsForUser` run. Then update the existing `list_mail drafts` test:

```ts
it("list_mail drafts uses listDraftsForUser and includes display fields", async () => {
  vi.mocked(listDraftsForUser).mockResolvedValue([
    {
      id: "d1",
      type: "REPLY",
      contextMessageId: "m1",
      to: "ada@x.y",
      subject: "",
      body: "hello",
      updatedAt: new Date("2026-08-02T00:00:00Z"),
    },
  ] as never);
  vi.mocked(db.message.findMany).mockResolvedValue([
    {
      id: "m1",
      subject: "Q3 budget",
      fromName: "Ada Lovelace",
      fromAddress: "ada@x.y",
      isInImbox: true,
      isInFeed: false,
      isInPaperTrail: false,
      isArchived: false,
    },
  ] as never);

  const result = await call("list_mail", { view: "drafts" });
  expect(listDraftsForUser).toHaveBeenCalledWith("u1");
  expect(result.type).toBe("ok");
  if (result.type !== "ok") return;
  const content = result.structuredContent as {
    items: Array<Record<string, unknown>>;
  };
  expect(content.items[0]).toMatchObject({
    displaySubject: "Q3 budget",
    displayFrom: "Ada Lovelace",
    folder: "imbox",
  });
});
```

Add `db.draft.findMany` to the `db` mock in this file (`draft: { findMany: vi.fn() }`).

Extend the existing `get_thread` success case:

```ts
vi.mocked(db.draft.findMany).mockResolvedValue([
  {
    type: "REPLY",
    contextMessageId: "m1",
    to: "ada@x.y",
    cc: "",
    bcc: "",
    subject: "",
    body: "draft body",
    updatedAt: new Date("2026-08-02T00:00:00Z"),
  },
] as never);
// after the found call:
const content = found.structuredContent as {
  messages: Array<Record<string, unknown>>;
  draft: Record<string, unknown> | null;
};
expect(content.draft).toMatchObject({
  type: "REPLY",
  contextMessageId: "m1",
  body: "draft body",
  displaySubject: "Hello",
  displayFrom: "Ada",
});
```

`get_thread` currently does not call `db.draft.findMany`, so this fails until wired. Also add:

```ts
it("save_draft description tells the agent to use a message id and the Drafts folder", () => {
  const tool = getTool("save_draft");
  expect(tool?.description).toMatch(/message id from get_thread/i);
  expect(tool?.description).toMatch(/Drafts/i);
  expect(tool?.description).not.toMatch(/__new__/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/cfa/code/kurir-server && pnpm exec vitest run src/__tests__/unit/mcp-tools-mail.test.ts`

Expected: FAIL on missing `displaySubject` / `draft` / description.

- [ ] **Step 3: Wire MCP**

In `listDrafts` (`src/lib/mcp/tools/mail.ts`), switch to `presentDraftsForUser` and add the three fields on each item (keep existing `id`, `type`, `contextMessageId`, `to`, `subject`, `date`, `snippet`, flags).

In `getThread`, after loading messages:

```ts
const draftRow = await findReplyDraftForThread(
  ctx.userId,
  result.messages.map((m) => m.id),
);
let draft = null;
if (draftRow) {
  const pinned = result.messages.find(
    (m) => m.id === draftRow.contextMessageId,
  );
  const presented = presentDraft(
    draftRow,
    pinned
      ? {
          subject: pinned.subject,
          fromName: pinned.fromName,
          fromAddress: pinned.fromAddress,
          isInImbox: pinned.isInImbox,
          isInFeed: pinned.isInFeed,
          isInPaperTrail: pinned.isInPaperTrail,
          isArchived: pinned.isArchived,
        }
      : null,
  );
  draft = {
    type: draftRow.type,
    contextMessageId: draftRow.contextMessageId,
    to: draftRow.to,
    cc: draftRow.cc,
    bcc: draftRow.bcc,
    subject: draftRow.subject,
    body: draftRow.body,
    updatedAt: draftRow.updatedAt.toISOString(),
    ...presented,
  };
}
return {
  type: "ok",
  structuredContent: {
    messages: result.messages.map((m) =>
      serializeThreadMessage(m as MailRowInput),
    ),
    draft,
  },
};
```

`getThreadMessages` rows may not include category flags. If they do not, pass `isInImbox: false` etc. so `folder` falls back to `imbox`, or load the pinned message via `loadDraftContextMessage`. Prefer `loadDraftContextMessage(ctx.userId, draftRow.contextMessageId)` for accurate `folder`/`displayFrom`.

Replace `save_draft` description with:

```
Save a draft. It appears in the user's Drafts folder and on the thread. For a reply use type REPLY and contextMessageId = the message id from get_thread (the id field, not threadId). For new mail use type NEW and a client UUID. Do not write the email only in chat.
```

In `src/lib/mcp/tools/send.ts` append to the `send_mail` description: ` If this send came from save_draft, pass draft { type, contextMessageId } so the draft is deleted after a successful send.`

- [ ] **Step 4: Run tests**

Run: `cd /Users/cfa/code/kurir-server && pnpm exec vitest run src/__tests__/unit/mcp-tools-mail.test.ts`

Expected: PASS. Fix `get_thread` test if message rows lack `fromName` (the existing fixture has `fromName: "Ada"`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp/tools/mail.ts src/lib/mcp/tools/send.ts src/__tests__/unit/mcp-tools-mail.test.ts
git commit -m "feat(mcp): expose thread draft context on list and get_thread"
```

---

### Task 6: MCP save_draft validation and fill

**Files:**
- Modify: `src/lib/mail/draft-presentation.ts`
- Modify: `src/lib/mcp/tools/mail.ts`
- Modify: `src/__tests__/unit/draft-presentation.test.ts`
- Modify: `src/__tests__/unit/mcp-tools-mail.test.ts`

**Interfaces:**
- Consumes: `loadDraftContextMessage`, `replyDraftSubject`, `presentDraft`, `CONTEXT_MESSAGE_ID_ERROR`
- Produces:

```ts
export async function prepareDraftSave(
  userId: string,
  input: SaveDraftInput,
): Promise<{ ok: true; input: SaveDraftInput } | { ok: false; message: string }>;
```

- [ ] **Step 1: Write the failing tests**

In `draft-presentation.test.ts`:

```ts
import { prepareDraftSave, CONTEXT_MESSAGE_ID_ERROR } from "@/lib/mail/draft-presentation";

describe("prepareDraftSave", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects REPLY when the context is not an owned message", async () => {
    vi.mocked(db.message.findFirst).mockResolvedValue(null);
    const result = await prepareDraftSave("u1", {
      type: "REPLY",
      contextMessageId: "th-thread-id",
    });
    expect(result).toEqual({
      ok: false,
      message: CONTEXT_MESSAGE_ID_ERROR,
    });
  });

  it("fills subject and connection from the original message", async () => {
    vi.mocked(db.message.findFirst).mockResolvedValue({
      id: "m1",
      subject: "Q3 budget",
      fromName: "Ada",
      fromAddress: "ada@x.y",
      isInImbox: true,
      isInFeed: false,
      isInPaperTrail: false,
      isArchived: false,
      emailConnectionId: "conn-1",
    } as never);
    const result = await prepareDraftSave("u1", {
      type: "REPLY",
      contextMessageId: "m1",
      body: "hello",
    });
    expect(result).toEqual({
      ok: true,
      input: {
        type: "REPLY",
        contextMessageId: "m1",
        body: "hello",
        subject: "Q3 budget",
        emailConnectionId: "conn-1",
      },
    });
  });
});
```

In `mcp-tools-mail.test.ts`:

```ts
it("save_draft REPLY with an unknown id returns the message-id error", async () => {
  vi.mocked(db.message.findFirst).mockResolvedValue(null);
  const result = await call("save_draft", {
    type: "REPLY",
    contextMessageId: "th-1",
    body: "hi",
  });
  expect(result).toEqual({
    type: "error",
    message: CONTEXT_MESSAGE_ID_ERROR,
  });
  expect(saveDraftForUser).not.toHaveBeenCalled();
});

it("save_draft REPLY against an owned message returns display fields", async () => {
  vi.mocked(db.message.findFirst).mockResolvedValue({
    id: "m1",
    subject: "Q3 budget",
    fromName: "Ada Lovelace",
    fromAddress: "ada@x.y",
    isInImbox: false,
    isInFeed: true,
    isInPaperTrail: false,
    isArchived: false,
    emailConnectionId: "conn-1",
  } as never);
  vi.mocked(saveDraftForUser).mockResolvedValue({
    id: "d1",
    type: "REPLY",
    contextMessageId: "m1",
    subject: "Q3 budget",
    to: "",
    body: "hello",
  } as never);

  const result = await call("save_draft", {
    type: "REPLY",
    contextMessageId: "m1",
    body: "hello",
  });
  expect(saveDraftForUser).toHaveBeenCalledWith(
    "u1",
    expect.objectContaining({
      subject: "Q3 budget",
      emailConnectionId: "conn-1",
    }),
  );
  expect(result.type).toBe("ok");
  if (result.type !== "ok") return;
  expect(result.structuredContent).toMatchObject({
    id: "d1",
    displaySubject: "Q3 budget",
    displayFrom: "Ada Lovelace",
    folder: "feed",
  });
});
```

Add `message.findFirst` to this file's `db` mock if missing. Import `CONTEXT_MESSAGE_ID_ERROR` and `saveDraftForUser`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/cfa/code/kurir-server && pnpm exec vitest run src/__tests__/unit/draft-presentation.test.ts src/__tests__/unit/mcp-tools-mail.test.ts`

Expected: FAIL, `prepareDraftSave` is not exported / save still succeeds without a message.

- [ ] **Step 3: Implement**

```ts
import type { SaveDraftInput } from "@/lib/mail/drafts";

export async function prepareDraftSave(
  userId: string,
  input: SaveDraftInput,
): Promise<
  { ok: true; input: SaveDraftInput } | { ok: false; message: string }
> {
  if (input.type === "NEW") return { ok: true, input };
  const message = await loadDraftContextMessage(userId, input.contextMessageId);
  if (!message) {
    return { ok: false, message: CONTEXT_MESSAGE_ID_ERROR };
  }
  return {
    ok: true,
    input: {
      ...input,
      subject: replyDraftSubject(input.subject, message.subject ?? ""),
      emailConnectionId: input.emailConnectionId ?? message.emailConnectionId,
    },
  };
}
```

In `saveDraft` handler:

```ts
const parsed = saveDraftSchema.safeParse(args);
if (!parsed.success) return err(firstZodMessage(parsed.error));
const prepared = await prepareDraftSave(ctx.userId, parsed.data);
if (!prepared.ok) return err(prepared.message);
const draft = await saveDraftForUser(ctx.userId, prepared.input);
const message =
  prepared.input.type === "NEW"
    ? null
    : await loadDraftContextMessage(ctx.userId, prepared.input.contextMessageId);
return ok({
  id: draft.id,
  type: draft.type,
  contextMessageId: draft.contextMessageId,
  ...presentDraft(draft, message),
});
```

You can skip the second `loadDraftContextMessage` by returning the message from `prepareDraftSave` (`ok: true` includes `message`). Prefer that so there is one lookup:

```ts
{ ok: true; input: SaveDraftInput; message: DraftContextMessage | null }
```

Update the unit test for `prepareDraftSave` if the return shape includes `message`.

- [ ] **Step 4: Run tests**

Run: `cd /Users/cfa/code/kurir-server && pnpm exec vitest run src/__tests__/unit/draft-presentation.test.ts src/__tests__/unit/mcp-tools-mail.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mail/draft-presentation.ts src/lib/mcp/tools/mail.ts src/__tests__/unit/draft-presentation.test.ts src/__tests__/unit/mcp-tools-mail.test.ts
git commit -m "feat(mcp): require a real message id when saving reply drafts"
```

---

### Task 7: Web thread pin and reply subject

**Files:**
- Modify: `src/components/mail/thread-detail-view.tsx`
- Modify: `src/components/mail/thread-page-content.tsx`
- Modify: `src/components/mail/reply-composer.tsx`
- Modify: `src/__tests__/unit/draft-presentation.test.ts` (already covers `replyDraftSubject`)

**Interfaces:**
- Consumes: `findReplyDraftForThread`, `replyDraftSubject`
- Produces: `ReplyComposer` saves a non-empty subject; thread page passes the pinned `messageId` and `hasDraft`

There is no ReplyComposer unit test file. Do not mount the whole composer. The subject merge is already tested as `replyDraftSubject`. This task is the wiring plus a small extracted pin helper if thread-detail-view is too heavy to test.

Add a pure helper in `draft-presentation.ts` if useful:

```ts
export function pinnedReplyMessageId(
  draftContextId: string | null,
  fallbackId: string,
): string {
  return draftContextId ?? fallbackId;
}
```

Only add it if you write a test. Otherwise wire directly.

- [ ] **Step 1: Confirm `replyDraftSubject` tests already exist and pass**

Run: `cd /Users/cfa/code/kurir-server && pnpm exec vitest run src/__tests__/unit/draft-presentation.test.ts`

Expected: PASS (from Task 1). If you did not add `replyDraftSubject` tests in Task 1, add them now and watch a temporary wrong implementation fail first. Do not skip this.

- [ ] **Step 2: Wire ThreadDetailView**

After `const { messages, markedRead } = threadResult;` and once `lastIncoming` / `lastMessage` are computed:

```ts
const replyDraft = await findReplyDraftForThread(
  session.user.id,
  messages.map((m) => m.id),
);
const pinned =
  (replyDraft &&
    messages.find((m) => m.id === replyDraft.contextMessageId)) ||
  lastIncoming ||
  lastMessage;
```

Compute `replyToAddress`, `replyToName`, `replyAllExtraTo`, `replyAllCc`, `rfcMessageId`, `references` from `pinned` instead of `lastIncoming` when `replyDraft` is set. When there is no draft, keep today's last-incoming logic unchanged (use `lastIncoming` as now).

Pass into `ThreadPageContent`:

```ts
replyToMessageId={pinned.id}
subject={pinned.subject || "(no subject)"}
hasDraft={Boolean(replyDraft)}
```

Add `hasDraft?: boolean` to `ThreadPageContent` and forward it to `ReplyComposer`.

Use `pinned` for `rfcMessageId` / `references` the same way the file currently uses `lastMessage` / `lastIncoming`. Read the current block around those fields and point them at `pinned` only when `replyDraft` is set.

- [ ] **Step 3: Stop saving an empty subject**

In `reply-composer.tsx`:

```ts
const [savedSubject, setSavedSubject] = useState("");

// inside loadDraft().then:
if (draft.subject) setSavedSubject(draft.subject);

// in the autosave effect:
saveDraft({
  to,
  cc,
  bcc,
  subject: replyDraftSubject(savedSubject, subject),
  body,
  attachmentIds,
});
```

Import `replyDraftSubject` from `@/lib/mail/draft-presentation`.

Pass `hasDraft={hasDraft}` through from `ThreadPageContent` (the composer already accepts `hasDraft` and opens when it is true).

- [ ] **Step 4: Run the unit suite that covers drafts**

Run: `cd /Users/cfa/code/kurir-server && pnpm exec vitest run src/__tests__/unit/draft-presentation.test.ts src/__tests__/unit/drafts-list.test.tsx src/__tests__/unit/mcp-tools-mail.test.ts src/__tests__/integration/mobile-drafts.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/mail/thread-detail-view.tsx src/components/mail/thread-page-content.tsx src/components/mail/reply-composer.tsx
git commit -m "feat(drafts): pin the reply composer to the thread draft"
```

Server is shippable after this task. Old iOS clients ignore the extra JSON keys.

---

## Part B: kurir-ios

Work in `/Users/cfa/code/kurir-ios` on branch `cfarvidson/mcp-thread-drafts` created from current `main`.

### Task 8: Display fields on the native catalog row

**Files:**
- Create: `Kurir/Sources/Mail/DraftPresentation.swift`
- Modify: `Kurir/Sources/Networking/APIModels.swift`
- Modify: `Kurir/Sources/Mail/DraftStore.swift`
- Modify: `Kurir/Sources/Mail/DraftsListView.swift`
- Modify: `Kurir/Tests/DraftTests.swift`

**Interfaces:**
- Consumes: `APIDraft.displaySubject/displayFrom/folder` (optional JSON)
- Produces: `DraftPresentation.present(...)` and `DraftListItem` fields; `DraftRow.recipientLine` / `subjectLine` prefer them

- [ ] **Step 1: Write the failing tests**

In `DraftTests.swift` add:

```swift
func testPresentReplyUsesOriginalSubjectAndFrom() {
    let presented = DraftPresentation.present(
        type: "REPLY",
        draftSubject: "  ",
        messageSubject: "Q3 budget",
        fromName: "Ada Lovelace",
        fromAddress: "ada@x.y"
    )
    XCTAssertEqual(presented.displaySubject, "Q3 budget")
    XCTAssertEqual(presented.displayFrom, "Ada Lovelace")
}

func testDraftRowPrefersDisplayFields() {
    var item = DraftListItem(draft: Self.apiDraft(type: "REPLY"))
    item = DraftListItem(
        type: item.type,
        contextMessageId: item.contextMessageId,
        to: item.to,
        subject: "",
        body: item.body,
        emailConnectionId: item.emailConnectionId,
        attachmentIds: item.attachmentIds,
        updatedAt: item.updatedAt,
        displaySubject: "Q3 budget",
        displayFrom: "Ada Lovelace",
        folder: "feed"
    )
    XCTAssertEqual(DraftRow.subjectLine(item), "Q3 budget")
    XCTAssertEqual(DraftRow.recipientLine(item), "Ada Lovelace")
}
```

If `DraftListItem` is a struct with `let` properties, give it a memberwise init that includes the new optionals defaulting to `nil`, and construct via that. Prefer adding:

```swift
func withDisplay(subject: String?, from: String?, folder: String?) -> DraftListItem
```

and test through that, so the test does not depend on a huge initializer.

- [ ] **Step 2: Run tests to verify they fail**

Run the `DraftTests` target from Xcode or:

```bash
cd /Users/cfa/code/kurir-ios
xcodebuild test -scheme Kurir -destination 'platform=macOS' -only-testing:KurirTests/DraftTests/testPresentReplyUsesOriginalSubjectAndFrom
```

Use the same destination/scheme the repo already uses (check README / existing scripts). Expected: FAIL, `DraftPresentation` not found.

- [ ] **Step 3: Implement**

`DraftPresentation.swift`:

```swift
struct DraftPresentation: Equatable {
    var displaySubject: String
    var displayFrom: String?
    var folder: String?

    static func present(
        type: String,
        draftSubject: String,
        messageSubject: String?,
        fromName: String?,
        fromAddress: String?
    ) -> DraftPresentation {
        let saved = draftSubject.trimmingCharacters(in: .whitespacesAndNewlines)
        let original = (messageSubject ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let from: String?
        if type == "REPLY", fromAddress != nil || fromName != nil {
            let name = (fromName ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            from = name.isEmpty ? fromAddress : name
        } else {
            from = nil
        }
        return DraftPresentation(
            displaySubject: saved.isEmpty ? original : saved,
            displayFrom: from,
            folder: nil
        )
    }
}
```

`APIDraft`: add optional `displaySubject: String?`, `displayFrom: String?`, `folder: String?`. Synthesized `Codable` uses `decodeIfPresent`. Update `Self.apiDraft` in tests to compile (add defaults `displaySubject: nil, displayFrom: nil, folder: nil` via a memberwise init with defaults on `APIDraft` if call sites break). Only `DraftTests.apiDraft` constructs `APIDraft(` today.

`DraftListItem`: add the three optional fields. `init(draft:)` copies them from `APIDraft`. `init(record:)` leaves them nil (filled later).

Add `DraftStore.enrichForDisplay(_ items: [DraftListItem], messages: [MessageRecord]) -> [DraftListItem]` that, for each non-NEW item, uses API display fields if `displaySubject`/`displayFrom` are already set, otherwise `DraftPresentation.present` with the matching `MessageRecord`.

Call it from `DraftStore.list` after `mergeForList`, reading those messages from GRDB (`MessageRecord.fetchOne` per distinct context id). Keep that lookup inside the actor.

`DraftRow.subjectLine`: if `item.displaySubject` is non-empty after trim, return it; else today's logic on `item.subject`.

`DraftRow.recipientLine`: if `item.type == "REPLY"` and `item.displayFrom` is non-empty, return it; else today's `To:` logic.

- [ ] **Step 4: Run DraftTests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/cfa/code/kurir-ios
git checkout -b cfarvidson/mcp-thread-drafts
git add Kurir/Sources/Mail/DraftPresentation.swift \
  Kurir/Sources/Networking/APIModels.swift \
  Kurir/Sources/Mail/DraftStore.swift \
  Kurir/Sources/Mail/DraftsListView.swift \
  Kurir/Tests/DraftTests.swift
git commit -m "feat(drafts): show thread subject and sender on reply rows"
```

---

### Task 9: Open a reply onto ThreadView

**Files:**
- Modify: `Kurir/Sources/Mail/DraftPresentation.swift`
- Modify: `Kurir/Sources/Mail/DraftsListView.swift`
- Modify: `Kurir/Tests/DraftTests.swift`

**Interfaces:**
- Consumes: local `MessageRecord` for `contextMessageId`
- Produces:

```swift
enum DraftCatalogOpen: Equatable {
    case newCompose(contextMessageId: String)
    case thread(messageId: String)
    case forward(messageId: String)
    case orphanRestore
}

static func resolveOpen(
    type: String,
    contextMessageId: String,
    messageFound: Bool
) -> DraftCatalogOpen
```

- [ ] **Step 1: Write the failing tests**

```swift
func testResolveOpenReplyWithMessageGoesToThread() {
    XCTAssertEqual(
        DraftPresentation.resolveOpen(
            type: "REPLY", contextMessageId: "m1", messageFound: true
        ),
        .thread(messageId: "m1")
    )
}

func testResolveOpenReplyWithoutMessageIsOrphan() {
    XCTAssertEqual(
        DraftPresentation.resolveOpen(
            type: "REPLY", contextMessageId: "m1", messageFound: false
        ),
        .orphanRestore
    )
}

func testResolveOpenForwardStaysCompose() {
    XCTAssertEqual(
        DraftPresentation.resolveOpen(
            type: "FORWARD", contextMessageId: "m1", messageFound: true
        ),
        .forward(messageId: "m1")
    )
}

func testResolveOpenNewStaysCompose() {
    XCTAssertEqual(
        DraftPresentation.resolveOpen(
            type: "NEW", contextMessageId: "uuid-1", messageFound: false
        ),
        .newCompose(contextMessageId: "uuid-1")
    )
}
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL, `resolveOpen` missing.

- [ ] **Step 3: Implement resolveOpen and wire `DraftsListView.open`**

```swift
static func resolveOpen(
    type: String,
    contextMessageId: String,
    messageFound: Bool
) -> DraftCatalogOpen {
    switch type {
    case "NEW":
        return .newCompose(contextMessageId: contextMessageId)
    case "REPLY":
        return messageFound
            ? .thread(messageId: contextMessageId)
            : .orphanRestore
    case "FORWARD":
        return messageFound
            ? .forward(messageId: contextMessageId)
            : .orphanRestore
    default:
        return .orphanRestore
    }
}
```

In `DraftsListView`:

- Add `@State private var openThread: MailThread?`
- Add `.navigationDestination(item: $openThread) { ThreadView(thread: $0) }` on both iOS and macOS (same as `FilesView`)
- On macOS, keep `openTarget` only for NEW / FORWARD / orphan compose
- Rewrite `open(_ item:)`:

```swift
let message = try? await mail.database.writer.read { db in
    try MessageRecord.fetchOne(db, key: item.contextMessageId)
}
switch DraftPresentation.resolveOpen(
    type: item.type,
    contextMessageId: item.contextMessageId,
    messageFound: message != nil
) {
case .newCompose(let id):
    openTarget = .compose(.new(initialTo: nil, draftContextId: id))
case .forward:
    if let message { openTarget = .compose(.forward(message)) }
case .thread:
    if let message {
        openThread = MailThread(
            id: message.threadId ?? message.id,
            latest: message,
            messageCount: 1,
            hasUnread: !message.isRead
        )
    }
case .orphanRestore:
    openTarget = .restore(ComposeSnapshot(
        to: item.to, cc: "", bcc: "", subject: item.subject,
        bodyText: item.body,
        attachments: item.attachmentIds.map {
            PendingAttachment(id: $0, filename: "Attachment", size: 0)
        },
        mode: .new(
            initialTo: nil,
            draftContextId: UUID().uuidString.lowercased()
        ),
        addedGroups: []
    ))
    if mail.lastSyncAt != nil { pendingOrphanDelete = item }
}
```

On macOS, `openTarget` currently replaces the whole list. Leave that for compose/orphan. Thread uses the stack, so Back returns to Drafts.

On iOS, the existing `.sheet(item: $openTarget)` still presents NEW/orphan/forward. Thread uses `navigationDestination`.

- [ ] **Step 4: Run DraftTests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Kurir/Sources/Mail/DraftPresentation.swift \
  Kurir/Sources/Mail/DraftsListView.swift \
  Kurir/Tests/DraftTests.swift
git commit -m "feat(drafts): open reply drafts on the thread"
```

---

### Task 10: Pin the native reply composer

**Files:**
- Modify: `Kurir/Sources/Mail/DraftPresentation.swift`
- Modify: `Kurir/Sources/Mail/ThreadView.swift`
- Modify: `Kurir/Tests/DraftTests.swift`

**Interfaces:**
- Consumes: `DraftStore` rows + thread message ids
- Produces:

```swift
static func pinReply(
    drafts: [(contextMessageId: String, updatedAt: Date)],
    threadMessageIds: [String]
) -> String?
```

- [ ] **Step 1: Write the failing tests**

```swift
func testPinReplyPicksNewestInThread() {
    let pinned = DraftPresentation.pinReply(
        drafts: [
            (contextMessageId: "m1", updatedAt: Date(timeIntervalSince1970: 1)),
            (contextMessageId: "m2", updatedAt: Date(timeIntervalSince1970: 2)),
            (contextMessageId: "other", updatedAt: Date(timeIntervalSince1970: 9)),
        ],
        threadMessageIds: ["m1", "m2"]
    )
    XCTAssertEqual(pinned, "m2")
}

func testPinReplyReturnsNilWhenThreadHasNoDraft() {
    XCTAssertNil(
        DraftPresentation.pinReply(
            drafts: [(contextMessageId: "m1", updatedAt: Date())],
            threadMessageIds: ["m9"]
        )
    )
}
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL, `pinReply` missing.

- [ ] **Step 3: Implement and wire ThreadView**

```swift
static func pinReply(
    drafts: [(contextMessageId: String, updatedAt: Date)],
    threadMessageIds: [String]
) -> String? {
    let ids = Set(threadMessageIds)
    return drafts
        .filter { ids.contains($0.contextMessageId) }
        .max { $0.updatedAt < $1.updatedAt }?
        .contextMessageId
}
```

In `ThreadView`, replace `replyMessage` usage for draft restore:

Add a method that loads local REPLY drafts whose `contextMessageId` is in `messages.map(\.id)` (GRDB `DraftRecord` filter `type == "REPLY"`). Compute `pinReply`. If a pin exists, `replyMessage` for the dock becomes `messages.first { $0.id == pinnedId } ?? messages.last`.

On macOS, `restoreReplyDraftIfNeeded` / `refreshHasReplyDraft` must use that pinned message, not `messages.last`.

On iOS, when `showReply` is presented from the dock, use the pinned message. Also auto-present the reply sheet / dock once if a pin exists (mirror macOS `didAutoRestoreDraft` on iOS too, so opening from Drafts shows the text immediately).

`ComposeView(replyTo:)` already keys the draft as `REPLY` + `message.id`, so passing the pinned message is what loads the MCP body.

- [ ] **Step 4: Run DraftTests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Kurir/Sources/Mail/DraftPresentation.swift \
  Kurir/Sources/Mail/ThreadView.swift \
  Kurir/Tests/DraftTests.swift
git commit -m "feat(drafts): restore the pinned reply draft on the thread"
```

---

## Self-review (spec coverage)

| Spec requirement | Task |
| --- | --- |
| `presentDraft` display fields | 1 |
| `presentDraftsForUser` | 2, 3, 4, 5 |
| `findReplyDraftForThread` newest wins | 1 (pure), 2 (DB), 10 (Swift) |
| Catalog row from + subject | 3, 8 |
| `folder` + web href | 1, 3 |
| Mobile GET fields | 4 |
| MCP `list_mail` drafts fields | 5 |
| MCP `get_thread.draft` | 5 |
| MCP `save_draft` description | 5 |
| MCP `save_draft` validation + fill + display payload | 6 |
| `send_mail` description mentions `draft` | 5 |
| Web pin + reply headers + open composer | 7 |
| Reply composer stops saving `subject: ""` | 7 |
| No `Re:` prefix | 1, 6 (`replyDraftSubject`) |
| Exact error string, no "not found" remap | 6 |
| Inherit `emailConnectionId` | 6 |
| FORWARD stays compose | 1, 9 |
| Orphan detached compose | 1, 3, 9 |
| iOS/macOS display fields | 8 |
| iOS/macOS open ThreadView | 9 |
| iOS/macOS pin + auto-open dock | 10 |
| No sidebar count / list badge / IMAP / get_draft | not implemented |

No placeholders left. Types: `DraftFolder`, `DraftPresentation`, `presentDraft`, `presentDraftsForUser`, `findReplyDraftForThread`, `prepareDraftSave`, `CONTEXT_MESSAGE_ID_ERROR`, `DraftCatalogOpen`, `DraftPresentation.pinReply` / `resolveOpen` are used under the same names in later tasks.
