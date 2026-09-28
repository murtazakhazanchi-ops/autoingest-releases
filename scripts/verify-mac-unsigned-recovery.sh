#!/bin/bash
# D3 — Stable macOS recovery verification (UNSIGNED / NOT NOTARIZED — D3 DEFERRED).
#
# Companion to scripts/verify-mac-signing.sh, which strictly requires a real Developer ID
# signature and correctly FAILS an ad-hoc/unsigned bundle by design — that script must never
# be pointed at a deliberately-unsigned recovery artifact. This script instead proves that an
# intentionally-unsigned recovery artifact is internally well-formed — the same known-good
# ad-hoc-sealed state RC.4 already passed full manual acceptance against — while explicitly
# recording (never silently accepting) the expected Gatekeeper/notarization limitations of
# that state.
#
# Usage: scripts/verify-mac-unsigned-recovery.sh /path/to/AutoIngest.app [expected-bundle-id]
#
# Exits non-zero only if the bundle is not a validly-sealed build at all (missing signature
# entirely, wrong bundle id, resources not sealed). Exits zero even though spctl/stapler are
# expected to reject/have-no-ticket — those are the accepted, logged D3-deferred limitation,
# not a failure of this script.

set -u
set -o pipefail   # a `cmd | tee log` pipeline must fail when `cmd` fails, not just when `tee` does
APP="${1:?usage: verify-mac-unsigned-recovery.sh <path-to-.app> [expected-bundle-id]}"
EXPECTED_BUNDLE_ID="${2:-com.autoingest.app}"
FAILED=0

log()  { echo "[verify-mac-unsigned-recovery] $*"; }
fail() { echo "[verify-mac-unsigned-recovery] FAIL — $*" >&2; FAILED=1; }
pass() { echo "[verify-mac-unsigned-recovery] PASS — $*"; }
note() { echo "[verify-mac-unsigned-recovery] NOTE — $*"; }

if [ ! -d "$APP" ]; then
  fail "no such app bundle: $APP"
  exit 1
fi
log "verifying (unsigned/ad-hoc recovery path): $APP"

# ── 1. Strict deep signature verification — an ad-hoc seal must still be internally
#       consistent. electron-builder always applies at least an ad-hoc seal on macOS; this
#       is what distinguishes a real recovery artifact from a silently-empty/corrupt one. ──
if codesign --verify --deep --strict --verbose=4 "$APP" 2>&1 | tee /tmp/verify-mac-unsigned-codesign.log; then
  pass "codesign --verify --deep --strict"
else
  fail "codesign --verify --deep --strict (see output above) — even an ad-hoc seal must be internally consistent"
fi

DV_OUT="$(codesign -dv --verbose=4 "$APP" 2>&1)"
echo "$DV_OUT"

if ! codesign -d "$APP" >/dev/null 2>&1; then
  fail "code object is not signed at all — even ad-hoc signing was not applied"
else
  if echo "$DV_OUT" | grep -q "Signature=adhoc"; then
    pass "signature is ad-hoc (expected — D3 deferred; this is never a real Developer ID signature)"
  else
    note "signature is not reported as ad-hoc — unexpected for this path, but not itself a failure here (verify-mac-signing.sh is the strict signed-path gate)"
  fi
fi

# ── 2. Bundle identity — must still be the real app, not a stale/partial build. ──
BID="$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$APP/Contents/Info.plist" 2>/dev/null)"
if [ "$BID" = "$EXPECTED_BUNDLE_ID" ]; then
  pass "CFBundleIdentifier is $EXPECTED_BUNDLE_ID"
else
  fail "CFBundleIdentifier is '$BID', expected '$EXPECTED_BUNDLE_ID'"
fi

CODE_IDENTIFIER="$(echo "$DV_OUT" | grep '^Identifier=' | head -1 | sed 's/^Identifier=//')"
if [ "$CODE_IDENTIFIER" = "$EXPECTED_BUNDLE_ID" ]; then
  pass "codesign Identifier is $EXPECTED_BUNDLE_ID (not a stale inherited Electron identifier)"
else
  fail "codesign Identifier is '$CODE_IDENTIFIER', expected '$EXPECTED_BUNDLE_ID' — the seal was likely never actually applied to this bundle"
fi

# ── 3. Resource sealing present (proves the bundle was actually packaged, not just copied). ──
if [ -f "$APP/Contents/_CodeSignature/CodeResources" ]; then
  pass "Contents/_CodeSignature/CodeResources present"
else
  fail "Contents/_CodeSignature/CodeResources is absent"
fi

# ── 4. Expected, ACCEPTED D3-deferred limitations — logged explicitly, never silently. ──
if spctl --assess --type execute --verbose=4 "$APP" 2>&1 | tee /tmp/verify-mac-unsigned-spctl.log; then
  note "spctl --assess unexpectedly PASSED for an intentionally-unsigned build — re-check whether this artifact is actually unsigned before trusting this result"
else
  note "spctl --assess --type execute rejected this artifact, as expected for UNSIGNED / NOT NOTARIZED — D3 DEFERRED"
fi

if xcrun stapler validate "$APP" 2>&1 | tee /tmp/verify-mac-unsigned-stapler.log; then
  note "xcrun stapler validate unexpectedly found a notarization ticket for an unsigned build — re-check before trusting this result"
else
  note "xcrun stapler validate found no notarization ticket (NO TICKET), as expected for UNSIGNED / NOT NOTARIZED — D3 DEFERRED"
fi

echo ""
echo "[verify-mac-unsigned-recovery] classification: UNSIGNED / NOT NOTARIZED — D3 DEFERRED"
if [ "$FAILED" -ne 0 ]; then
  echo "[verify-mac-unsigned-recovery] === ONE OR MORE STRUCTURAL CHECKS FAILED — this artifact must not be uploaded/republished ===" >&2
  exit 1
fi
echo "[verify-mac-unsigned-recovery] === ALL STRUCTURAL CHECKS PASSED (Gatekeeper/notarization rejection above is the accepted, logged limitation) ==="
exit 0
