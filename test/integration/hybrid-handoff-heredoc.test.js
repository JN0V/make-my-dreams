// @integration test for v0.14.b AC-4 (SPEC_V014B, ADR-053): the HYBRID
// auto-handoff KEEPS the cooperative incitation in install-mmd.sh's auto-dev
// heredoc. The enforce backstop is purely MMD-side (lib/invoke-autodev.js abort
// seam + bin/mmd.js loop) — so the materialized workflow MUST still contain the
// per-phase checkpoint write, the marker-check cooperative "exit cleanly"
// instruction, AND the resume-aware init (Path A). This guards against a
// regression that wrongly deletes the incitation (the earlier forced-only draft
// proposed exactly that — see ADR-053).
//
// Mirrors install-mmd-resumable-orchestrator.test.js: extract + run ONLY the
// workflow heredoc block, then grep the materialized workflow.md. This validates
// the INSTRUCTION is materialized, not the LLM's runtime behavior (the §VI
// testability boundary — auto-dev's behavior is a prompt we cannot unit-test).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const INSTALLER = path.join(REPO_ROOT, 'install-mmd.sh');

function materializeWorkflow() {
  const src = readFileSync(INSTALLER, 'utf8');
  const startMarker = 'cat > "$WORKFLOW_FILE" << WORKFLOW_EOF';
  const startIdx = src.indexOf(startMarker);
  assert.ok(startIdx >= 0, 'install-mmd.sh: workflow heredoc start not found');
  const endIdx = src.indexOf('\nWORKFLOW_EOF', startIdx);
  assert.ok(endIdx >= 0, 'install-mmd.sh: workflow heredoc end (WORKFLOW_EOF) not found');
  const block = src.slice(startIdx, endIdx + '\nWORKFLOW_EOF'.length);

  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-hybrid-wf-'));
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

// ── AC-4: all three cooperative pieces are RETAINED in one materialized workflow

test('@integration AC-4: the heredoc KEEPS checkpoint + cooperative incitation + resume init (enforce is MMD-side)', () => {
  const wf = materializeWorkflow();

  // (1) Per-phase checkpoint write — retained.
  assert.match(wf, /## CHECKPOINTING/, 'checkpointing contract retained');
  assert.match(wf, /\.mmd\/local\/checkpoint\.json/, 'checkpoint path retained');
  for (let n = 1; n <= 4; n++) {
    assert.match(wf, new RegExp(`"last_completed_phase":\\s*${n}`), `phase ${n} checkpoint retained`);
  }

  // (2) Cooperative incitation — the marker-check "exit cleanly" instruction —
  // retained (NOT deleted in favor of a forced-only flow).
  assert.match(wf, /HANDOFF CHECK/i, 'the cooperative HANDOFF CHECK is retained');
  assert.match(wf, /\.mmd\/local\/handoff-request/, 'the handoff-request marker path is retained');
  assert.match(wf, /EXIT CLEANLY/i, 'the cooperative clean-exit instruction is retained');
  assert.match(wf, /without starting the next phase/i, 'it still asks to stop before the next phase');

  // (3) Resume-aware init — retained.
  assert.match(wf, /Resume Check/i, 'the resume-aware init is retained');
  assert.match(wf, /last_completed_phase \+ 1/, 'it still resumes from the next phase');
  assert.match(wf, /Never re-open a frozen spec/i, 'it still never re-opens a frozen spec');

  // The enforce backstop is MMD-side: the heredoc must NOT instruct the
  // orchestrator to kill or force-terminate itself (that is invokeAutodev's job).
  assert.ok(
    !/SIGTERM|SIGKILL|force-terminate yourself|kill your own process/i.test(wf),
    'the heredoc never asks the orchestrator to self-terminate — enforce is purely MMD-side',
  );
});
