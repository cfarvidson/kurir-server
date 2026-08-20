# Releasing a New Version

Kurir uses **calendar versioning** (CalVer) in the format `YYYY.MM.N` (year, zero-padded month, monthly serial). Examples: `2026.08.20`, `2026.08.21`, `2026.09.1`.

- `N` is the release count for that year-month. It starts at `1` each month and increments for every release, including several on the same day.
- Compute `N` as one greater than the highest third component among existing git tags matching `vYYYY.MM.*`, plus `package.json` / `latest.json` so an untagged bump still counts. Historical four-part tags such as `v2026.08.19.3` still count via their third component, so the first `YYYY.MM.N` release after that is `2026.08.20`.
- Never add a fourth component. Auto-update compares dotted numbers left to right (`2026.08.19.3` < `2026.08.20` < `2026.09.1`), and App Store marketing versions must stay three-part.

Older `YYYY.MM.DD` and `YYYY.MM.DD.N` tags stay as-is.

## How the auto-update system works

1. The app reads its version from `package.json`
2. Every 6 hours, it fetches `latest.json` from the repo's main branch
3. If the manifest version is higher, the admin UI shows "update available"
4. Users can apply the update from the admin panel (or it auto-applies if configured)

The manifest URL defaults to:

```
https://raw.githubusercontent.com/cfarvidson/kurir-server/main/latest.json
```

## Release checklist

1. **Bump version** in `package.json`
2. **Update `latest.json`** in the repo root with the new version, image tag, changelog, and release URL
3. **Update `CHANGELOG.md`** with a section for the new version
4. **Update `changelog.json`** in the repo root — it feeds the Changelog list in the admin Updates page and must be updated in the same commit as the version bump (format: `{ "version", "date", "changes": [...] }`, newest first)
5. **Commit** to main and **verify** with `./scripts/verify-release.sh v<version>` — it checks that all four files above were bumped. CI runs the same check on the tag build and refuses to publish the Docker image for an incomplete release
6. **Tag and push** to main
7. **Create a GitHub release** with the tag `vYYYY.MM.N`
8. **Deploy** the CI-built image — see [Deploying a release](#deploying-a-release) below

## Deploying a release

Production runs the image that CI publishes to `ghcr.io/cfarvidson/kurir-server:v<version>` on every tag build. Kamal does **not** build locally: it pulls that image on the host and swaps containers.

1. **Wait for the image.** The `Publish Docker image` workflow for the tag must be green (multi-arch build, typically 5–10 min):

   ```bash
   gh run list --workflow docker-publish.yml --limit 3     # find the run for the tag
   gh run watch <run-id> --exit-status
   ```

2. **Deploy with the wrapper, never bare `kamal`** (bare `kamal` from a shell without the `KAMAL_*` env deploys empty secrets — see CLAUDE.md):

   ```bash
   KAMAL_REGISTRY_PASSWORD="$(gh auth token)" bin/deploy deploy --skip-push --version v<version>
   ```

   - `--skip-push` = no local build/push; Kamal pulls `image:version` from ghcr.io on the host.
   - `KAMAL_REGISTRY_PASSWORD` is the ghcr.io login. The package is public, so the `gh` CLI token (`gh auth token`) is enough for pull-only deploys — no PAT needed. To build and push locally instead (`bin/deploy` without `--skip-push`) you need a PAT with `write:packages` in `~/.kamal/kurir-secrets.env`.
   - Kamal refuses a pre-built image without the `service=kurir` label; the runner stage of the `Dockerfile` sets it (v2026.08.16.5+).

3. **Verify:**

   ```bash
   bin/deploy app containers          # only kurir-web-v<version> should be Up
   curl -s https://kurir-app-1.banded-beta.ts.net/api/up   # {"status":"ok"}
   ```

If the deploy fails with `target failed to become healthy` and the container log shows the app was ready, check the proxy: `bin/deploy server exec "docker inspect kamal-proxy --format '{{json .NetworkSettings.Networks}} {{json .NetworkSettings.Ports}}'"` — empty networks/ports means kamal-proxy lost the `:443` bind race against tailscaled after a host reboot. Recovery: `docker rm -f kamal-proxy` on the host, then `bin/deploy proxy boot` (the config binds the proxy to `127.0.0.1`, see CLAUDE.md), then deploy again.

## `latest.json` format

```json
{
  "version": "2026.08.20",
  "image": "ghcr.io/cfarvidson/kurir-server:v2026.08.20",
  "releaseUrl": "https://github.com/cfarvidson/kurir-server/releases/tag/v2026.08.20",
  "changelog": "Short description of what changed",
  "minVersion": "0.0.0",
  "releasedAt": "2026-08-20T00:00:00Z"
}
```

| Field        | Description                                                |
| ------------ | ---------------------------------------------------------- |
| `version`    | The new version string (CalVer `YYYY.MM.N`)                |
| `image`      | Docker image tag for this release                          |
| `releaseUrl` | GitHub release URL                                         |
| `changelog`  | One-liner shown in the admin UI                            |
| `minVersion` | Minimum version required to upgrade (for breaking changes) |
| `releasedAt` | ISO 8601 timestamp                                         |

## Automation

Use the `/bump` slash command to automate the full release process. It handles version bumping, `latest.json`/`changelog.json`/`CHANGELOG.md`, committing, verifying, tagging, creating the GitHub release, waiting for the CI image, and deploying it with `bin/deploy deploy --skip-push`.
