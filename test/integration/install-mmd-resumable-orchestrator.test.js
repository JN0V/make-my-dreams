// @integration tests for the install-mmd.sh auto-dev workflow heredoc — the
// stateless / resumable orchestrator instructions (SPEC_V012A AC-2 + AC-3,
// ADR-050).
//
// Strategy mirrors install-mmd-slash-command.test.js: we do NOT run the full
// installer. We extract ONLY the `cat > "$WORKFLOW_FILE" << WORKFLOW_EOF … EOF`
// block that materializes _bmad/adv/workflows/auto-dev/workflow.md, supply the
// handful of path vars it interpolates, run it against a temp $WORKFLOW_FILE,
// and grep the MATERIALIZED workflow.md for the checkpoint-write instructions
// (one per phase) + the resume-aware INITIALIZATION step.
//
// This validates the INSTRUCTION is materialized — NOT the LLM's runtime
// behavior (the testability boundary, §VI: auto-dev's behavior is a prompt we
// cannot unit-test).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const INSTALLER = path.join(REPO_ROOT, 'install-mmd.sh');

/**
 * Materialize the auto-dev workflow.md by extracting + running ONLY the heredoc
 * block from install-mmd.sh. Returns the produced workflow text.
 */
function materializeWorkflow() {
  const src = readFileSync(INSTALLER, 'utf8');
  const startMarker = 'cat > "$WORKFLOW_FILE" << WORKFLOW_EOF';
  const startIdx = src.indexOf(startMarker);
  assert.ok(startIdx >= 0, 'install-mmd.sh: workflow heredoc start not found');
  // The closing delimiter on its own line.
  const endIdx = src.indexOf('\nWORKFLOW_EOF', startIdx);
  assert.ok(endIdx >= 0, 'install-mmd.sh: workflow heredoc end (WORKFLOW_EOF) not found');
  const block = src.slice(startIdx, endIdx + '\nWORKFLOW_EOF'.length);

  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-workflow-mat-'));
  const workflowFile = path.join(dir, 'workflow.md');
  const script = `#!/usr/bin/env bash
set -euo pipefail
WORKFLOW_FILE="${workflowFile}"
QUICK_DEV_PATH="_bmad/bmm/4-implementation/bmad-quick-dev/workflow.md"
ADVERSARIAL_REVIEW_PATH="_bmad/core/bmad-review-adversarial-general/SKILL.md"
CODE_REVIEW_PATH="_bmad/bmm/4-implementation/bmad-code-review/workflow.md"
${block}
`;
  const scriptPath = path.join(dir, 'gen.sh');
  writeFileSync(scriptPath, script);
  chmodSync(scriptPath, 0o755);
  const r = spawnSync('bash', [scriptPath], { encoding: 'utf8', timeout: 15000 });
  assert.equal(r.status, 0, `workflow generation should exit 0; stderr=${r.stderr}`);
  const text = readFileSync(workflowFile, 'utf8');
  rmSync(dir, { recursive: true, force: true });
  return text;
}

// ── AC-2: checkpoint-write instruction materialized for EACH phase ──────────

test('@integration AC-2: materialized workflow checkpoints after EACH phase transition (1-4)', () => {
  const wf = materializeWorkflow();
  // A clear checkpointing contract section.
  assert.match(wf, /## CHECKPOINTING/, 'a checkpointing contract section is present');
  assert.match(wf, /\.mmd\/local\/checkpoint\.json/, 'the checkpoint path is named');
  assert.match(wf, /last_completed_phase/, 'the checkpoint field is named');

  // One handoff-note + checkpoint instruction per phase (1..4).
  for (let n = 1; n <= 4; n++) {
    assert.match(
      wf,
      new RegExp(`\\.mmd/local/handoff/${n}\\.md`),
      `handoff/${n}.md write instruction present (Phase ${n})`,
    );
    assert.match(
      wf,
      new RegExp(`"last_completed_phase":\\s*${n}`),
      `checkpoint last_completed_phase ${n} instruction present (Phase ${n})`,
    );
  }
  // The spec is marked frozen at/after Phase 2.
  assert.match(wf, /"spec_frozen":\s*true/, 'spec_frozen:true appears (Phase 2 onward)');
});

// ── AC-3: resume-aware INITIALIZATION step materialized ─────────────────────

test('@integration AC-3: materialized workflow is resume-aware on init', () => {
  const wf = materializeWorkflow();
  assert.match(wf, /Resume Check/i, 'a resume-check init step exists');
  assert.match(wf, /Resuming from Phase/i, 'it announces a resume');
  assert.match(wf, /last_completed_phase \+ 1/, 'it starts at last_completed_phase + 1');
  assert.match(wf, /\.mmd\/local\/handoff\//, 'it recovers state from the handoff notes');
  assert.match(wf, /branch'?s commits|git log/i, 'it recovers state from the branch commits');
  assert.match(wf, /SKIP the already-completed phases|SKIP the already/i, 'it skips completed phases');
  assert.match(wf, /Never re-open a frozen spec/i, 'it never re-opens a frozen spec');
  // No-checkpoint path is explicitly unchanged (additive).
  assert.match(wf, /FRESH run|no-checkpoint path is UNCHANGED|behaves byte-for-byte/i, 'no checkpoint → fresh path unchanged');
});

// ── v0.13.a AC-3: cooperative auto-handoff boundary-stop-on-request ──────────
// The orchestrator, at each phase boundary AFTER writing the checkpoint, checks
// the handoff-request marker and — if present — announces + exits cleanly
// without starting the next phase (leaving the incomplete checkpoint). This
// validates the INSTRUCTION is materialized (testability boundary, §VI).

test('@integration AC-3: materialized workflow stops cleanly at a phase boundary on a handoff request', () => {
  const wf = materializeWorkflow();
  // The HANDOFF CHECK contract section + the marker path.
  assert.match(wf, /HANDOFF CHECK/i, 'a handoff-check section is present');
  assert.match(wf, /\.mmd\/local\/handoff-request/, 'the handoff-request marker path is named');
  // The core instruction: marker present → announce + exit cleanly without the next phase.
  assert.match(
    wf,
    /handoff-request[\s\S]{0,400}?(PRESENT|present)[\s\S]{0,400}?EXIT CLEANLY/i,
    'marker present → exit cleanly',
  );
  assert.match(wf, /without starting the next phase/i, 'it does not start the next phase');
  assert.match(wf, /INCOMPLETE checkpoint|incomplete checkpoint/i, 'it leaves the incomplete checkpoint');
  // No marker → continue as today (additive; a non-auto-handoff run never sees it).
  assert.match(
    wf,
    /No `?\.mmd\/local\/handoff-request`? marker[\s\S]{0,200}?(CONTINUE|continue)/i,
    'no marker → continue to the next phase',
  );
  assert.match(wf, /never sees this marker|byte-for-byte unchanged/i, 'a non-auto-handoff run is unchanged');
  // It is wired at the non-final phase boundaries (1, 2, 3).
  for (const next of ['Phase 2', 'Phase 3', 'Phase 4']) {
    assert.match(
      wf,
      new RegExp(`HANDOFF CHECK:\\*\\*[\\s\\S]{0,200}?without starting ${next}`, 'i'),
      `the HANDOFF CHECK is wired before starting ${next}`,
    );
  }
});
