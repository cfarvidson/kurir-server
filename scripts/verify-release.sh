#!/bin/sh
# Verify that a release commit is complete before it is tagged or published.
#
# A CalVer release must bump ALL of these in the same commit:
#   package.json   — version read by the app and updater
#   latest.json    — update manifest polled by self-hosted instances
#   changelog.json — feeds the Changelog list in the admin Updates page
#   CHANGELOG.md   — human changelog
#
# Usage: scripts/verify-release.sh <version>   (with or without leading v)
# Run locally by /bump before tagging, and in CI on tag builds — the
# docker-publish workflow refuses to publish the image if this fails.
set -e

VERSION="${1#v}"
if [ -z "$VERSION" ]; then
  echo "usage: $0 <version>" >&2
  exit 2
fi

fail=0

check() {
  desc="$1" ok="$2"
  if [ "$ok" = "true" ]; then
    echo "ok: $desc"
  else
    echo "MISSING: $desc" >&2
    fail=1
  fi
}

pkg=$(node -p "require('./package.json').version === '$VERSION'")
check "package.json version is $VERSION" "$pkg"

manifest=$(node -p "const m = require('./latest.json'); m.version === '$VERSION' && m.image.endsWith(':v$VERSION')")
check "latest.json version and image tag are $VERSION" "$manifest"

adminlog=$(node -p "require('./changelog.json')[0].version === '$VERSION'")
check "changelog.json newest entry is $VERSION (admin Updates changelog)" "$adminlog"

if grep -q "^## \[v$VERSION\]" CHANGELOG.md; then
  check "CHANGELOG.md has a section for v$VERSION" true
else
  check "CHANGELOG.md has a section for v$VERSION" false
fi

if [ "$fail" -ne 0 ]; then
  echo "" >&2
  echo "Release v$VERSION is incomplete — every file above must be updated" >&2
  echo "in the release commit. See docs/releasing.md." >&2
  exit 1
fi
echo "Release v$VERSION is complete."
