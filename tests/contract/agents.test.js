/** Contract: agent docs list every canonical skill/role, and every skill has valid frontmatter. */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const skills = readdirSync(new URL('.agents/skills/', root));
const roles = readdirSync(new URL('.agents/roles/', root)).map((file) => file.replace(/\.md$/, ''));

test('every skill has name/description frontmatter matching its folder', () => {
  for (const skill of skills) {
    const text = read(`.agents/skills/${skill}/SKILL.md`).replace(/\r\n/g, '\n');
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(frontmatter, `${skill}: missing frontmatter`);
    assert.match(frontmatter[1], new RegExp(`^name: ${skill}$`, 'm'), `${skill}: name must match folder`);
    assert.match(frontmatter[1], /^description: .{40,}$/m, `${skill}: description too short to trigger reliably`);
  }
});

test('AGENTS.md links every skill', () => {
  const agents = read('AGENTS.md');
  for (const skill of skills)
    assert.ok(agents.includes(`.agents/skills/${skill}/SKILL.md`), `AGENTS.md misses ${skill}`);
});

test('CLAUDE.md imports AGENTS.md and names every role', () => {
  const claude = read('CLAUDE.md');
  assert.match(claude, /^@AGENTS\.md$/m);
  for (const role of roles) assert.ok(claude.includes(`\`${role}`), `CLAUDE.md misses role ${role}`);
});

test('orchestrator protocol keeps its mandatory checkpoint and worker report fields', () => {
  const orchestrate = read('.agents/skills/orchestrate/SKILL.md');
  assert.match(orchestrate, /Checkpoint \(mandatory\)/);
  assert.match(orchestrate, /Spawn nothing until the user approves/);
  const worker = read('.agents/skills/worker/SKILL.md');
  for (const field of ['STATUS:', 'TASK:', 'BRANCH:', 'CHANGED:', 'TESTS:', 'DECISIONS:', 'BLOCKER/NEXT:']) {
    assert.ok(worker.includes(field), `worker report misses ${field}`);
  }
});
