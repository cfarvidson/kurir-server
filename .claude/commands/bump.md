Create a new release of Kurir using calendar versioning (CalVer).

Read `docs/releasing.md` for the full release process documentation.

## Steps

1. Determine the new version:
   - Format: `YYYY.MM.N` (CalVer year, zero-padded month, monthly serial)
   - `YYYY` and `MM` from today's date (e.g. `2026.08`)
   - `N` is one greater than the highest third component among existing git
     tags matching `vYYYY.MM.*`, and among `package.json` / `latest.json` if
     they already belong to this month. Historical four-part tags still
     count via their third component: `v2026.08.19.3` means this month's
     next N is at least 20 (`2026.08.20`). A new month starts at 1
     (`2026.09.1`). Never append a fourth component.
   - Check `package.json` and `latest.json` to avoid collisions

2. Ask the user for a short changelog (one line describing what changed since the last release). Suggest one based on recent commits since the last version tag.

3. Bump `package.json` version to the new CalVer string

4. Create or update `latest.json` in the repo root:

   ```json
   {
     "version": "<new version>",
     "image": "ghcr.io/cfarvidson/kurir-server:v<new version>",
     "releaseUrl": "https://github.com/cfarvidson/kurir-server/releases/tag/v<new version>",
     "changelog": "<user-provided changelog>",
     "minVersion": "0.0.0",
     "releasedAt": "<ISO 8601 now>"
   }
   ```

5. Update `CHANGELOG.md`: add a `## [v<new version>] - <date>` section under `[Unreleased]` describing the changes. Move any bullets already under `[Unreleased]` into that section.

6. Update `changelog.json` in the repo root: prepend an entry for the new version. This file feeds the Changelog list in the admin Updates page — it MUST be updated in the same commit as the version bump:

   ```json
   {
     "version": "<new version>",
     "date": "<YYYY-MM-DD>",
     "changes": ["<one short bullet per user-visible change>"]
   }
   ```

7. Run `npx prettier --write package.json latest.json changelog.json CHANGELOG.md`

8. Commit: `release: v<new version>`

9. Verify the release commit is complete: `./scripts/verify-release.sh v<new version>` — this MUST pass before tagging. CI runs the same check on the tag build and refuses to publish the image if any release file (package.json, latest.json, changelog.json, CHANGELOG.md) was not bumped.

10. Tag: `git tag v<new version>`

11. Push: `git push origin main --tags`

12. Create GitHub release:

    ```
    gh release create v<new version> --title "v<new version>" --notes "<changelog>"
    ```

13. Deploy the CI-built image (see `docs/releasing.md` → "Deploying a release"). Kamal does not build locally; it pulls `ghcr.io/cfarvidson/kurir-server:v<new version>` which CI publishes on the tag build.

    Wait for the `Publish Docker image` run for the tag to be green (5–10 min):

    ```
    gh run list --workflow docker-publish.yml --limit 3
    gh run watch <run-id> --exit-status
    ```

    Then deploy — always via `bin/deploy`, never bare `kamal`:

    ```
    KAMAL_REGISTRY_PASSWORD="$(gh auth token)" bin/deploy deploy --skip-push --version v<new version>
    ```

    (`gh auth token` works because the ghcr.io package is public; a PAT with `write:packages` is only needed for local build+push.)

    Verify: `bin/deploy app containers` shows only `kurir-web-v<new version>` Up, and `curl -s https://kurir-app-1.banded-beta.ts.net/api/up` returns `{"status":"ok"}`. If the deploy fails on health while the app log says it was ready, follow the kamal-proxy recovery in `docs/releasing.md`.

14. Report the release URL when done.
