// @unit anchor-presence tests for the /mmdream Claude Code slash-command template
// (v0.7.5). The template at assets/claude-commands/mmdream.md is the TRACKED SOURCE
// that install-mmd.sh materializes into .claude/commands/mmdream.md. These cheap
// guards assert the operational-rule anchors are present so a future edit that
// silently drops one (e.g. removes the MMD_TIMEOUT_MS=0 rule) fails loudly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const TEMPLATE_REL = 'assets/claude-commands/mmdream.md';
const TEMPLATE_ABS = path.join(REPO_ROOT, TEMPLATE_REL);

test('@unit /mmdream template: tracked source exists outside .claude/', () => {
  assert.ok(existsSync(TEMPLATE_ABS), `${TEMPLATE_REL} must exist (tracked source)`);
  // Sanity: it must NOT live under the gitignored .claude/ dir.
  assert.ok(!TEMPLATE_REL.startsWith('.claude/'), 'tracked source must not be under .claude/');
});

test('@unit /mmdream template: has slash-command frontmatter (name + description)', () => {
  const md = readFileSync(TEMPLATE_ABS, 'utf8');
  assert.match(md, /^---\n/);                       // frontmatter opens at byte 0
  assert.match(md, /name:\s*'?mmd'?/);
  assert.match(md, /description:\s*'?.+/);
});

test('@unit /mmdream template: uses the Claude Code argument placeholder', () => {
  const md = readFileSync(TEMPLATE_ABS, 'utf8');
  assert.match(md, /\$ARGUMENTS/, 'must reference $ARGUMENTS so /mmdream <intent> routes the intent');
});

test('@unit /mmdream template: encodes the detached-launch operational rules', () => {
  const md = readFileSync(TEMPLATE_ABS, 'utf8');
  // Detach correctly (L-001: setsid, not nohup).
  assert.match(md, /setsid/, 'must launch detached via setsid');
  // The timeout that keeps a real slice alive (L-016).
  assert.match(md, /MMD_TIMEOUT_MS=0/, 'must set MMD_TIMEOUT_MS=0');
  // Dream length cap for real dreams (L-016).
  assert.match(md, /MMD_DREAM_MAX_LEN=4000/, 'must set MMD_DREAM_MAX_LEN=4000');
  // Human-readable slice label (universal §VII).
  assert.match(md, /--label/, 'must pass a human-readable --label slug');
  // bun + node 20 on PATH.
  assert.match(md, /\.bun\/bin/, 'PATH must include bun');
  assert.match(md, /node\/v20/, 'PATH must include node 20');
});

test('@unit /mmdream template: requires commit-incrementally-per-AC in the dream (L-019)', () => {
  const md = readFileSync(TEMPLATE_ABS, 'utf8');
  assert.match(md, /commit incrementally per AC/i);
  assert.match(md, /L-019/);
});

test('@unit /mmdream template: carries the spec-frozen directive for frozen SPECs', () => {
  const md = readFileSync(TEMPLATE_ABS, 'utf8');
  assert.match(md, /FROZEN/);
  assert.match(md, /Skip Party Mode/i);
  assert.match(md, /directly to implementation/i);
});

test('@unit /mmdream template: monitors via status.json + git commits, not the buffered log (L-002)', () => {
  const md = readFileSync(TEMPLATE_ABS, 'utf8');
  assert.match(md, /status\.json/, 'must monitor via status.json');
  assert.match(md, /git .*log|git log/, 'must monitor via git commits');
  assert.match(md, /L-002/, 'must cite L-002 (no tailing the buffered redirect log)');
  // watcher concept present
  assert.match(md, /watcher/i, 'must set up a per-run watcher');
});

test('@unit /mmdream template: reports honestly + verifies before declaring done', () => {
  const md = readFileSync(TEMPLATE_ABS, 'utf8');
  assert.match(md, /honest/i, 'must require honest reporting (ai-coding §I)');
  assert.match(md, /never claim "done"|never false-claim|not "it works"|NEVER claim/i);
});

test('@unit /mmdream template: on green offers ff-only merge + annotated tag', () => {
  const md = readFileSync(TEMPLATE_ABS, 'utf8');
  assert.match(md, /--ff-only/, 'merge must be fast-forward only');
  assert.match(md, /tag -a/, 'tag must be annotated');
});

test('@unit /mmdream template: documents all three routes (code change / greenfield / bare subcommand)', () => {
  const md = readFileSync(TEMPLATE_ABS, 'utf8');
  assert.match(md, /Route \(a\)/);
  assert.match(md, /Route \(b\)/);
  assert.match(md, /Route \(c\)/);
  // The bare-subcommand route names real subcommands.
  assert.match(md, /discover/);
  assert.match(md, /document-review/);
});
