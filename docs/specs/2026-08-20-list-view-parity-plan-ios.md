# List view parity (kurir-ios) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** iOS and macOS mail lists match the shared contract: same row chrome, New For You sections, per-list search, Reply Later focus stack, empty copy, and select-bar actions.

**Architecture:** A pure `ListContract.swift` mirrors `src/lib/mail/list-contract.ts`. Views call it. Do not start this plan until `GET /api/mobile/search?category=` exists on the server (server plan Task 2).

**Tech Stack:** SwiftUI, GRDB, XCTest. Repo: `/Users/cfa/code/kurir-ios`, branch `cfarvidson/list-view-parity`.

**Spec:** `docs/specs/2026-08-20-list-view-parity-design.md` in kurir-server (copy the contract tables; do not fork them).

## Global Constraints

- UI strings in English. No em dashes in comments or copy.
- DESIGN.md: terracotta unread tick, no avatars, no pill badges.
- TDD: failing XCTest first. iOS: `xcodebuild test -project Kurir.xcodeproj -scheme Kurir -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -only-testing:KurirTests/<Class>`.
- Platform allowlist: iOS keeps `navigationTitle` + `.searchable`. Mac keeps `MacPageMasthead` + hover. Mac keeps the 200-row window. iOS dates stay `MessageRow.dateString`.
- `MailList.followUp.rawValue` may stay `Follow-up` for the More tab. Masthead title and empty copy use `Follow Up`.
- Reply Later is not `MessageListView`.
- Search hits stay per-message. Do not fake `messageCount: 1` as a thread.

---

## Files

- Create: `Kurir/Sources/Mail/ListContract.swift`
- Create: `Kurir/Tests/ListContractTests.swift`
- Create: `Kurir/Sources/Mail/ReplyLaterFocusView.swift`
- Create: `Kurir/Tests/ReplyLaterFocusTests.swift`
- Modify: `Kurir/Sources/Mail/MessageListView.swift` (`MessageRow`, sections, search, empty, swipe)
- Modify: `Kurir/Sources/Mail/RowActionSet.swift` (already correct; swipe must call it)
- Modify: `Kurir/Tests/RowActionSetTests.swift`
- Modify: `Kurir/Sources/Mail/MastheadInfo.swift`
- Modify: `Kurir/Tests/MastheadInfoTests.swift`
- Modify: `Kurir/Sources/Networking/APIClient.swift`
- Modify: `Kurir/Tests/APIClientAuthTests.swift` or a new `APIClientSearchTests.swift`
- Modify: `Kurir/Sources/Mail/MacSelectionBar.swift`
- Modify: `Kurir/Sources/Mail/MoreView.swift`
- Modify: `Kurir/Sources/Mail/MailSplitView.swift` / `MailRootView.swift`
- Modify: `Kurir/Sources/Mail/ContactsView.swift`
- Modify: `Kurir/Tests/ContactsTests.swift`
- Modify: `Kurir/Sources/Mail/ScheduledListView.swift`
- Modify: `Kurir/Sources/Mail/FilesView.swift`
- Modify: `Kurir/Sources/Mail/DraftsListView.swift`

---

### Task 1: ListContract (pure)

**Files:**
- Create: `Kurir/Sources/Mail/ListContract.swift`
- Test: `Kurir/Tests/ListContractTests.swift`

**Interfaces:**
- Consumes: `MailList`
- Produces:

```swift
enum ListContract {
    struct EmptyCopy: Equatable {
        var title: String
        var description: String
    }

    static func threadCountLabel(_ count: Int) -> String?
    static func showsSections(_ list: MailList) -> Bool
    static func showsSearch(_ list: MailList) -> Bool
    static func emptyCopy(_ list: MailList) -> EmptyCopy
    static func emptyCopy(sidebar item: SidebarItem) -> EmptyCopy
    static func searchCategoryParam(_ list: MailList) -> String?
    static func swipeTrailing(_ list: MailList) -> TrailingSwipe
    enum TrailingSwipe: Equatable {
        case archive
        case unarchive
        case none
    }
}
```

`searchCategoryParam(.imbox) == "imbox"`, `.paperTrail == "paper-trail"`, `.followUp == "follow-up"`, `.replyLater == nil`.

- [ ] **Step 1: Write the failing tests**

```swift
import XCTest
@testable import Kurir

final class ListContractTests: XCTestCase {
    func testThreadCountLabel() {
        XCTAssertNil(ListContract.threadCountLabel(1))
        XCTAssertEqual(ListContract.threadCountLabel(4), "·4")
    }

    func testSectionsOnlyOnTheThreeMainLists() {
        XCTAssertTrue(ListContract.showsSections(.imbox))
        XCTAssertTrue(ListContract.showsSections(.feed))
        XCTAssertTrue(ListContract.showsSections(.paperTrail))
        XCTAssertFalse(ListContract.showsSections(.archive))
        XCTAssertFalse(ListContract.showsSections(.replyLater))
    }

    func testSearchOnSevenLists() {
        for list in [MailList.imbox, .feed, .paperTrail, .snoozed,
                     .followUp, .sent, .archive] {
            XCTAssertTrue(ListContract.showsSearch(list), "\(list)")
            XCTAssertNotNil(ListContract.searchCategoryParam(list))
        }
        XCTAssertFalse(ListContract.showsSearch(.replyLater))
        XCTAssertNil(ListContract.searchCategoryParam(.replyLater))
    }

    func testEmptyCopyMatchesWeb() {
        XCTAssertEqual(
            ListContract.emptyCopy(.imbox).title,
            "Your Imbox is empty")
        XCTAssertEqual(
            ListContract.emptyCopy(.imbox).description,
            "Approve senders in the Screener to see their emails here.")
        XCTAssertEqual(
            ListContract.emptyCopy(.replyLater).title,
            "All caught up")
    }

    func testSentHasNoTrailingArchiveSwipe() {
        XCTAssertEqual(ListContract.swipeTrailing(.sent), .none)
        XCTAssertEqual(ListContract.swipeTrailing(.imbox), .archive)
        XCTAssertEqual(ListContract.swipeTrailing(.archive), .unarchive)
    }

    func testSearchParamUsesServerSlugs() {
        XCTAssertEqual(ListContract.searchCategoryParam(.paperTrail), "paper-trail")
        XCTAssertEqual(ListContract.searchCategoryParam(.followUp), "follow-up")
    }
}
```

Add `ListContract.swift` to `project.yml` sources if the project is XcodeGen-driven (`project.yml` at repo root). If the Xcode project auto-includes `Kurir/Sources/Mail/*.swift`, skip.

- [ ] **Step 2: Run test to verify it fails**

Run: `xcodebuild test -project Kurir.xcodeproj -scheme Kurir -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -only-testing:KurirTests/ListContractTests`

Expected: FAIL, `ListContract` not found

- [ ] **Step 3: Write minimal implementation**

Copy titles and descriptions verbatim from the spec table. Contacts empty: iOS description `Add a contact with the + button.` via `emptyCopy(sidebar: .contacts)`.

- [ ] **Step 4: Run tests and make sure they pass**

Same `xcodebuild` as Step 2. Expected: PASS

- [ ] **Step 5: Commit** (in kurir-ios)

```bash
git add Kurir/Sources/Mail/ListContract.swift Kurir/Tests/ListContractTests.swift project.yml
git commit -m "feat: add ListContract mirroring the web list helpers"
```

---

### Task 2: MessageRow chrome

**Files:**
- Modify: `Kurir/Sources/Mail/MessageListView.swift` (`MessageRow`)
- Modify: `Kurir/Tests/MessageRowDateTests.swift` (or new `MessageRowChromeTests.swift`)

**Interfaces:**
- Consumes: `ListContract.threadCountLabel`, `thread.latest.hasAttachments`, `thread.latest.snoozedUntil`, `thread.latest.followUpAt`
- Produces: `·N`, paperclip, two-line snippet on **both** platforms, snooze time when `showSnoozeMeta`, follow-up time when `followUpAt != nil`.

Add `var showSnoozeMeta: Bool = false` on `MessageRow`. Call site passes `list == .snoozed`.

- [ ] **Step 1: Write the failing tests**

`MessageRow` is a View. Prefer testing a pure formatter:

```swift
enum MessageRowChrome {
    static func threadLabel(count: Int) -> String? {
        ListContract.threadCountLabel(count)
    }
    static func snippetLineLimit(platformIsMac: Bool) -> Int { 2 }
    static func showsPaperclip(_ hasAttachments: Bool) -> Bool { hasAttachments }
}
```

Put it in `ListContract.swift` as static helpers if that keeps one type. Tests in `ListContractTests`:

```swift
func testSnippetIsTwoLinesOnMacToo() {
    XCTAssertEqual(ListContract.snippetLineLimit, 2)
}
```

Then change `MessageRow.snippetLineLimit` to return `ListContract.snippetLineLimit` on both platforms.

- [ ] **Step 2: Run test to verify it fails**

`MessageRow` currently returns 1 on mac. If the helper defaults to 2, the test on the helper passes immediately after implementation. Watch the test fail by writing it against `MessageRow`'s current private limit: you cannot. So fail by asserting `ListContract.snippetLineLimit == 2` before the constant exists.

Expected: FAIL, `snippetLineLimit` missing

- [ ] **Step 3: Write minimal implementation**

In `MessageRow`:
- Thread count `Text(ListContract.threadCountLabel(thread.messageCount) ?? "")` only when non-nil, `.font(metaFont)`, mono
- `if thread.latest.hasAttachments { Image(systemName: "paperclip") ... }`
- `snippetLineLimit` always 2
- After snippet, if `showSnoozeMeta`, `snoozedUntil` text
- If `followUpAt != nil`, bell + formatted date

Pass `showSnoozeMeta: list == .snoozed` from `rowLink`.

- [ ] **Step 4: Run tests**

`xcodebuild ... -only-testing:KurirTests/ListContractTests` plus `MessageRowDateTests`. Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Kurir/Sources/Mail/MessageListView.swift Kurir/Sources/Mail/ListContract.swift Kurir/Tests/ListContractTests.swift
git commit -m "feat: native message rows show ·N, paperclip, two-line snippet"
```

---

### Task 3: New For You / Previously Seen

**Files:**
- Modify: `Kurir/Sources/Mail/MessageListView.swift` (`threadList`)
- Test: `Kurir/Tests/ListContractTests.swift` (section split)

**Interfaces:**
- Consumes: `ListContract.showsSections`, `MailThread.hasUnread`
- Produces:

```swift
enum ListContract {
    struct Sections {
        var unread: [MailThread]
        var read: [MailThread]
    }
    static func sections(in threads: [MailThread]) -> Sections
}
```

Empty section omitted (empty array, no header). Keyboard/focus order is unread then read.

- [ ] **Step 1: Write the failing test**

```swift
func testSectionsPutUnreadFirstAndOmitEmpty() {
    // Build two MailThread values; unread first in the unread bucket.
    // If all read, unread is empty.
}
```

Construct `MailThread` like `BulkActionsTests`.

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL, `sections(in:)` missing

- [ ] **Step 3: Write minimal implementation**

```swift
static func sections(in threads: [MailThread]) -> Sections {
    Sections(
        unread: threads.filter(\.hasUnread),
        read: threads.filter { !$0.hasUnread }
    )
}
```

In `threadList`, when `ListContract.showsSections(list)`:

```swift
let split = ListContract.sections(in: threads)
List {
    if !split.unread.isEmpty {
        Section {
            ForEach(split.unread.prefix(visibleLimit)) { rowView(for: $0) }
        } header: {
            Text("New For You").eyebrowStyle()
        }
    }
    if !split.read.isEmpty {
        Section {
            ForEach(split.read) { rowView(for: $0) }
        } header: {
            Text("Previously Seen").eyebrowStyle()
        }
    }
}
```

On iOS the same structure, without `visibleLimit` (full list). Do not regroup while the thread is open (existing web 300ms delay: skip regroup until `externalSelection == nil` on Mac, until the list is shown again on iOS). Simplest: derive sections from `store.threads` as-is; marking read already happens on open and the observation will regroup when the user pops back. That matches "do not regroup until the list is visible again" on iOS. On Mac the list stays visible beside the thread: delay the unread->read move like web.

Mac delay: keep a `Set<String> recentlyOpened` of thread ids that stay in New For You until `externalSelection` becomes nil, then clear. Test that helper:

```swift
static func visibleUnread(
    threads: [MailThread],
    pinnedIds: Set<String>
) -> [MailThread] {
    threads.filter { $0.hasUnread || pinnedIds.contains($0.id) }
}
```

Only needed on Mac. Implement if the list jumps while a thread is open; verify in the simulator after.

- [ ] **Step 4: Run tests** Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Kurir/Sources/Mail/MessageListView.swift Kurir/Sources/Mail/ListContract.swift Kurir/Tests/ListContractTests.swift
git commit -m "feat: section Imbox, Feed, and Paper Trail like the web"
```

---

### Task 4: Per-list filtered search

**Files:**
- Modify: `Kurir/Sources/Networking/APIClient.swift`
- Modify: `Kurir/Sources/Mail/MessageListView.swift`
- Test: new `Kurir/Tests/APIClientSearchTests.swift` if URL building is testable; else test `ListContract.searchCategoryParam` (already Task 1) and wire.

**Interfaces:**
- Consumes: `ListContract.showsSearch`, `ListContract.searchCategoryParam`
- Produces:

```swift
func search(query: String, category: String?, limit: Int = 50) async throws -> SearchResponse
```

Query items include `category` only when non-nil.

iOS `searchEnabled` becomes `ListContract.showsSearch(list)` (not `list == .imbox`). Prompt: `Search` not `Search all mail`.

Search results use `MessageRow` with `showSnoozeMeta: list == .snoozed` and keep swipe/hover disabled (finder, not a mailbox). Do not force `messageCount: 1` if the upserted record already has a real thread; `previewThread` today sets count 1. Leave count 1 on the preview (spec: no `·N` on search). Stop using a stub that hides attachments: `previewThread` should copy `hasAttachments` from the API message (it already does if it uses `MessageRecord(from:)`).

- [ ] **Step 1: Write the failing test**

If `APIClient` URL construction is not easily unit-tested, extract:

```swift
enum SearchRequest {
    static func queryItems(query: String, category: String?, limit: Int) -> [URLQueryItem]
}
```

```swift
func testSearchQueryIncludesCategory() {
    let items = SearchRequest.queryItems(query: "inv", category: "feed", limit: 50)
    XCTAssertEqual(items.first { $0.name == "category" }?.value, "feed")
}

func testSearchQueryOmitsNilCategory() {
    let items = SearchRequest.queryItems(query: "inv", category: nil, limit: 50)
    XCTAssertNil(items.first { $0.name == "category" })
}
```

- [ ] **Step 2: Run test to verify it fails** Expected: FAIL, `SearchRequest` missing

- [ ] **Step 3: Write minimal implementation**

`APIClient.search` uses `SearchRequest.queryItems` with `ListContract.searchCategoryParam(list)` from `MessageListView.runSearch`. Enable `.searchable` on iOS whenever `showsSearch` is true.

- [ ] **Step 4: Run tests** Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Kurir/Sources/Networking/APIClient.swift Kurir/Sources/Mail/MessageListView.swift Kurir/Tests/ListContractTests.swift
git commit -m "feat: scope native search to the open mailbox"
```

---

### Task 5: Reply Later focus stack

**Files:**
- Create: `Kurir/Sources/Mail/ReplyLaterFocusView.swift`
- Create: `Kurir/Tests/ReplyLaterFocusTests.swift`
- Modify: `Kurir/Sources/Mail/MoreView.swift`
- Modify: Mac host (`MailSplitView.swift` or wherever `.replyLater` is instantiated)

**Interfaces:**
- Consumes: `MailStore` or a `[MailThread]` for `.replyLater`, `MailAction.clearReplyLater`
- Produces: progress `N of M to reply`, card, `Open & reply`, `Done`, previous/next. Empty uses `ListContract.emptyCopy(.replyLater)`.

Pure queue helper:

```swift
enum ReplyLaterFocus {
    static func afterDone(index: Int, countBefore: Int) -> Int
    static func afterSkip(index: Int, delta: Int, count: Int) -> Int
}
```

`afterDone`: the item at `index` is removed; clamp to `max(0, min(index, countBefore - 2))`.
`afterSkip`: `max(0, min(count - 1, index + delta))`.

- [ ] **Step 1: Write the failing tests**

```swift
final class ReplyLaterFocusTests: XCTestCase {
    func testDoneOnFirstOfTwoStaysAtZero() {
        XCTAssertEqual(ReplyLaterFocus.afterDone(index: 0, countBefore: 2), 0)
    }

    func testDoneOnLastGoesToNewLast() {
        XCTAssertEqual(ReplyLaterFocus.afterDone(index: 1, countBefore: 2), 0)
    }

    func testSkipDoesNotWrap() {
        XCTAssertEqual(ReplyLaterFocus.afterSkip(index: 0, delta: -1, count: 3), 0)
        XCTAssertEqual(ReplyLaterFocus.afterSkip(index: 2, delta: 1, count: 3), 2)
    }
}
```

- [ ] **Step 2: Run test to verify it fails** Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Build `ReplyLaterFocusView` modeled on web `reply-later-focus.tsx`:
- Masthead on Mac: Later / Reply Later
- iOS `navigationTitle("Reply Later")`
- Open & reply pushes `ThreadView` (set `mail.isThreadOpen` on Mac)
- Done queues `.clearReplyLater(messageId:)`
- Pull to refresh calls `mail.sync()`

`MoreView` destination:

```swift
.navigationDestination(for: MailList.self) { list in
    if list == .replyLater {
        ReplyLaterFocusView()
    } else {
        MessageListView(list: list)
    }
}
```

Same branch on Mac sidebar.

- [ ] **Step 4: Run tests** Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Kurir/Sources/Mail/ReplyLaterFocusView.swift Kurir/Tests/ReplyLaterFocusTests.swift \
  Kurir/Sources/Mail/MoreView.swift Kurir/Sources/Mail/MailSplitView.swift
git commit -m "feat: Reply Later is a focus stack on iOS and Mac"
```

---

### Task 6: Empty copy and swipe matrix

**Files:**
- Modify: `Kurir/Sources/Mail/MessageListView.swift` (`emptyTitle` + description, `secondaryButton`, `archiveButton`)
- Modify: `Kurir/Sources/Mail/MacEmptyState.swift` usage sites
- Modify: `Kurir/Tests/RowActionSetTests.swift`

**Interfaces:**
- Consumes: `ListContract.emptyCopy`, `ListContract.swipeTrailing`, `RowActionSet.forList`
- Produces: empty title+description from the spec table. Trailing swipe on Sent is none (remove snooze). Secondary trailing on Imbox stays snooze. Description is no longer `Nothing here - enjoy the quiet.`

- [ ] **Step 1: Write the failing test**

```swift
func testSentSwipeHasNoSnooze() {
    XCTAssertEqual(ListContract.swipeTrailing(.sent), .none)
    XCTAssertFalse(RowActionSet.forList(.sent).snooze)
}
```

The RowActionSet test already exists. Add:

```swift
func testEmptyImboxCopyIsNotGeneric() {
    XCTAssertNotEqual(
        ListContract.emptyCopy(.imbox).description,
        "Nothing here - enjoy the quiet.")
}
```

- [ ] **Step 2: Run test** (may pass from Task 1). Then change `emptyTitle` in the view to `ListContract.emptyCopy(list).title` and pass `.description` into `MacEmptyState` / `ContentUnavailableView`. Remove `default:` snooze on Sent in `secondaryButton`.

```swift
private func secondaryButton(for thread: MailThread) -> some View {
    switch list {
    case .snoozed: // unsnooze
    case .followUp: // dismiss
    case .imbox, .feed, .paperTrail, .archive:
        // snooze
    default:
        EmptyView()
    }
}
```

Reply Later is no longer this view, so drop `.replyLater` Clear.

- [ ] **Step 3: Implement** as above

- [ ] **Step 4: Run tests** including `RowActionSetTests`

- [ ] **Step 5: Commit**

```bash
git add Kurir/Sources/Mail/MessageListView.swift
git commit -m "feat: native empty copy and Sent swipe match the contract"
```

---

### Task 7: Select bar parity

**Files:**
- Modify: `Kurir/Sources/Mail/MessageListView.swift` (`bulkBar`)
- Modify: `Kurir/Sources/Mail/MacSelectionBar.swift`

**Interfaces:**
- Consumes: `RowActionSet.forList(list).snooze`
- Produces: iOS bulk bar hides Snooze when `!RowActionSet.forList(list).snooze`. Mac bar already gates snooze; add Read / Unread using the same `bulkReadMarksRead` logic as iOS.

- [ ] **Step 1: Write the failing test**

`BulkActionsTests` already covers `.read`. Add:

```swift
func testSnoozeAllowedFollowsRowActionSet() {
    XCTAssertTrue(RowActionSet.forList(.imbox).snooze)
    XCTAssertFalse(RowActionSet.forList(.followUp).snooze)
    XCTAssertFalse(RowActionSet.forList(.archive).snooze)
    XCTAssertFalse(RowActionSet.forList(.sent).snooze)
}
```

That may already pass. The view change is the real work: wrap the iOS Snooze `Menu` in `if RowActionSet.forList(list).snooze`. On Mac, add a Read button calling `runBulk(.read)` next to Archive.

- [ ] **Step 2: If you add a `SelectBarSpec` helper, test it first**

```swift
struct SelectBarSpec: Equatable {
    var snooze: Bool
    var unarchive: Bool
    var read: Bool
    var block: Bool
    static func forList(_ list: MailList) -> SelectBarSpec {
        let set = RowActionSet.forList(list)
        return SelectBarSpec(
            snooze: set.snooze,
            unarchive: set.unarchive,
            read: true,
            block: list != .sent
        )
    }
}
```

Test `SelectBarSpec.forList(.sent).block == false` and `.snooze == false`.

- [ ] **Step 3: Implement the views from `SelectBarSpec`**

- [ ] **Step 4: Run `BulkActionsTests` + `RowActionSetTests` + `ListContractTests`**

- [ ] **Step 5: Commit**

```bash
git add Kurir/Sources/Mail/MessageListView.swift Kurir/Sources/Mail/MacSelectionBar.swift \
  Kurir/Sources/Mail/ListContract.swift Kurir/Tests/ListContractTests.swift
git commit -m "feat: native select bars match the web action matrix"
```

---

### Task 8: Contacts filters, Scheduled snippet, Files date, Drafts snippet

**Files:**
- Modify: `Kurir/Sources/Mail/ContactsView.swift`
- Modify: `Kurir/Tests/ContactsTests.swift`
- Modify: `Kurir/Sources/Mail/ScheduledListView.swift`
- Modify: `Kurir/Sources/Mail/FilesView.swift`
- Modify: `Kurir/Sources/Mail/DraftsListView.swift`

**Interfaces:**
- Contacts: add category filter All / Imbox / Feed / Paper Trail / Uncategorized on top of existing A-O sections. Reuse the same matching idea as web `contactMatchesCategory`. Empty copy from `ListContract`.
- Scheduled: show `item.snippet` (`lineLimit(2)`), an Edit control that opens `ComposeView(editing: item)`. On save, `APIClient` PATCHes `/api/mobile/scheduled/:id` (server plan Task 11). Do not cancel-and-recreate.
- Files: show `receivedAt` (or `createdAt`) on the row in addition to size.
- Drafts: snippet `lineLimit(2)` on Mac as well as iOS.

- [ ] **Step 1: Write failing tests for contact filter**

If `ContactSections` is already tested, add `ContactFilter`:

```swift
enum ContactFilter: String, CaseIterable {
    case all, imbox, feed, paperTrail, uncategorized
}

enum ContactCategoryMatch {
    static func matches(_ contact: APIContact, filter: ContactFilter) -> Bool
}
```

Test uncategorized = no sender category on any email; imbox = any email with Imbox.

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement filter chips (quiet text, terracotta underline on Mac like `MacUnderlineTabs`) and the other row bits**

Add `ComposeView` initializer `init(editing: APIScheduledMessage, onClose: ...)`. Prefill to/cc/bcc/subject/body/scheduledFor. Save calls `client.patchScheduled(id:fields:)`. Context menu and a trailing Edit button (Mac hover or visible text button, not icon-only).

- [ ] **Step 4: Run `ContactsTests` + `FilesViewTests` + `DraftTests`**

- [ ] **Step 5: Commit**

```bash
git add Kurir/Sources/Mail/ContactsView.swift Kurir/Tests/ContactsTests.swift \
  Kurir/Sources/Mail/ScheduledListView.swift Kurir/Sources/Mail/FilesView.swift \
  Kurir/Sources/Mail/DraftsListView.swift
git commit -m "feat: align Contacts, Scheduled, Files, and Drafts lists"
```

---

## After the last task

Run the full suite on iOS and Mac:

```
xcodebuild test -project Kurir.xcodeproj -scheme Kurir -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
xcodebuild test -project Kurir.xcodeproj -scheme KurirMac -destination 'platform=macOS'
```

Visual check: Imbox sections, a search from Feed that does not return Imbox-only hits, Reply Later stack, Sent row with To: and no snooze swipe.
