#!/usr/bin/env bash
# ============================================================================
# audit-pillars.sh — operational closure of L-012 (gStack pillar drift).
#
# For each "pillar" claimed in README.md's "stands on the shoulders of" list,
# grep the slice's commit messages + diff for invocation patterns and report
# INVOKED (count) / NOT INVOKED. Per SPEC_V02F.md AC-6.
#
# Usage:
#   scripts/audit-pillars.sh [<base-branch>|<base>..<head>]
#   scripts/audit-pillars.sh --ci [<base-branch>]
#   scripts/audit-pillars.sh --help
#
# Defaults:
#   <base-branch> = main  (auditing main..HEAD)
#
# Flags:
#   --ci         Exit 1 if any claimed pillar has count==0 (opt-in CI gate).
#                Without --ci, the script is advisory (always exit 0).
#   --help, -h   Print this usage and exit 0.
#
# Output: a table on stdout:
#   PILLAR    | INVOKED (count) | LAST_COMMIT | NOTES
#   ----------+-----------------+-------------+--------------------------------
#   gStack    | INVOKED (3)     | abc1234     | mmd ship · /qa · /ship
#   Ralph Loop| NOT INVOKED (0) | —           | claim drift — see L-012
#
# Patterns live in scripts/audit-pillars.patterns.json (v1 schema). The script
# uses `node` (already a hard MMD dependency) to parse the JSON — this keeps
# the script portable on any machine that can already run MMD, with no
# additional system packages required (jq is NOT a dependency).
#
# Exit codes:
#   0  success (default), OR --ci with every pillar invoked
#   1  --ci AND at least one pillar count==0
#   2  user error (bad flag, missing patterns.json, not a git repo, missing node)
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATTERNS_FILE="${MMD_AUDIT_PATTERNS:-${SCRIPT_DIR}/audit-pillars.patterns.json}"

# --- Argument parsing -------------------------------------------------------
CI_MODE=false
BASE_ARG="main"

while [ "$#" -gt 0 ]; do
    case "$1" in
        --help|-h)
            sed -n '2,38p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        --ci)
            CI_MODE=true
            shift
            ;;
        --)
            shift
            ;;
        --*)
            echo "audit-pillars: unknown flag: $1" >&2
            echo "Run with --help to see usage." >&2
            exit 2
            ;;
        *)
            BASE_ARG="$1"
            shift
            ;;
    esac
done

# Allow caller to pass either '<base>' (→ <base>..HEAD) or '<base>..<head>'.
if [[ "${BASE_ARG}" == *..* ]]; then
    RANGE="${BASE_ARG}"
else
    RANGE="${BASE_ARG}..HEAD"
fi

# --- Pre-flight checks ------------------------------------------------------

if ! command -v git >/dev/null 2>&1; then
    echo "audit-pillars: git is required" >&2
    exit 2
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "audit-pillars: not inside a git repository (cd into the MMD repo first)" >&2
    exit 2
fi

if [ ! -f "${PATTERNS_FILE}" ]; then
    echo "audit-pillars: patterns file missing: ${PATTERNS_FILE}" >&2
    exit 2
fi

if ! command -v node >/dev/null 2>&1; then
    echo "audit-pillars: node is required to parse the patterns JSON" >&2
    exit 2
fi

# Resolve base if the user passed just a branch name; otherwise trust the range.
RANGE_BASE="${RANGE%%..*}"
RANGE_HEAD="${RANGE##*..}"
if [ -n "${RANGE_BASE}" ] && ! git rev-parse --verify "${RANGE_BASE}" >/dev/null 2>&1; then
    if git rev-parse --verify "origin/${RANGE_BASE}" >/dev/null 2>&1; then
        RANGE="origin/${RANGE_BASE}..${RANGE_HEAD}"
    else
        echo "audit-pillars: base ref '${RANGE_BASE}' not found (locally or on origin)" >&2
        echo "Pass the base as the first argument: scripts/audit-pillars.sh <branch-or-range>" >&2
        exit 2
    fi
fi

# Validate the range resolves.
if ! git rev-list --count "${RANGE}" >/dev/null 2>&1; then
    echo "audit-pillars: invalid commit range: ${RANGE}" >&2
    exit 2
fi

# --- Read pillar definitions (via node) -------------------------------------
# Output format: each pillar one line, fields tab-separated:
#   name<TAB>patterns_joined_with_<US><TAB>negative_patterns_joined_with_<US>
# Using ASCII Unit Separator (0x1F) as the inner delimiter avoids any
# collision with regex characters that pillar patterns may contain.
US=$(printf '\037')
PILLARS_TSV="$(
    node -e '
const fs = require("fs");
const path = process.argv[1];
const US = String.fromCharCode(31);
let parsed;
try {
    parsed = JSON.parse(fs.readFileSync(path, "utf8"));
} catch (e) {
    process.stderr.write("audit-pillars: failed to parse patterns JSON: " + e.message + "\n");
    process.exit(2);
}
// v0.2.g AC-6 accept version 1 OR 2 — v2 adds an optional per-pillar
// `skills` metadata array which the count logic ignores (additive change).
if (!parsed || ![1, 2].includes(parsed.version) || !Array.isArray(parsed.pillars)) {
    process.stderr.write("audit-pillars: patterns JSON has wrong schema (need version=1|2 + pillars[])\n");
    process.exit(2);
}
for (const pillar of parsed.pillars) {
    const name = String(pillar.name || "").replace(/\t/g, " ");
    const pats = (Array.isArray(pillar.patterns) ? pillar.patterns : []).join(US);
    const neg = (Array.isArray(pillar.negative_patterns) ? pillar.negative_patterns : []).join(US);
    process.stdout.write(name + "\t" + pats + "\t" + neg + "\n");
}
' "${PATTERNS_FILE}"
)"

if [ -z "${PILLARS_TSV}" ]; then
    echo "audit-pillars: patterns.json contains zero pillars" >&2
    exit 2
fi

# --- Build the haystack once -----------------------------------------------
# Capture commit messages + diff into temp files; cheaper than re-greping per pillar.
CORPUS_DIR="$(mktemp -d -t mmd-audit-XXXXXX)"
trap 'rm -rf "${CORPUS_DIR}"' EXIT
MSGS_FILE="${CORPUS_DIR}/messages.txt"
DIFF_FILE="${CORPUS_DIR}/diff.txt"
git log --format='%H%n%B%n---MMD-COMMIT-SEP---' "${RANGE}" > "${MSGS_FILE}" 2>/dev/null || true
git diff "${RANGE}" > "${DIFF_FILE}" 2>/dev/null || true

# --- Audit each pillar ------------------------------------------------------
echo ""
echo "scripts/audit-pillars.sh — range: ${RANGE}"
echo "  patterns: ${PATTERNS_FILE}"
echo ""
printf '%-12s | %-18s | %-12s | %s\n' "PILLAR" "INVOKED (count)" "LAST_COMMIT" "NOTES"
printf '%s\n' "-------------+--------------------+--------------+----------------------------------------"

ZERO_COUNT=0

while IFS=$'\t' read -r NAME PATS_JOIN NEG_JOIN; do
    [ -z "${NAME}" ] && continue

    # Split joined patterns back into arrays via the US delimiter.
    IFS="${US}" read -r -a PATS <<< "${PATS_JOIN:-}"
    IFS="${US}" read -r -a NEGS <<< "${NEG_JOIN:-}"

    TOTAL=0
    MATCHED_PATTERNS=()
    for p in "${PATS[@]:-}"; do
        [ -z "${p}" ] && continue
        # Sum hits in commit messages and in the diff. -E for extended regex,
        # -i for case-insensitive (so gstack / gStack / GSTACK all match).
        # grep -c always prints a count and exits non-zero on zero matches —
        # we capture stdout without `|| echo 0` (which would duplicate the
        # zero) and tolerate the non-zero exit via the trailing `true`.
        MSG_HIT=$(grep -E -i -c -- "${p}" "${MSGS_FILE}" 2>/dev/null; true)
        DIFF_HIT=$(grep -E -i -c -- "${p}" "${DIFF_FILE}" 2>/dev/null; true)
        MSG_HIT=${MSG_HIT:-0}
        DIFF_HIT=${DIFF_HIT:-0}
        SUB=$((MSG_HIT + DIFF_HIT))
        if [ "${SUB}" -gt 0 ]; then
            TOTAL=$((TOTAL + SUB))
            MATCHED_PATTERNS+=("${p}")
        fi
    done

    # Subtract negative-pattern hits.
    for p in "${NEGS[@]:-}"; do
        [ -z "${p}" ] && continue
        NEG_MSG=$(grep -E -i -c -- "${p}" "${MSGS_FILE}" 2>/dev/null; true)
        NEG_DIFF=$(grep -E -i -c -- "${p}" "${DIFF_FILE}" 2>/dev/null; true)
        NEG_MSG=${NEG_MSG:-0}
        NEG_DIFF=${NEG_DIFF:-0}
        NEG_HIT=$((NEG_MSG + NEG_DIFF))
        TOTAL=$((TOTAL - NEG_HIT))
        if [ "${TOTAL}" -lt 0 ]; then TOTAL=0; fi
    done

    # Resolve the last commit that mentions any matched pattern (best-effort).
    LAST_COMMIT="—"
    if [ "${TOTAL}" -gt 0 ] && [ "${#MATCHED_PATTERNS[@]}" -gt 0 ]; then
        PROBE_PAT="${MATCHED_PATTERNS[0]}"
        # Try diff-content first (-G), then commit-message (--grep).
        LAST_SHA=$(git log --format=%H -G "${PROBE_PAT}" "${RANGE}" 2>/dev/null | head -1 || true)
        if [ -z "${LAST_SHA}" ]; then
            LAST_SHA=$(git log --format=%H --grep "${PROBE_PAT}" "${RANGE}" 2>/dev/null | head -1 || true)
        fi
        if [ -n "${LAST_SHA}" ]; then
            LAST_COMMIT="${LAST_SHA:0:7}"
        fi
    fi

    if [ "${TOTAL}" -gt 0 ]; then
        # Notes column: first three matched patterns separated by " · ".
        NOTES=""
        for ((k=0; k<${#MATCHED_PATTERNS[@]} && k<3; k++)); do
            if [ -z "${NOTES}" ]; then
                NOTES="${MATCHED_PATTERNS[$k]}"
            else
                NOTES="${NOTES} · ${MATCHED_PATTERNS[$k]}"
            fi
        done
        STATUS="INVOKED (${TOTAL})"
    else
        STATUS="NOT INVOKED (0)"
        NOTES="claim drift — see L-012"
        ZERO_COUNT=$((ZERO_COUNT + 1))
    fi

    printf '%-12s | %-18s | %-12s | %s\n' "${NAME}" "${STATUS}" "${LAST_COMMIT}" "${NOTES}"
done <<< "${PILLARS_TSV}"

echo ""

# --- CI gate ---------------------------------------------------------------
if [ "${CI_MODE}" = "true" ] && [ "${ZERO_COUNT}" -gt 0 ]; then
    echo "audit-pillars: --ci enforced and ${ZERO_COUNT} pillar(s) NOT INVOKED in this range — failing with exit 1" >&2
    exit 1
fi

exit 0
