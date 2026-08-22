# Calendar (kurir-ios) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** iOS and macOS show the same week/day/month calendar as the web, sync the replica over the mobile API, connect Google/Outlook/CalDAV on device, and RSVP from the thread.

**Architecture:** JSON contract only. No shared UI kit. Native stores accounts, calendars, and masters from `GET /sync`. Visible instances come from `GET /range`. Do not start this plan until server Task 21 (`/api/mobile/calendar/*`) is on the branch native will call.

**Tech Stack:** SwiftUI, GRDB, XCTest. Repo: `kurir-ios` (sibling of kurir-server). Copy the contract from the spec; do not fork colors, copy, or RSVP rules.

**Spec:** `docs/specs/2026-08-20-calendar-design.md` in kurir-server.

## Global Constraints

- UI strings in English. No em dashes in comments or copy.
- DESIGN.md: terracotta now line, no avatars, no pill badges, event color is a 2px rail plus a faint tint, `Free` is muted text.
- iPhone default view is day. Mac default is week. Month exists on both.
- iOS keeps `navigationTitle("Calendar")` plus a system DatePicker. Mac keeps the sidebar item + masthead analogue used for mail.
- iPhone does not drag-resize events. Create/edit is a sheet.
- OAuth uses the same server `/api/calendar/oauth/start` + callback as web, opened in `ASWebAuthenticationSession`.
- TDD: failing XCTest first. iOS: `xcodebuild test -project Kurir.xcodeproj -scheme Kurir -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -only-testing:KurirTests/<Class>`.
- Empty-state copy is the web strings: title `Connect a calendar`, body `Google, Outlook, or any CalDAV account. Events stay on that calendar. Kurir shows this week.` Buttons `Add Google`, `Add Outlook`, `Add CalDAV`.
- Do not build journal, habits, sometime, or Kurir-side reminders.

---

## Files

Paths follow `Kurir/Sources/Mail/` from the list-view-parity iOS plan. Adjust if the native tree differs; keep Calendar in its own folder, not inside Mail views.

- Create: `Kurir/Sources/Calendar/CalendarContract.swift`
- Create: `Kurir/Tests/CalendarContractTests.swift`
- Create: `Kurir/Sources/Calendar/CalendarModels.swift`
- Create: `Kurir/Sources/Calendar/CalendarStore.swift`
- Create: `Kurir/Sources/Calendar/CalendarRangeClient.swift`
- Create: `Kurir/Sources/Calendar/CalendarView.swift`
- Create: `Kurir/Sources/Calendar/WeekView.swift`
- Create: `Kurir/Sources/Calendar/DayView.swift`
- Create: `Kurir/Sources/Calendar/MonthView.swift`
- Create: `Kurir/Sources/Calendar/EventBlock.swift`
- Create: `Kurir/Sources/Calendar/EventEditorSheet.swift`
- Create: `Kurir/Sources/Calendar/CalendarSettingsView.swift`
- Create: `Kurir/Sources/Calendar/MeetingCard.swift`
- Create: `Kurir/Tests/CalendarRangeTests.swift`
- Create: `Kurir/Tests/MeetingCardStateTests.swift`
- Modify: `Kurir/Sources/Networking/APIClient.swift`
- Modify: `Kurir/Sources/Mail/MailSplitView.swift` / `MailRootView.swift` (add Calendar tab / sidebar)
- Modify: `Kurir/Sources/Mail/ThreadView.swift` (meeting card above the body)
- Modify: `Kurir/Sources/Mail/MoreView.swift` only if Calendar is not a top-level iOS tab (spec: it is top-level)

---

### Task 1: CalendarContract (pure)

**Files:**
- Create: `Kurir/Sources/Calendar/CalendarContract.swift`
- Test: `Kurir/Tests/CalendarContractTests.swift`

**Interfaces:**
- Consumes: nothing from Mail list contract
- Produces:

```swift
enum CalendarContract {
    enum ViewMode: String, Equatable {
        case week, day, month
    }

    struct EmptyCopy: Equatable {
        var title: String
        var description: String
    }

    static let empty = EmptyCopy(
        title: "Connect a calendar",
        description: "Google, Outlook, or any CalDAV account. Events stay on that calendar. Kurir shows this week."
    )

    static func defaultMode(isPhone: Bool) -> ViewMode {
        isPhone ? .day : .week
    }

    static func freetimeLabel() -> String { "Free" }

    static func recurrenceChoices() -> [String] {
        ["This event", "This and following events", "All events"]
    }

    enum MeetingCard {
        case buttons
        case cancelled
        case connect
    }

    static func meetingCard(
        method: String,
        hasWritableCalendar: Bool
    ) -> MeetingCard {
        if method == "CANCEL" { return .cancelled }
        if method == "REQUEST" && !hasWritableCalendar { return .connect }
        if method == "REQUEST" { return .buttons }
        return .connect
    }
}
```

- [ ] **Step 1: Write the failing XCTest**

```swift
func testDefaultMode() {
    XCTAssertEqual(CalendarContract.defaultMode(isPhone: true), .day)
    XCTAssertEqual(CalendarContract.defaultMode(isPhone: false), .week)
}

func testEmptyCopy() {
    XCTAssertEqual(CalendarContract.empty.title, "Connect a calendar")
}

func testMeetingCard() {
    XCTAssertEqual(CalendarContract.meetingCard(method: "CANCEL", hasWritableCalendar: true), .cancelled)
    XCTAssertEqual(CalendarContract.meetingCard(method: "REQUEST", hasWritableCalendar: false), .connect)
    XCTAssertEqual(CalendarContract.meetingCard(method: "REQUEST", hasWritableCalendar: true), .buttons)
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: `CalendarContract` not found.

- [ ] **Step 3: Implement the enum as above**

- [ ] **Step 4: Tests pass**

- [ ] **Step 5: Commit**

```bash
git add Kurir/Sources/Calendar/CalendarContract.swift Kurir/Tests/CalendarContractTests.swift
git commit -m "feat: add calendar contract helpers"
```

---

### Task 2: Models + API client

**Files:**
- Create: `Kurir/Sources/Calendar/CalendarModels.swift`
- Modify: `Kurir/Sources/Networking/APIClient.swift`
- Test: decode fixtures in `Kurir/Tests/CalendarRangeTests.swift`

**Interfaces:**
- Produces Codable types matching server JSON:

```swift
struct CalendarAccountDTO: Codable, Identifiable {
    var id: String
    var provider: String // GOOGLE | MICROSOFT | CALDAV
    var displayName: String
    var principalEmail: String?
    var lastSyncedAt: Date?
    var lastError: String?
    var oauthError: String?
    var calendars: [CalendarDTO]
}

struct CalendarDTO: Codable, Identifiable {
    var id: String
    var name: String
    var color: String
    var isVisible: Bool
    var isPrimary: Bool
    var isReadOnly: Bool
}

struct CalendarInstanceDTO: Codable, Identifiable {
    var id: String
    var eventId: String
    var calendarId: String
    var title: String
    var startAt: Date
    var endAt: Date
    var isAllDay: Bool
    var isCancelled: Bool
    var color: String
}

struct CalendarSyncPayload: Codable {
    var accounts: [CalendarAccountDTO]
    var events: [CalendarEventDTO]
    var tombstones: [CalendarTombstoneDTO]
    var nextCursor: String?
}

struct CalendarEventDTO: Codable, Identifiable {
    var id: String
    var calendarId: String
    var title: String
    var startAt: Date
    var endAt: Date
    var isAllDay: Bool
    var rrule: String?
    var icalUid: String?
    var updatedAt: Date
}
```

`APIClient` methods:

```swift
func calendarAccounts() async throws -> [CalendarAccountDTO]
func calendarSync(cursor: String?) async throws -> CalendarSyncPayload
func calendarRange(start: Date, end: Date, calendarIds: [String]?) async throws -> [CalendarInstanceDTO]
func createCalendarEvent(_ body: CreateEventBody) async throws -> CalendarInstanceDTO
func updateCalendarEvent(id: String, body: UpdateEventBody) async throws
func deleteCalendarEvent(id: String, range: String) async throws
func rsvp(messageId: String, status: String, calendarId: String?) async throws
func createCalDavAccount(url: String, username: String, password: String) async throws
func deleteCalendarAccount(id: String) async throws
func setCalendarVisible(id: String, isVisible: Bool) async throws
func calendarOAuthStart(provider: String) async throws -> URL
```

Decode dates as ISO-8601 with fractional seconds, same as mail.

- [ ] **Step 1: Fixture JSON for GET /range (one timed, one all-day, one cancelled) and assert decode.**

- [ ] **Step 2: Fail because types are missing**

- [ ] **Step 3: Implement DTOs + APIClient methods using the existing authenticated request helper**

- [ ] **Step 4: Tests pass**

- [ ] **Step 5: Commit** `feat: add calendar mobile API client`

---

### Task 3: Store + range fetch

**Files:**
- Create: `Kurir/Sources/Calendar/CalendarStore.swift`
- Create: `Kurir/Sources/Calendar/CalendarRangeClient.swift`

GRDB tables for accounts, calendars, masters, tombstones. Range results can be memory-cached per `start/end` key and dropped when the visible window changes. Sync cursor stored like mail.

On appear: `calendarSync` then `calendarRange` for the visible week/day/month. Pull-to-refresh repeats both.

Hidden calendars are filtered client-side using `isVisible` so toggling does not wait on range.

- [ ] **Step 1: Test that cancelled instances are dropped from the timeline array the view uses (`visibleInstances(from:)`).**

- [ ] **Step 2-5:** implement, commit `feat: add calendar store and range fetch`

---

### Task 4: Week, day, month views

**Files:**
- Create: `Kurir/Sources/Calendar/CalendarView.swift`
- Create: `Kurir/Sources/Calendar/WeekView.swift`
- Create: `Kurir/Sources/Calendar/DayView.swift`
- Create: `Kurir/Sources/Calendar/MonthView.swift`
- Create: `Kurir/Sources/Calendar/EventBlock.swift`

`CalendarView` picks `CalendarContract.defaultMode`. Toggle Week / Day / Month. Today / prev / next. Hour gutter 07:00-21:00, scroll 00:00-24:00. Now line uses the app terracotta. EventBlock: 2pt leading rail, 18% tint, Inter title, no avatar. Freetime: any gap `>= 120` minutes inside 07:00-21:00, label `Free`. Month: seven-column grid, `+N` overflow, tap day pushes Day. All-day strip above the times. Weekend muted fill.

Mac: week default, sidebar item `Calendar` after Paper Trail. iPhone: day default, top-level tab.

- [ ] **Step 1: Write the failing `freetimeGaps` test**

Port server `freetimeSpans` into `CalendarContract.freetimeGaps`. Half-open. Ignore all-day, cancelled, and `transparency == free`. A 09:00-10:00 and 13:00-14:00 busy pair in a 07:00-21:00 day yields one 10:00-13:00 gap of 180 minutes.

- [ ] **Step 2-5:** implement, commit `feat: add calendar week, day, and month views`

Verify on simulator: empty state, a range with a Free gap, dark mode, iPhone vs the Mac target.

---

### Task 5: Create / edit sheet

**Files:**
- Create: `Kurir/Sources/Calendar/EventEditorSheet.swift`

Fields: title, calendar (writable only), start, end, all-day, location, notes, recurrence. Save calls `createCalendarEvent` / `updateCalendarEvent`. Delete calls delete with the recurrence choice. Read-only calendars cannot be drop targets. Conflict error from the server (message `This event changed on Google.`) shown as an alert, then range refetch.

iPhone: no drag-resize. Mac may drag-move later; not required in this task.

- [ ] **Step 1:** test that the recurrence action sheet options equal `CalendarContract.recurrenceChoices()`.

- [ ] **Step 2-5:** implement, commit `feat: add calendar event editor`

---

### Task 6: Settings + OAuth + CalDAV

**Files:**
- Create: `Kurir/Sources/Calendar/CalendarSettingsView.swift`

List accounts, last sync, error, reconnect, disconnect, visibility toggles. `Add Google` / `Add Outlook` open `ASWebAuthenticationSession` with `calendarOAuthStart`. `Add CalDAV` is a form (URL, username, app-specific password). Help text for iCloud: use an app-specific password at `https://caldav.icloud.com`.

- [ ] **Step 1:** test that CalDAV submit disables when url or username or password is empty.

- [ ] **Step 2-5:** implement, commit `feat: connect calendars from iOS and Mac settings`

---

### Task 7: Meeting card on the thread

**Files:**
- Create: `Kurir/Sources/Calendar/MeetingCard.swift`
- Modify: `Kurir/Sources/Mail/ThreadView.swift`

Server Task 21 adds optional `meeting` on each mobile message. Decode it on the existing message DTO. Do not add a second HTTP round trip.

Card above the body. `CalendarContract.meetingCard` decides buttons vs cancelled vs connect copy. Accept / Maybe / Decline call `rsvp`. `Show in calendar` pushes Day on `startAt`.

- [ ] **Step 1:** `MeetingCardStateTests` wrapping `CalendarContract.meetingCard`.

- [ ] **Step 2-5:** implement, commit `feat: show meeting RSVP on native threads`

---

### Task 8: Navigation chrome

**Files:**
- Modify: `MailRootView` / `MailSplitView` / iOS tab bar / Mac sidebar

iOS: Calendar is a top-level tab, not buried in More. Mac: sidebar item after Paper Trail, icon matching Lucide Calendar (SF Symbol `calendar`). No badge.

- [ ] **Step 1:** no unit test. Confirm tab order on iPhone and sidebar order on Mac.

- [ ] **Step 2-5:** implement, commit `feat: add Calendar to native navigation`

---

## Spec coverage

| Spec section | Tasks |
|--------------|-------|
| Native JSON contract | 2, 3 |
| Week / day / month, freetime, rails | 1, 4 |
| iPhone day / Mac week | 1, 4, 8 |
| CRUD write-back | 5 |
| Connect on device | 6 |
| Thread RSVP | 7 |
| Top-level iOS tab | 8 |

Server `GET /range` and `POST /rsvp` must exist before Tasks 3 and 7.
