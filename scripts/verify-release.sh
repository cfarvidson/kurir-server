#!/bin/sh
# Verify that a release commit is complete before it is tagged or published.
#
# A release version is CalVer YYYY.MICRO: a four-digit year and one serial per
# year, shared with kurir-ios and incremented across both repos. The old
# YYYY.MM.N shape is rejected outright so a leftover month component cannot be
# tagged by mistake.
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

# YYYY.MICRO only. A leading zero on the micro is refused too: it means someone
# typed a month (2026.08) where a serial belongs, and micro counts from 1.
if ! echo "$VERSION" | grep -qE '^[0-9]{4}\.[1-9][0-9]*$'; then
  echo "MISSING: $VERSION is not a YYYY.MICRO version" >&2
  echo "" >&2
  echo "Releases are YYYY.MICRO - a four-digit year and one serial per year," >&2
  echo "shared with kurir-ios and incremented across both repos. The old" >&2
  echo "YYYY.MM.N shape and a zero-padded micro are both refused." >&2
  echo "See docs/releasing.md." >&2
  exit 2
fi

# The micro must also sort ABOVE every version already released, or instances
# comparing component by component will never see the release. This is the way
# the format flip can silently strand self-hosters, so it is a hard gate, not
# a note in the docs: 2026.5 is a legal shape but sorts below 2026.08.27.
prev=$(node -p "
  const cmp = (a, b) => {
    const A = a.split('.').map(Number), B = b.split('.').map(Number);
    for (let i = 0; i < Math.max(A.length, B.length); i++) {
      const x = A[i] ?? 0, y = B[i] ?? 0;
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return 0;
  };
  const released = require('./changelog.json')
    .map((e) => e.version)
    .filter((v) => v !== '$VERSION')
    .sort(cmp);
  const highest = released[released.length - 1];
  !highest || cmp('$VERSION', highest) > 0 ? 'true' : highest;
")
if [ "$prev" != "true" ]; then
  echo "MISSING: $VERSION does not sort above the released $prev" >&2
  echo "" >&2
  echo "Instances compare component by component, so a micro that ranks below" >&2
  echo "an existing release is invisible to them. Pick one greater than the" >&2
  echo "highest serial across BOTH repos. See docs/releasing.md." >&2
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
