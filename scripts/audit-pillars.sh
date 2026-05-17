#!/usr/bin/env bash
# ============================================================================
# audit-pillars.sh — operational closure of L-012 (gStack pillar drift).
#
# For each "pillar" claimed in README.md's "stands on the shoulders of" list,
# grep the slice's commit messages + diff for invocation patterns and report
# INVOKED (count) / NOT INVOKED. Per SPEC_V02F.md AC-6.
#
# Usage:
#   scripts/audit-pillars.sh [<base-branch>]
#   scripts/audit-pillars.sh --ci [<base-branch>]
#   scripts/audit-pillars.sh --help
#
# Defaults:
#   <base-branch> = main
#
# Flags:
#   --ci         Exit 1 if any claimed pillar has count==0 (opt-in CI gate).
#                Without --ci, the script is advisory (always exit 0).
#   --help, -h   Print this usage and exit 0.
#
# Output: a markdown-like table on stdout:
#   PILLAR    | INVOKED (count) | LAST_COMMIT | NOTES
#   ----------+-----------------+-------------+--------------------------------
#   gStack    | INVOKED (3)     | abc1234     | mmd ship · /qa · /ship
#   Ralph...  | NOT INVOKED     | —           | no commits matched patterns
#
# Patterns live in scripts/audit-pillars.patterns.json (v1 schema). If `jq`
# is unavailable, the script prints a clear message and exits 0 (graceful
# degradation per error-handling.md §III — auditing is advisory, not gating).
#
# Exit codes:
#   0  success (default), OR --ci with every pillar invoked
#   1  --ci AND at least one pillar count==0
#   2  user error (bad flag, missing patterns.json, not a git repo)
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATTERNS_FILE="${SCRIPT_DIR}/audit-pillars.patterns.json"

# --- Argument parsing -------------------------------------------------------
CI_MODE=false
BASE_BRANCH="main"

while [ "$#" -gt 0 ]; do
    case "$1" in
        --help|-h)
            sed -n '2,42p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        --ci)
            CI_MODE=true
            shift
            ;;
        --*)
            echo "audit-pillars: unknown flag: $1" >&2
            echo "Run with --help to see usage." >&2
            exit 2
            ;;
        *)
            BASE_BRANCH="$1"
            shift
            ;;
    esac
done

# --- Pre-flight checks ------------------------------------------------------

# Not a git repo? user error (exit 2 per error-handling.md §II).
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "audit-pillars: not inside a git repository (cd into the MMD repo first)" >&2
    exit 2
fi

# Patterns file is the contract — missing it is a user/install error.
if [ ! -f "${PATTERNS_FILE}" ]; then
    echo "audit-pillars: patterns file missing: ${PATTERNS_FILE}" >&2
    exit 2
fi

# jq is required to read patterns.json. Graceful degradation if absent
# (error-handling.md §III): print a clear message and exit 0 — auditing is
# advisory, not gating. CI mode preserves the same exit semantics: the script
# can't enforce what it can't measure, so it bails cleanly with a non-fatal
# warning rather than silently lying about pillar invocations.
if ! command -v jq >/dev/null 2>&1; then
    cat <<EOF
audit-pillars: jq not installed — skipping pillar audit.

Install jq to enable this audit:
  Debian/Ubuntu:  sudo apt-get install jq
  macOS:          brew install jq
  Arch:           sudo pacman -S jq

This is advisory only (not a hard failure). Re-run after installing jq.
EOF
    exit 0
fi

# Confirm the base-branch ref exists (locally OR on origin).
if ! git rev-parse --verify "${BASE_BRANCH}" >/dev/null 2>&1; then
    if git rev-parse --verify "origin/${BASE_BRANCH}" >/dev/null 2>&1; then
        BASE_BRANCH="origin/${BASE_BRANCH}"
    else
        echo "audit-pillars: base branch '${BASE_BRANCH}' not found (locally or on origin)" >&2
        echo "Pass the base branch as the first argument: scripts/audit-pillars.sh <branch>" >&2
        exit 2
    fi
fi

# --- Compute the commit range ----------------------------------------------
# `<base>..HEAD` = commits reachable from HEAD but not from base.
# If HEAD == base, the range is empty (no slice commits) → every pillar is
# NOT INVOKED, which is the honest answer.
RANGE="${BASE_BRANCH}..HEAD"

# --- Read pillar definitions ------------------------------------------------
PILLAR_COUNT="$(jq '.pillars | length' "${PATTERNS_FILE}")"
if [ "${PILLAR_COUNT}" -eq 0 ]; then
    echo "audit-pillars: patterns.json contains zero pillars" >&2
    exit 2
fi

# --- Build the commit + diff haystack once (perf: one git call per kind) ----
COMMIT_MSGS="$(git log --format='%H%n%B%n---' "${RANGE}" 2>/dev/null || true)"
DIFF_TEXT="$(git diff "${RANGE}" 2>/dev/null || true)"

# Combined haystack — patterns match against either commit messages OR diff.
HAYSTACK="${COMMIT_MSGS}
${DIFF_TEXT}"

# --- Audit each pillar ------------------------------------------------------
printf '%-12s | %-18s | %-12s | %s\n' "PILLAR" "INVOKED (count)" "LAST_COMMIT" "NOTES"
printf '%s\n' "-------------+--------------------+--------------+----------------------------------------"

ANY_MISSING=0

for i in $(seq 0 $((PILLAR_COUNT - 1))); do
    NAME="$(jq -r ".pillars[$i].name" "${PATTERNS_FILE}")"
    PATTERNS_JSON="$(jq -c ".pillars[$i].patterns" "${PATTERNS_FILE}")"
    NEG_JSON="$(jq -c ".pillars[$i].negative_patterns // []" "${PATTERNS_FILE}")"

    # Count regex hits across the haystack.
    COUNT=0
    MATCHED_PATTERNS=()
    PATTERN_LEN="$(echo "${PATTERNS_JSON}" | jq 'length')"
    for j in $(seq 0 $((PATTERN_LEN - 1))); do
        PAT="$(echo "${PATTERNS_JSON}" | jq -r ".[$j]")"
        # -E for extended regex; -c counts matches; -i case-insensitive for human-friendly matching.
        HITS="$(printf '%s' "${HAYSTACK}" | grep -Ec -i -- "${PAT}" || true)"
        if [ "${HITS}" -gt 0 ]; then
            COUNT=$((COUNT + HITS))
            MATCHED_PATTERNS+=("${PAT}")
        fi
    done

    # Subtract negative-pattern hits (counted as evidence the matches are spurious).
    NEG_LEN="$(echo "${NEG_JSON}" | jq 'length')"
    for j in $(seq 0 $((NEG_LEN - 1))); do
        PAT="$(echo "${NEG_JSON}" | jq -r ".[$j]")"
        NEG_HITS="$(printf '%s' "${HAYSTACK}" | grep -Ec -i -- "${PAT}" || true)"
        COUNT=$((COUNT - NEG_HITS))
        if [ "${COUNT}" -lt 0 ]; then COUNT=0; fi
    done

    # Resolve the last commit that touched a pattern (best-effort).
    LAST_COMMIT="—"
    if [ "${COUNT}" -gt 0 ] && [ "${#MATCHED_PATTERNS[@]}" -gt 0 ]; then
        # Use the first matched pattern to find the last commit (best-effort signal).
        PROBE_PAT="${MATCHED_PATTERNS[0]}"
        LAST_SHA="$(git log --format=%H -G "${PROBE_PAT}" "${RANGE}" 2>/dev/null | head -1 || true)"
        if [ -z "${LAST_SHA}" ]; then
            LAST_SHA="$(git log --format=%H --grep "${PROBE_PAT}" "${RANGE}" 2>/dev/null | head -1 || true)"
        fi
        if [ -n "${LAST_SHA}" ]; then
            LAST_COMMIT="${LAST_SHA:0:7}"
        fi
    fi

    # Notes column: a compact summary of which patterns matched (or why empty).
    if [ "${COUNT}" -gt 0 ]; then
        NOTES="$(IFS=' · '; echo "${MATCHED_PATTERNS[*]:0:3}")"
        STATUS="INVOKED (${COUNT})"
    else
        NOTES="no commits matched patterns"
        STATUS="NOT INVOKED"
        ANY_MISSING=$((ANY_MISSING + 1))
    fi

    printf '%-12s | %-18s | %-12s | %s\n' "${NAME}" "${STATUS}" "${LAST_COMMIT}" "${NOTES}"
done

echo ""
echo "Range: ${RANGE}"
echo "Patterns: ${PATTERNS_FILE} (v$(jq -r .version "${PATTERNS_FILE}"))"

if [ "${CI_MODE}" = "true" ] && [ "${ANY_MISSING}" -gt 0 ]; then
    echo ""
    echo "audit-pillars: --ci mode: ${ANY_MISSING} pillar(s) NOT INVOKED in this range — failing with exit 1" >&2
    exit 1
fi

exit 0
