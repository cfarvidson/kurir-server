# Releasing a New Version

Kurir uses **calendar versioning** (CalVer) in the format `YYYY.MM.DD` (e.g., `2026.04.01`). If multiple releases ship on the same day, append a build number: `2026.04.01.2`, `2026.04.01.3`, etc.

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
7. **Deploy** the CI-built image once the `Publish Docker image` workflow for the tag is green: `bin/deploy deploy --skip-push --version v<version>` (pulls `ghcr.io/cfarvidson/kurir-server:v<version>`; never bare `kamal`, see CLAUDE.md)
8. **Create a GitHub release** with the tag `vYYYY.MM.DD`

## `latest.json` format

```json
{
  "version": "2026.04.01",
  "image": "ghcr.io/cfarvidson/kurir-server:v2026.04.01",
  "releaseUrl": "https://github.com/cfarvidson/kurir-server/releases/tag/v2026.04.01",
  "changelog": "Short description of what changed",
  "minVersion": "0.0.0",
  "releasedAt": "2026-04-01T00:00:00Z"
}
```

| Field        | Description                                                |
| ------------ | ---------------------------------------------------------- |
| `version`    | The new version string (CalVer)                            |
| `image`      | Docker image tag for this release                          |
| `releaseUrl` | GitHub release URL                                         |
| `changelog`  | One-liner shown in the admin UI                            |
| `minVersion` | Minimum version required to upgrade (for breaking changes) |
| `releasedAt` | ISO 8601 timestamp                                         |

## Automation

Use the `/bump` slash command to automate the full release process. It handles version bumping, `latest.json`, committing, tagging, creating the GitHub release, and deploying the CI-built image.
