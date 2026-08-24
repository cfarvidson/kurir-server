#!/bin/sh
# Verify that a release commit is complete before it is tagged, published,
# or marked stable.
#
# A release version is CalVer YYYY.MICRO: a four-digit year and one serial per
# year, shared with kurir-ios and incremented across both repos. The old
# YYYY.MM.N shape is rejected outright so a leftover month component cannot be
# tagged by mistake.
#
# Two modes:
#   beta (default, used on tag builds)
#     package.json, changelog.json, CHANGELOG.md, and latest.json.beta match
#     the tag. The top-level latest.json pointer stays on the last stable.
#   mark-stable
#     the top-level pointer matches the tag (copied from beta). beta may be
#     omitted or equal to top-level. No image is built; promote-latest.yml
#     retags :latest onto the already-published versioned image.
#
# Usage: scripts/verify-release.sh [--mode beta|mark-stable] <version>
#        (version with or without leading v)
# Run locally by /bump, and in CI on tag builds. The docker-publish
# workflow refuses to publish the image if beta mode fails.
set -e

MODE=beta
VERSION=""
while [ $# -gt 0 ]; do
  case "$1" in
    --mode)
      MODE="$2"
      shift 2
      ;;
    --mode=*)
      MODE="${1#--mode=}"
      shift
      ;;
    -*)
      echo "usage: $0 [--mode beta|mark-stable] <version>" >&2
      exit 2
      ;;
    *)
      VERSION="${1#v}"
      shift
      ;;
  esac
done

if [ -z "$VERSION" ]; then
  echo "usage: $0 [--mode beta|mark-stable] <version>" >&2
  exit 2
fi

if [ "$MODE" != "beta" ] && [ "$MODE" != "mark-stable" ]; then
  echo "usage: $0 [--mode beta|mark-stable] <version>" >&2
  exit 2
fi

# YYYY.MICRO only. A leading zero on the micro is refused too: it means someone
# typed a month (2026.08) where a serial belongs, and micro counts from 1.
#
# v2026.08.28 was the final YYYY.MM.N release - the one carrying the tolerant
# manifest parser, which had to reach the field before the format could flip.
# It shipped, so the one-release exception that let it past this gate is gone
# again and the shape is unconditional from here on.
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

adminlog=$(node -p "require('./changelog.json')[0].version === '$VERSION'")
check "changelog.json newest entry is $VERSION (admin Updates changelog)" "$adminlog"

if grep -q "^## \[v$VERSION\]" CHANGELOG.md; then
  check "CHANGELOG.md has a section for v$VERSION" true
else
  check "CHANGELOG.md has a section for v$VERSION" false
fi

if [ "$MODE" = "beta" ]; then
  beta=$(node -p "
    const m = require('./latest.json');
    const b = m.beta;
    String(!!(b && b.version === '$VERSION' && String(b.image).endsWith(':v$VERSION')));
  ")
  check "latest.json.beta version and image tag are $VERSION" "$beta"

  top=$(node -p "String(require('./latest.json').version !== '$VERSION')")
  check "latest.json top-level pointer is not $VERSION (left on last stable)" "$top"
else
  top=$(node -p "
    const m = require('./latest.json');
    String(m.version === '$VERSION' && String(m.image).endsWith(':v$VERSION'));
  ")
  check "latest.json top-level version and image tag are $VERSION" "$top"

  betaok=$(node -p "
    const m = require('./latest.json');
    const b = m.beta;
    String(!b || (b.version === '$VERSION' && String(b.image).endsWith(':v$VERSION')));
  ")
  check "latest.json.beta matches $VERSION or is omitted" "$betaok"
fi

if [ "$fail" -ne 0 ]; then
  echo "" >&2
  echo "Release v$VERSION is incomplete. Every file above must be updated" >&2
  echo "in the release commit. See docs/releasing.md." >&2
  exit 1
fi
echo "Release v$VERSION is complete."
