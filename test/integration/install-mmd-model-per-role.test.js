// @integration tests for v0.16.a AC-3 — L2 model-per-role materialization
// (SPEC_V016A, ADR-055). Mirrors install-mmd-resumable-orchestrator.test.js: we
// do NOT run the full installer; we extract ONLY the relevant blocks from
// install-mmd.sh, run them against a temp target, and grep the MATERIALIZED
// output. This validates the named sub-agents + their model frontmatter are
// materialized AND the auto-dev workflow invokes them BY NAME, with the per-phase
// checkpoint/handoff instructions (v0.12-v0.15) preserved.
//
// Testability boundary (§VI): this asserts the FILES are materialized correctly —
// NOT the LLM's runtime model selection (AC-4 is the live proof).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULTS } from '../../lib/conductor/model-policy.js';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const INSTALLER = path.join(REPO_ROOT, 'install-mmd.sh');

// ── Materialize the named sub-agents ────────────────────────────────────────

function materializeAgents() {
  const src = readFileSync(INSTALLER, 'utf8');
  const startMarker = 'AGENTS_DIR="$TARGET/.claude/agents"';
  const endMarker = 'ok "Generated: .claude/agents/mmd-spec.md';
  const startIdx = src.indexOf(startMarker);
  assert.ok(startIdx >= 0, 'install-mmd.sh: agent materialization start not found');
  const endIdx = src.indexOf(endMarker, startIdx);
  assert.ok(endIdx >= 0, 'install-mmd.sh: agent materialization end not found');
  const block = src.slice(startIdx, endIdx);

  const dir = mkdtempSync(path.join(tmpdir(), 'mmd-agents-mat-'));
  const script = `#!/usr/bin/env bash
set -euo pipefail
TARGET="${dir}/target"
mkdir -p "$TARGET"
${block}
`;
  const scriptPath = path.join(dir, 'gen.sh');
  writeFileSync(scriptPath, script);
  chmodSync(scriptPath, 0o755);
  const r = spawnSync('bash', [scriptPath], { encoding: 'utf8', timeout: 15000 });
  assert.equal(r.status, 0, `agent generation should exit 0; stderr=${r.stderr}`);
  return path.join(dir, 'target', '.claude', 'agents');
}

test('@integration AC-3: the three named sub-agents are materialized with their policy model frontmatter', () => {
  const agentsDir = materializeAgents();
  const cases = [
    { file: 'mmd-spec.md', name: 'mmd-spec', model: DEFAULTS.spec },
    { file: 'mmd-impl.md', name: 'mmd-impl', model: DEFAULTS.impl },
    { file: 'mmd-review.md', name: 'mmd-review', model: DEFAULTS.review },
  ];
  for (const c of cases) {
    const p = path.join(agentsDir, c.file);
    assert.ok(existsSync(p), `${c.file} should exist`);
    const text = readFileSync(p, 'utf8');
    // YAML frontmatter: name + model, the model MIRRORING the policy DEFAULTS.
    assert.match(text, new RegExp(`^name:\\s*${c.name}\\s*$`, 'm'), `${c.file}: name frontmatter`);
    assert.match(text, new RegExp(`^model:\\s*${c.model}\\s*$`, 'm'), `${c.file}: model frontmatter = ${c.model}`);
  }
  // The policy defaults the test asserts against are the cost-aware ones.
  assert.equal(DEFAULTS.spec, 'opus');
  assert.equal(DEFAULTS.impl, 'opus');
  assert.equal(DEFAULTS.review, 'sonnet');
});

test('@integration AC-3: every named agent carries the constitution-injection contract + fresh-context discipline', () => {
  const agentsDir = materializeAgents();
  for (const file of ['mmd-spec.md', 'mmd-impl.md', 'mmd-review.md']) {
    const text = readFileSync(path.join(agentsDir, file), 'utf8');
    // The MANDATORY constitution-injection contract is preserved (no contract lost).
    assert.match(text, /Constitution injection \(MANDATORY\)/, `${file}: constitution-injection contract`);
    assert.match(text, /SUPERSEDES all other practices/, `${file}: constitution supremacy`);
    // Fresh-context discipline.
    assert.match(text, /FRESH context with NO memory of prior phases/, `${file}: fresh-context discipline`);
    // Faithful general-purpose behavior.
    assert.match(text, /faithful general-purpose engineering sub-agent/i, `${file}: general-purpose behavior`);
  }
});

// ── Materialize the auto-dev workflow + check the named invocations ──────────

function materializeWorkflow() {
  const src = readFileSync(INSTALLER, 'utf8');
  const startMarker = 'cat > "$WORKFLOW_FILE" << WORKFLOW_EOF';
  const startIdx = src.indexOf(startMarker);
  assert.ok(startIdx >= 0, 'install-mmd.sh: workflow heredoc start not found');
  const endIdx = src.indexOf('\nWORKFLOW_EOF', startIdx);
  assert.ok(endIdx >= 0, 'install-mmd.sh: workflow heredoc end not found');
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
  return readFileSync(workflowFile, 'utf8');
}

test('@integration AC-3: the workflow invokes the named agents by name; no general-purpose phase invocation remains', () => {
  const wf = materializeWorkflow();
  // Each role's subagent_type is the named agent.
  assert.match(wf, /subagent_type`:\s*`"mmd-spec"`/, 'spec phase routed to mmd-spec');
  assert.match(wf, /subagent_type`:\s*`"mmd-impl"`/, 'implementation routed to mmd-impl');
  assert.match(wf, /subagent_type`:\s*`"mmd-review"`/, 'reviewers routed to mmd-review');
  // No remaining general-purpose subagent_type invocation (the spec/impl/review phases).
  assert.ok(
    !/subagent_type`:\s*`"general-purpose"`/.test(wf),
    'no phase should still invoke subagent_type "general-purpose"',
  );
});

test('@integration AC-3: the per-phase checkpoint + handoff instructions (v0.12-v0.15) are preserved', () => {
  const wf = materializeWorkflow();
  // Resumable orchestrator checkpoint (v0.12.a) still present.
  assert.match(wf, /\.mmd\/local\/checkpoint\.json/, 'checkpoint.json instructions preserved');
  assert.match(wf, /last_completed_phase/, 'checkpoint shape preserved');
  // Cooperative auto-handoff (v0.13.a) still present.
  assert.match(wf, /HANDOFF CHECK/, 'handoff-check instructions preserved');
  assert.match(wf, /\.mmd\/local\/handoff-request/, 'handoff-request marker preserved');
  // Fresh-context discipline in the workflow itself.
  assert.match(wf, /fresh,?\s*(isolated\s*)?context/i, 'fresh-context discipline preserved');
});
