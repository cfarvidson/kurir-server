# Releasing a New Version

Kurir uses **calendar versioning** (CalVer) in the format `YYYY.MICRO` (e.g. `2026.29`): a four-digit year and one serial per year.

`MICRO` is a single counter shared with **kurir-ios**. It is incremented across both repos, not per repo and not per month, and resets to 1 at the year boundary. A paired release carries the identical string in both. It is not a date: `2026.29` is the 29th release of 2026, not February 9th or September 29th.

Pick the next micro as one greater than the highest serial across both repos' tags. Tags from the older `YYYY.MM.N` and `YYYY.MM.DD.N` formats count via their third component. The micro must also outrank the last month component ever used (`08`), so that component-wise numeric comparison keeps ranking the new format above the old: `2026.08.27` < `2026.28` < `2026.29`. Both rules together are why a micro must never restart at 1 mid-year.

`./scripts/verify-release.sh` enforces the shape and refuses a leftover `YYYY.MM.N` or a zero-padded micro. It has two modes: `beta` (default, used on tag builds) and `mark-stable`. Note the asymmetry: instances _parse_ two, three, or four components so they can still read old manifests, but we only ever _release_ two.

> **Instances older than the final `YYYY.MM.N` release must be updated by hand.** The tolerant manifest parser ships in that release, which is why it had to go out before the format flipped. An instance that never picked it up cannot read a `YYYY.MICRO` manifest at all: it logs a parse failure, reports "no update", and stays there until someone pulls a newer image manually.

## How the auto-update system works

1. The app reads its version from `package.json`
2. Every 6 hours, it fetches `latest.json` from the repo's main branch
3. Top-level fields are the latest _stable_ pointer. An optional `beta` object is the newest tagged version that has not been marked stable yet
4. Instances on the stable channel (the default) read the top-level pointer. Instances with Admin -> Updates "Install betas" on read `beta` when it is newer
5. If that pointer is higher than the running version, the admin UI shows "update available"
6. Users can apply the update from the admin panel (or it auto-applies if configured)

`install.sh` pulls `ghcr.io/cfarvidson/kurir-server:latest`. That tag is the newest stable image. A new git tag does **not** move it.

The manifest URL defaults to:

```
https://raw.githubusercontent.com/cfarvidson/kurir-server/main/latest.json
```

## Two steps: tag is beta, then mark stable

A new `vYYYY.MICRO` tag is beta. Same number, same image, no `-beta` suffix. Marking it stable is a later step on that version: copy `latest.json.beta` onto the top-level fields, then let `:latest` follow. No new micro, no rebuild.

**Cut a beta** when shipping a new version (TestFlight pairing, testers with Install betas on). Self-hosters on stable never see it.

**Mark stable** when that version should reach every self-hoster and `install.sh`. Same tag, same image.

Turning "Install betas" off does not move the instance back by itself. If it is already running the unmarked version, Admin -> Updates says it is ahead of stable and offers a reinstall of the top-level image. That reinstall does **not** undo database migrations the beta already applied.

## Cut a beta

1. **Bump version** in `package.json`
2. **Write `latest.json.beta`** with the new version, image tag, changelog, and release URL. Leave the top-level pointer on the last marked stable. Use `node scripts/release-manifest.mjs write-beta --version <version> --changelog "<one-liner>" --released-at <ISO now>`
3. **Update `CHANGELOG.md`** with a section for the new version
4. **Update `changelog.json`** in the repo root. It feeds the Changelog list in the admin Updates page and must be updated in the same commit as the version bump (format: `{ "version", "date", "changes": [...] }`, newest first)
5. **Commit** to main and **verify** with `./scripts/verify-release.sh --mode beta v<version>`. It checks that package.json, the changelog files, and `latest.json.beta` match the tag, and that the top-level pointer was left alone. CI runs the same check on the tag build and refuses to publish the Docker image for an incomplete release
6. **Tag and push** to main
7. **Create a GitHub prerelease** with the tag `vYYYY.MICRO`
8. **Deploy** the CI-built _versioned_ image to production if you want to dogfood it. See [Deploying a release](#deploying-a-release) below. This does not move `:latest`

## Mark stable

1. **Copy the beta pointer onto the top-level fields.** `node scripts/release-manifest.mjs mark-stable` (drops `beta` once it matches). No package.json or changelog bump, no new tag
2. **Commit** to main and **verify** with `./scripts/verify-release.sh --mode mark-stable v<version>`
3. **Push** (no tag)
4. **Clear the GitHub prerelease flag:** `gh release edit v<version> --prerelease=false`
5. **Move `:latest`** onto the already-published image, no rebuild: `gh workflow run promote-latest.yml -f version=v<version>`. That workflow re-runs mark-stable verify and refuses to retag if the commit is incomplete

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

Top-level fields are the latest stable pointer. `beta` is the newest tagged version that has not been marked stable. Omit `beta` (or set it equal to top-level) when there is no pending beta.

```json
{
  "version": "2026.29",
  "image": "ghcr.io/cfarvidson/kurir-server:v2026.29",
  "releaseUrl": "https://github.com/cfarvidson/kurir-server/releases/tag/v2026.29",
  "changelog": "stable changelog",
  "minVersion": "0.0.0",
  "releasedAt": "2026-08-24T00:00:00Z",
  "beta": {
    "version": "2026.30",
    "image": "ghcr.io/cfarvidson/kurir-server:v2026.30",
    "releaseUrl": "https://github.com/cfarvidson/kurir-server/releases/tag/v2026.30",
    "changelog": "beta changelog",
    "minVersion": "0.0.0",
    "releasedAt": "2026-08-25T00:00:00Z"
  }
}
```

| Field        | Description                                                       |
| ------------ | ----------------------------------------------------------------- |
| `version`    | Stable version string (CalVer `YYYY.MICRO`)                       |
| `image`      | Docker image tag for that stable release                          |
| `releaseUrl` | GitHub release URL                                                |
| `changelog`  | One-liner shown in the admin UI                                   |
| `minVersion` | Minimum version required to upgrade (for breaking changes)        |
| `releasedAt` | ISO 8601 timestamp                                                |
| `beta`       | Optional. Same shape. Newest tagged version not yet marked stable |

## Automation

Use the `/bump` slash command. It can cut a beta (version bump, `latest.json.beta`, changelogs, tag, GitHub prerelease, versioned image, optional prod deploy) or, separately, mark the current beta stable (copy the pointer, clear prerelease, move `:latest`).
