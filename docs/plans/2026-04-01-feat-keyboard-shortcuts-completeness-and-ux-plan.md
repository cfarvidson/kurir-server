title: feat: Complete keyboard shortcuts and improve keyboard UX
type: feat
date: 2026-04-01

# Complete Keyboard Shortcuts & Improve Keyboard UX

## Overview

Three improvements to make the keyboard-driven experience complete and polished:

1. **Missing navigation shortcuts** — 3 sidebar items have no `g+X` shortcut, and Follow Up's shortcut hint doesn't show in the sidebar
2. **Action buttons invisible during keyboard navigation** — hover action buttons (archive, snooze, follow up) only appear on mouse hover, not when a row is keyboard-focused via j/k
3. **Number shortcuts in pickers** — when pressing `f` or `s` to open follow-up/snooze pickers, users should be able to press `1`/`2`/`3`/`4` to quickly select an option without mouse

## Problem Statement

Power users navigating entirely by keyboard hit a dead end: they can focus a row with j/k and see the focus ring, but the action buttons remain hidden (CSS `group-hover` only). They have to reach for the mouse to see available actions. Similarly, 3 of 10 navigation items (Snoozed, Scheduled, Contacts) have no keyboard shortcut, breaking the "navigate anywhere from keyboard" promise.

## Proposed Solution

### 1. Add missing `g+X` navigation shortcuts

| Destination | Shortcut | Mnemonic |
|-------------|----------|----------|
| Snoozed     | `g+z`    | zzz (sleep) |
| Scheduled   | `g+d`    | delivery/delayed |
| Contacts    | `g+c`    | contacts |

**Files to modify:**

- `src/components/mail/keyboard-shortcuts.tsx` — add to `GOTO_MAP` and `navigationShortcuts`
- `src/components/layout/sidebar.tsx` — add to `NAV_SHORTCUTS`
- `src/components/mail/command-palette.tsx` — add shortcut badges to Snoozed, Scheduled, Contacts entries

### 2. Show action buttons on keyboard-focused rows

Add `group-data-[keyboard-focused]:opacity-100` to the hover action buttons container in `message-list.tsx`. This uses Tailwind's data attribute group variant — when the parent row has `data-keyboard-focused="true"`, the action buttons become visible, same as on mouse hover.

**File to modify:**
- `src/components/mail/message-list.tsx:352` — add class to action buttons container

Current:
```
md:opacity-0 md:transition-opacity md:group-hover:opacity-100
```

New:
```
md:opacity-0 md:transition-opacity md:group-hover:opacity-100 md:group-data-[keyboard-focused]:opacity-100
```

### 3. Number key shortcuts in pickers

When a SnoozePicker or FollowUpPicker is open, pressing `1`, `2`, `3`, `4` should select the corresponding option. This makes the full flow seamless: `f` → picker opens → `1` → "1 day follow-up" selected, no mouse needed.

**Files to modify:**
- `src/components/mail/snooze-picker.tsx` — add `useEffect` keydown handler when `isOpen` is true
- `src/components/mail/follow-up-picker.tsx` — add `useEffect` keydown handler when `isOpen` is true

### 4. Add Follow Up shortcut hint to sidebar

`NAV_SHORTCUTS` in `sidebar.tsx` is missing `/follow-up: "U"` even though the shortcut exists in `GOTO_MAP`. Fix: add it.

## Acceptance Criteria

- [ ] `g+z` navigates to `/snoozed`
- [ ] `g+d` navigates to `/scheduled`
- [ ] `g+c` navigates to `/contacts`
- [ ] Sidebar shows `G › Z`, `G › D`, `G › C` hints on hover for those items
- [ ] Sidebar shows `G › U` hint on hover for Follow Up
- [ ] Keyboard shortcuts dialog (`?`) lists all new shortcuts
- [ ] Command palette shows shortcut badges for Snoozed, Scheduled, Contacts
- [ ] j/k focused rows show archive/snooze/follow-up action buttons
- [ ] Pressing `1`-`4` in open snooze picker selects the corresponding option
- [ ] Pressing `1`-`4` in open follow-up picker selects the corresponding option
- [ ] All existing shortcuts continue to work unchanged

## References

- `src/components/mail/keyboard-shortcuts.tsx` — shortcut definitions + dialog + GOTO_MAP
- `src/components/layout/sidebar.tsx:50-57` — NAV_SHORTCUTS map
- `src/components/mail/message-list.tsx:345-434` — hover action buttons
- `src/components/mail/list-keyboard-handler.tsx` — j/k/e/s/f keyboard handler
- `src/components/mail/snooze-picker.tsx` — snooze picker options
- `src/components/mail/follow-up-picker.tsx` — follow-up picker options
- `src/components/mail/command-palette.tsx` — command palette actions
- `src/stores/keyboard-navigation-store.ts` — keyboard focus state
