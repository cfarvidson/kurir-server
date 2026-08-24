Create a new release of Kurir using calendar versioning (CalVer).

Read `docs/releasing.md` for the full release process documentation.

A new `vYYYY.MICRO` tag is beta. Marking it stable is a later step on
the same version: copy `latest.json.beta` onto the top-level pointer,
then let `:latest` follow. No new micro, no rebuild, no `-beta` suffix.

If the user did not say which step they want, ask: cut a beta, or mark
the current beta stable?

## When to use each

- **Cut a beta** when shipping a new version. TestFlight pairing and
  testers with Install betas on pick it up. Self-hosters on stable do
  not see it. `:latest` does not move. `install.sh` still pulls the
  last marked stable.
- **Mark stable** when that same version should reach every self-hoster.
  Copies the beta pointer onto the top-level fields, clears the GitHub
  prerelease flag, and points `:latest` at the already-published image.

Turning Install betas off does not reinstall stable by itself. An
instance already running the unmarked version is told it is ahead of
stable; reinstalling that image does not undo migrations the beta
applied.

## Cut a beta

1. Determine the new version:
   - Format: `YYYY.MICRO` (CalVer year plus ONE serial per year, two
     components). It is not a date - `2026.29` is the 29th release of 2026.
   - `YYYY` from today's date
   - `MICRO` is a single counter SHARED WITH kurir-ios: incremented across
     BOTH repos, not per repo and not per month, reset to 1 in January.
     Take it as one greater than the highest serial across both repos' tags
     (and server `package.json` / `latest.json` / iOS `MARKETING_VERSION`).
     Tags from the older `YYYY.MM.N` and `YYYY.MM.DD.N` formats count via
     their third component. The micro must also outrank the last month
     component ever used (`08`) so component-wise comparison keeps ranking
     the new format above the old. Never restart at 1 mid-year, never
     zero-pad, never append a third component.
   - Check `package.json`, `latest.json` and the kurir-ios tags for collisions

2. Ask the user for a short changelog (one line describing what changed since the last release). Suggest one based on recent commits since the last version tag.

3. Bump `package.json` version to the new CalVer string

4. Write `latest.json.beta` and leave the top-level pointer on the last stable:

   ```
   node scripts/release-manifest.mjs write-beta \
     --version <new version> \
     --changelog "<user-provided changelog>" \
     --released-at "<ISO 8601 now>"
   ```

   Do not copy the new version onto the top-level fields. That is mark-stable.

5. Update `CHANGELOG.md`: add a `## [v<new version>] - <date>` section under `[Unreleased]` describing the changes. Move any bullets already under `[Unreleased]` into that section.

6. Update `changelog.json` in the repo root: prepend an entry for the new version. This file feeds the Changelog list in the admin Updates page. It MUST be updated in the same commit as the version bump:

   ```json
   {
     "version": "<new version>",
     "date": "<YYYY-MM-DD>",
     "changes": ["<one short bullet per user-visible change>"]
   }
   ```

7. Run `npx prettier --write package.json latest.json changelog.json CHANGELOG.md`

8. Commit: `release: v<new version>`

9. Verify the beta commit is complete: `./scripts/verify-release.sh --mode beta v<new version>`. This MUST pass before tagging. CI runs the same check on the tag build and refuses to publish the image if package.json, the changelog files, or `latest.json.beta` were not bumped, or if the top-level pointer was moved.

10. Tag: `git tag v<new version>`

11. Push: `git push origin main --tags`

12. Create GitHub prerelease:

    ```
    gh release create v<new version> --title "v<new version>" --notes "<changelog>" --prerelease
    ```

13. Deploy the CI-built _versioned_ image if production should dogfood this beta (see `docs/releasing.md` → "Deploying a release"). Kamal does not build locally; it pulls `ghcr.io/cfarvidson/kurir-server:v<new version>` which CI publishes on the tag build. This does **not** move `:latest`.

    Wait for the `Publish Docker image` run for the tag to be green (5–10 min):

    ```
    gh run list --workflow docker-publish.yml --limit 3
    gh run watch <run-id> --exit-status
    ```

    Then deploy, always via `bin/deploy`, never bare `kamal`:

    ```
    KAMAL_REGISTRY_PASSWORD="$(gh auth token)" bin/deploy deploy --skip-push --version v<new version>
    ```

    (`gh auth token` works because the ghcr.io package is public; a PAT with `write:packages` is only needed for local build+push.)

    Verify: `bin/deploy app containers` shows only `kurir-web-v<new version>` Up, and `curl -s https://kurir-app-1.banded-beta.ts.net/api/up` returns `{"status":"ok"}`. If the deploy fails on health while the app log says it was ready, follow the kamal-proxy recovery in `docs/releasing.md`.

14. Report the prerelease URL when done. Remind the user that self-hosters stay on the previous stable until this version is marked stable.

## Mark the current beta stable

No new version. No rebuild. The image is already at `ghcr.io/cfarvidson/kurir-server:v<version>`.

1. Read `latest.json.beta.version`. That is the version to promote. Abort if `beta` is missing or is not newer than the top-level pointer.

2. Copy it onto the top-level fields and drop the pending beta object:

   ```
   node scripts/release-manifest.mjs mark-stable
   npx prettier --write latest.json
   ```

3. Commit: `release: mark v<version> stable`

4. Verify: `./scripts/verify-release.sh --mode mark-stable v<version>`. This MUST pass before pushing. Top-level must match the version; package.json and the changelog files already do, from the beta tag.

5. Push to main. Do **not** tag.

6. Clear the prerelease flag:

   ```
   gh release edit v<version> --prerelease=false
   ```

7. Point `:latest` at the already-published image:

   ```
   gh workflow run promote-latest.yml -f version=v<version>
   gh run list --workflow promote-latest.yml --limit 1
   gh run watch <run-id> --exit-status
   ```

   That workflow re-runs mark-stable verify and retags with `docker buildx imagetools create`. It does not build.

8. Report the release URL. Self-hosters on stable (and `install.sh`) pick this version up on the next poll / pull.
