# Person statistics and Rank

Implements the numbers in the person pane (kurir-ios#116). One pure module
owns the formulas on each platform:

- server: `src/lib/mail/person-stats.ts` (served by `GET /api/contacts/profile`)
- iOS/Mac: `Kurir/Sources/Mail/PersonStats.swift` (computed locally from GRDB)

Both are pinned to the same fixture, committed in both repos:
`src/__tests__/fixtures/person-rank.json` here and
`Kurir/Tests/Fixtures/person-rank.json` in kurir-ios. A change to a formula
is a change to the fixture and to both implementations, in one go.

## Definitions

For a person `P` and the user's own addresses `O` (all connection, send-as
and alias addresses, plus `treatDomainAsOwn` domains):

- **received from them**: messages with `From = P`.
- **sent to them**: messages with `From in O` and `P` on To or Cc.
- **exchanged**: the union of the two. Mail from a third party that merely
  Cc's `P` is not exchanged with `P`.
- **first / last contact**: min / max `receivedAt` over exchanged mail.
- **response time**: replies are paired inside the exchanged set via
  `In-Reply-To -> Message-ID`. "They reply in" is the median of
  `reply.receivedAt - parent.receivedAt` where the reply is from `P` and the
  parent from `O`; "You reply in" the other way round. A reply to one's own
  mail, a reply whose parent is unknown, or a non-positive delta is skipped.
  The median of an even count is the mean of the two middle values.
- **arrival histogram**: 24 buckets of the local hour (in the user's
  timezone) of `receivedAt` for mail from `P`. The web uses the account
  timezone; mobile sends the device zone as `tz`.

## Rank

```
score(P) = sum over exchanged messages m of
           0.5 ^ (ageDays(m) / 90) * (2 if m has In-Reply-To else 1)

ageDays(m) = max(0, now - m.receivedAt) / 86400
```

A message counts fully today, half after 90 days, a quarter after 180.
Replies (either direction) count double because a reply is a stronger
signal of a relationship than a one-way message.

**Position** is the 1-based place of `P` among all counterparts of the user
sorted by score descending, ties broken by email ascending. Counterparts are
collected in one pass over all mail: a message from `O` credits every
distinct non-own To/Cc address; any other message credits its sender only.
The pane shows it as "#3 of the 41 people you mail most".

### Materialised (kurir-ios#117)

That pass reads every message row of the user, so its output is stored in
the `PersonRank` table (migration `0023_person_rank.sql`): one row per
address with `email`, `domain`, the newest From `displayName` seen,
`score` and `computedAt`. Rows are everyone `rankPeople` credits plus
every other non-own address that ever appeared in From/To/Cc/Bcc of the
user's mail (someone Cc'd on a received message, a Bcc of own mail) at
score 0, so compose and search can offer an address that was only ever
copied. A `Sender` row exists for From addresses only, which is why the
score is not a Sender column.

`src/lib/mail/person-rank-store.ts` rewrites the user's rows in one
transaction (`recomputePersonRank`). It runs detached after every completed
sync (`kickRankRecompute`: one run per user at a time, a kick that lands
mid-run queues one more) and on demand with
`pnpm recompute-rank <email>|--all`. Position is `ORDER BY score DESC, email
ASC` among the rows with a score above 0 ("the people you mail"); `of` is
their count, and a score-0 row has no position. The profile reads the table
(`readPersonRank`); a user with no rows yet (first start after the upgrade)
gets one live pass and a kick. The per-person counts, medians and histogram
are still computed from the person's own rows on every call.

On iOS/Mac the same pass fills the GRDB table `personRank(email, score,
computedAt)` (`PersonRankStore`, migration v15) at the end of every
completed sync; the pane, Network, search and compose read it.

Rank is the input to Network sorting, ranked people search and compose
autosuggest (see `docs/person-network.md`), so it is defined once here and
mirrored, not re-derived, on the client.

## Signature extraction

`src/lib/mail/signature-extract.ts` lifts phones, title, and company from the
trailing signature block of plain-text bodies from other people (never the
user's own). Sync runs it inline per stored body; senders synced before
extraction existed are covered by `pnpm backfill-signatures <email>|--all`
and by a detached one-shot kick after each completed sync, which scans the
five newest bodies of every sender not yet stamped. Values are stored on
`Sender` (`signaturePhones`, `signatureTitle`, `signatureCompany`,
`signatureExtractedAt`; migration `0022_sender_signature.sql`).
`signatureExtractedAt` is the `receivedAt` of the newest body scanned: sync
walks folders newest-first, so an older body only fills gaps while a newer
one overwrites. Senders are per connection; the profile folds every row for
the address.

When a Contact record is linked to the address, its values win and the
signature only fills gaps (`mergeContactDetails`). Today Contact carries a
name only, so in practice the name comes from the Contact and phones, title,
and company from the signature, each tagged with its source in the API.
