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
#   scripts/audit-pillars.sh --with-composer [<base-branch>]
#   scripts/audit-pillars.sh --help
#
# Defaults:
#   <base-branch> = main  (auditing main..HEAD)
#
# Flags:
#   --ci             Exit 1 if any claimed pillar has count==0 (opt-in CI gate).
#                    Without --ci, the script is advisory (always exit 0).
#   --with-composer  Append a "Composer activity" section (SPEC_V02E AC-6):
#                    parses every .mmd/local/*/<*>.composer.json sidecar
#                    and reports total runs, auto-injected runs, average
#                    per run, and the top lessons by injection count.
#   --help, -h       Print this usage and exit 0.
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
WITH_COMPOSER=false
BASE_ARG="main"

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
        --with-composer)
            WITH_COMPOSER=true
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
# Output format: each pillar one line, fields separated by ASCII Record
# Separator (0x1E), with the inner field arrays joined by ASCII Unit
# Separator (0x1F). RS (non-whitespace) is used between fields rather than
# TAB because bash `read` with `IFS=$'\t'` collapses CONSECUTIVE whitespace
# separators into a single delimiter — so a TAB-separated row with an empty
# middle field (e.g. empty negative_patterns) silently merged the trailing
# fields into the empty slot, corrupting downstream array parsing.
US=$(printf '\037')
RS=$(printf '\036')
PILLARS_TSV="$(
    node -e '
const fs = require("fs");
const path = process.argv[1];
const US = String.fromCharCode(31);
const RS = String.fromCharCode(30);
let parsed;
try {
    parsed = JSON.parse(fs.readFileSync(path, "utf8"));
} catch (e) {
    process.stderr.write("audit-pillars: failed to parse patterns JSON: " + e.message + "\n");
    process.exit(2);
}
// v0.2.g AC-6 accept version 1 OR 2 — v2 adds an optional per-pillar
// `skills` metadata array which is now RENDERED (one Notes line per skill).
// Per F6 Phase-4 review: the prior v2 implementation parsed but ignored
// skills metadata, defeating the purpose of the schema bump.
if (!parsed || ![1, 2].includes(parsed.version) || !Array.isArray(parsed.pillars)) {
    process.stderr.write("audit-pillars: patterns JSON has wrong schema (need version=1|2 + pillars[])\n");
    process.exit(2);
}
for (const pillar of parsed.pillars) {
    const name = String(pillar.name || "").replace(/\t/g, " ");
    const pats = (Array.isArray(pillar.patterns) ? pillar.patterns : []).join(US);
    const neg = (Array.isArray(pillar.negative_patterns) ? pillar.negative_patterns : []).join(US);
    // 4th field: skill names (v2 only; empty for v1 or pillars without skills).
    // Each skill is encoded as `<name>::<introduced>` — we only need the name
    // for the per-skill grep, the rest is metadata for the Notes column.
    const skills = Array.isArray(pillar.skills)
        ? pillar.skills.map((s) => String((s && s.name) || "").trim()).filter(Boolean).join(US)
        : "";
    process.stdout.write(name + RS + pats + RS + neg + RS + skills + "\n");
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

while IFS="${RS}" read -r NAME PATS_JOIN NEG_JOIN SKILLS_JOIN; do
    [ -z "${NAME}" ] && continue

    # Split joined patterns back into arrays via the US delimiter.
    IFS="${US}" read -r -a PATS <<< "${PATS_JOIN:-}"
    IFS="${US}" read -r -a NEGS <<< "${NEG_JOIN:-}"
    IFS="${US}" read -r -a SKILLS <<< "${SKILLS_JOIN:-}"

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
        # F6 (Phase-4 review): when v2 skills[] metadata is present, the Notes
        # column lists the per-skill names that actually matched in this range
        # — answers "WHICH gStack skills were invoked?", not just "was the
        # pillar invoked?". Falls back to the v1 behavior (first 3 matched
        # patterns) when skills[] is absent or none of the listed skill names
        # matched the corpus.
        NOTES=""
        INVOKED_SKILLS=()
        if [ "${#SKILLS[@]}" -gt 0 ]; then
            for s in "${SKILLS[@]:-}"; do
                [ -z "${s}" ] && continue
                # Probe: "mmd <s>" OR "/<s>\b" in either corpus file. Same
                # case-insensitive ERE the per-pattern count uses.
                SKILL_HIT_MSG=$(grep -E -i -c -- "(mmd ${s}|/${s}\\b)" "${MSGS_FILE}" 2>/dev/null; true)
                SKILL_HIT_DIFF=$(grep -E -i -c -- "(mmd ${s}|/${s}\\b)" "${DIFF_FILE}" 2>/dev/null; true)
                SKILL_HIT_MSG=${SKILL_HIT_MSG:-0}
                SKILL_HIT_DIFF=${SKILL_HIT_DIFF:-0}
                SKILL_TOTAL=$((SKILL_HIT_MSG + SKILL_HIT_DIFF))
                if [ "${SKILL_TOTAL}" -gt 0 ]; then
                    INVOKED_SKILLS+=("${s} (${SKILL_TOTAL})")
                fi
            done
        fi
        if [ "${#INVOKED_SKILLS[@]}" -gt 0 ]; then
            for ((k=0; k<${#INVOKED_SKILLS[@]}; k++)); do
                if [ -z "${NOTES}" ]; then
                    NOTES="${INVOKED_SKILLS[$k]}"
                else
                    NOTES="${NOTES} · ${INVOKED_SKILLS[$k]}"
                fi
            done
        else
            for ((k=0; k<${#MATCHED_PATTERNS[@]} && k<3; k++)); do
                if [ -z "${NOTES}" ]; then
                    NOTES="${MATCHED_PATTERNS[$k]}"
                else
                    NOTES="${NOTES} · ${MATCHED_PATTERNS[$k]}"
                fi
            done
        fi
        STATUS="INVOKED (${TOTAL})"
    else
        STATUS="NOT INVOKED (0)"
        NOTES="claim drift — see L-012"
        ZERO_COUNT=$((ZERO_COUNT + 1))
    fi

    printf '%-12s | %-18s | %-12s | %s\n' "${NAME}" "${STATUS}" "${LAST_COMMIT}" "${NOTES}"
done <<< "${PILLARS_TSV}"

echo ""

# --- --with-composer section (SPEC_V02E AC-6) ------------------------------
if [ "${WITH_COMPOSER}" = "true" ]; then
    REPO_ROOT_FOR_COMPOSER=$(git rev-parse --show-toplevel 2>/dev/null || true)
    if [ -z "${REPO_ROOT_FOR_COMPOSER}" ]; then
        REPO_ROOT_FOR_COMPOSER="$(pwd)"
    fi
    # Locate the MMD repo containing lib/composer/usage-stats.js. Default to
    # the script's own repo root (works in self-host); fall back to the audit
    # target's root when MMD_LIB_DIR is set (cross-repo install).
    MMD_LIB_DIR_DEFAULT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    LIB_DIR="${MMD_LIB_DIR:-${MMD_LIB_DIR_DEFAULT}}"
    if [ -f "${LIB_DIR}/lib/composer/usage-stats.js" ]; then
        # The MMD package is ESM (type: module). Use the file URL import form
        # so `node -e` can load lib/composer/usage-stats.js without a CommonJS
        # bridge.
        node --input-type=module -e "
import { aggregateComposerUsageSync } from 'file://${LIB_DIR}/lib/composer/usage-stats.js';
const root = process.argv[1];
const stats = aggregateComposerUsageSync(root);
const top = stats.top.slice(0, 5);
const topStr = top.length > 0
    ? top.map((t) => t.id + ' (' + t.count + ')').join(', ')
    : '(none yet)';
const avg = stats.avgInjectedPerRun.toFixed(2);
process.stdout.write('Composer: ' + stats.totalRuns + ' run(s) audited, ' + stats.autoInjectedRuns + ' auto-injected lessons (avg ' + avg + ' per run, top: ' + topStr + ')\n');
" "${REPO_ROOT_FOR_COMPOSER}" 2>/dev/null || echo "Composer: (audit unavailable — see lib/composer/usage-stats.js)"
    else
        echo "Composer: (lib/composer/usage-stats.js not found at ${LIB_DIR} — install-mmd.sh has not run v0.2e?)"
    fi
    echo ""
fi

# --- CI gate ---------------------------------------------------------------
if [ "${CI_MODE}" = "true" ] && [ "${ZERO_COUNT}" -gt 0 ]; then
    echo "audit-pillars: --ci enforced and ${ZERO_COUNT} pillar(s) NOT INVOKED in this range — failing with exit 1" >&2
    exit 1
fi

exit 0
