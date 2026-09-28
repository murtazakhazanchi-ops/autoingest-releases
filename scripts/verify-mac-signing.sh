#!/bin/bash
# D3 — macOS release-signing verification gate.
#
# Proves a packaged .app is actually Developer-ID signed, Hardened-Runtime
# enabled, and notarization-stapled — not merely "codesign didn't error."
# Run against the electron-builder appOutDir output (BEFORE dmg/zip wrapping)
# so a failure here is caught at the earliest possible point, and again
# against anything extracted from the final DMG/ZIP to prove packaging did
# not mutate the already-signed bundle (D3 Phase 13).
#
# Usage: scripts/verify-mac-signing.sh /path/to/AutoIngest.app [expected-bundle-id]
#
# Exits non-zero — failing the CI job — if ANY check fails. Never uploads or
# publishes anything itself; this only verifies an artifact electron-builder
# already produced. No secret values are read or printed.

set -u
set -o pipefail   # a `cmd | tee log` pipeline must fail when `cmd` fails, not just when `tee` does
APP="${1:?usage: verify-mac-signing.sh <path-to-.app> [expected-bundle-id]}"
EXPECTED_BUNDLE_ID="${2:-com.autoingest.app}"
FAILED=0

log()  { echo "[verify-mac-signing] $*"; }
fail() { echo "[verify-mac-signing] FAIL — $*" >&2; FAILED=1; }
pass() { echo "[verify-mac-signing] PASS — $*"; }

if [ ! -d "$APP" ]; then
  fail "no such app bundle: $APP"
  exit 1
fi
log "verifying: $APP"

# ── 1. Strict deep signature verification ──────────────────────────────────
if codesign --verify --deep --strict --verbose=4 "$APP" 2>&1 | tee /tmp/verify-mac-signing-codesign.log; then
  pass "codesign --verify --deep --strict"
else
  fail "codesign --verify --deep --strict (see output above)"
fi

# ── 2. Gatekeeper execute assessment ────────────────────────────────────────
if spctl --assess --type execute --verbose=4 "$APP" 2>&1 | tee /tmp/verify-mac-signing-spctl.log; then
  pass "spctl --assess --type execute"
else
  fail "spctl --assess --type execute (see output above)"
fi

# ── 3. Notarization ticket stapled ──────────────────────────────────────────
if xcrun stapler validate "$APP" 2>&1 | tee /tmp/verify-mac-signing-stapler.log; then
  pass "xcrun stapler validate"
else
  fail "xcrun stapler validate — no ticket stapled"
fi

# ── 4. Identity assertions — never accept a silent ad-hoc fallback ─────────
DV_OUT="$(codesign -dv --verbose=4 "$APP" 2>&1)"
echo "$DV_OUT"

# `codesign -dv` on a completely unsigned bundle ("code object is not signed at all") prints
# no CodeDirectory block at all — every text-absence check below (no "Signature=adhoc", no
# "TeamIdentifier=not set") would then be wrongly satisfied by ABSENCE of evidence rather
# than a real signature. Gate all of them behind an explicit "is this actually signed"
# check first, caught empirically: an x64 local build with no identity found returns
# exactly this exit code with no CodeDirectory output at all.
if ! codesign -d "$APP" >/dev/null 2>&1; then
  fail "code object is not signed at all (codesign -d itself failed)"
  fail "signature is ad-hoc, not a real Developer ID signature (no signature present at all)"
  fail "TeamIdentifier is not set — no real Developer ID identity was used (no CodeDirectory at all)"
  fail "Authority chain does not start with Developer ID Application (no signature present at all)"
else
  if echo "$DV_OUT" | grep -q "Signature=adhoc"; then
    fail "signature is ad-hoc, not a real Developer ID signature"
  else
    pass "signature is not ad-hoc"
  fi

  TEAM_LINE="$(echo "$DV_OUT" | grep '^TeamIdentifier=')"
  if [ -z "$TEAM_LINE" ] || [ "$TEAM_LINE" = "TeamIdentifier=not set" ]; then
    fail "TeamIdentifier is not set — no real Developer ID identity was used"
  else
    pass "TeamIdentifier present ($TEAM_LINE)"
  fi

  if echo "$DV_OUT" | grep -q "^Authority=Developer ID Application:"; then
    pass "Authority chain starts with Developer ID Application"
  else
    fail "Authority chain does not start with Developer ID Application"
  fi
fi

# PlistBuddy, not `defaults read` — `defaults` proved unreliable against a plain relative
# .app path in testing (empty read despite a valid Info.plist); PlistBuddy read it correctly.
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
  fail "codesign Identifier is '$CODE_IDENTIFIER', expected '$EXPECTED_BUNDLE_ID' — signature was likely never actually applied to this bundle"
fi

# ── 5. Hardened Runtime flag present ────────────────────────────────────────
if echo "$DV_OUT" | grep -q "flags=.*runtime"; then
  pass "Hardened Runtime flag present"
else
  fail "Hardened Runtime flag not present in CodeDirectory flags"
fi

# ── 6. _CodeSignature/CodeResources present (a real bundle signature seals resources) ──
if [ -f "$APP/Contents/_CodeSignature/CodeResources" ]; then
  pass "Contents/_CodeSignature/CodeResources present"
else
  fail "Contents/_CodeSignature/CodeResources is absent"
fi

echo ""
if [ "$FAILED" -ne 0 ]; then
  echo "[verify-mac-signing] === ONE OR MORE CHECKS FAILED — this artifact must not be published ===" >&2
  exit 1
fi
echo "[verify-mac-signing] === ALL CHECKS PASSED ==="
exit 0
