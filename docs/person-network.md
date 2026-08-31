# Rank everywhere: Network, ranked people search, compose autosuggest

Implements kurir-ios#117 on top of the Rank from `docs/person-rank.md`. The
Rank is materialised (`PersonRank` table, GRDB `personRank` on iOS/Mac) and
read in three places. One pure module owns each rule on each platform, all
pinned to the shared fixture `person-rank.json` (`expectedNetwork`,
`expectedPeopleSearch`, `expectedDomainTypeahead`).

## Network

Replaces the pane's Related senders. Server: `src/lib/mail/person-network.ts`
(`computeNetwork`, served inside `GET /api/contacts/context` as `network`).
iOS/Mac: `PersonPane.network` in `PersonPane.swift`.

For a person `P`, a neighbour is either

- **shared thread**: an address (not `P`, not own) on a thread `P` is on,
  where "on" means From, To or Cc of any message in the thread. Strength:

  ```
  strength(N) = sum over shared threads T of 0.5 ^ (ageDays(T) / 90)
  ageDays(T)  = max(0, now - newest message in T) / 86400
  ```

  A thread touched today counts 1, one from three months ago 0.5. The row
  shows "N shared threads". A message without a `threadId` is its own
  thread.

- **same domain**: an address on `P`'s domain with no shared thread. Its
  strength is its own Rank score (its exchanged mail with the user), so a
  colleague you write to often sits above one you never hear from. The row
  shows "same domain".

Sorted by strength desc; at equal strength a shared-thread neighbour comes
before a same-domain one, then name, then address. The pane shows eight
with "Show all" for the rest; choosing one switches the pane to that person.

## Ranked people search

`src/lib/mail/people-search.ts` (`matchPerson`, `rankedPeople`, `findPeople`)
and `SearchPeople.swift`. A person matches when the query is a **prefix** of

- a whitespace-separated token of the display name (first or last name),
- the address local part or the whole address (`ann`, `anna@ac`),
- a dot-separated label of the domain (`tv4` for `tv4.se` and `mail.tv4.se`),
- a token of the signature company (server; the client has no company).

Substring hits do not count ("erg" does not find Berg). Results are ordered
by Rank score desc, then name, then address, so "ma" shows Maria before a
low-rank Mats. The People group answers from the first typed character;
message and file hits need two (`SEARCH_MIN_LENGTH`,
`MESSAGE_SEARCH_MIN_LENGTH` in `list-contract.ts`). Own addresses never
appear; a sender the user rejected or has not screened yet is left out.

**Files** is the third group: attachments whose filename or sender (name or
address) contains the query (`src/lib/mail/search-files.ts`; on iOS/Mac the
attachment metadata cached with fetched bodies plus the server's filename
search), opened directly with the viewer / QuickLook or a download.

## Compose autosuggest

`GET /api/contacts/search?q=` returns Contact records merged with every
address in the materialised Rank (From/To/Cc/Bcc, so an address that only
ever appeared in Cc is suggested), deduplicated by lower-cased address,
ordered by Rank then name, own addresses excluded, eight rows. A Contact
contributes one row (its best-ranked matching address, every address in
`emails`) and its name wins over header names.

A query without `@` that starts a domain label or a signature company
returns the top-ranked people at that domain with `domainHint` set to the
domain; the web and iOS/Mac dropdowns show it as "at tv4.se". iOS/Mac call
the endpoint and fall back offline to the same rules over local mail ranked
by `personRank`.

Response row: `{ id, name, email, displayName, emails[], domainHint, score }`.
`id` is the Contact id for contacts and `sender-<email>` otherwise (the
contact link dialog skips the latter).
