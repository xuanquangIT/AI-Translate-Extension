#!/usr/bin/env node
/**
 * Generates Claude Code mirrors from the canonical, tool-neutral agent config.
 *
 *   .agents/skills/<name>/**   ──copy──▶  .claude/skills/<name>/**
 *   .agents/roles/<role>.md    ──map───▶  .claude/agents/<role>[-<variant>].md   (tier → Claude model)
 *
 * `.agents/` is read natively by Codex and Antigravity. `.claude/skills` and `.claude/agents` are owned by this
 * script: files there that have no source are removed. Usage:
 *
 *   node scripts/sync-agent-config.mjs           # write mirrors
 *   node scripts/sync-agent-config.mjs --check   # exit 1 if mirrors drift from sources (CI)
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_SKILLS = join(root, '.agents', 'skills');
const SOURCE_ROLES = join(root, '.agents', 'roles');
const TARGET_SKILLS = join(root, '.claude', 'skills');
const TARGET_AGENTS = join(root, '.claude', 'agents');

/** Task tier → Claude model alias. Keep in sync with docs/AGENT_WORKFLOW.md → Tiers. */
const TIER_MODELS = Object.freeze({ light: 'haiku', standard: 'sonnet', heavy: 'opus' });

const check = process.argv.includes('--check');
const problems = [];

const toPosix = (path) => path.split(sep).join('/');
const normalizeEol = (text) => text.replace(/\r\n/g, '\n');

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Minimal frontmatter parser: `key: value` lines between leading `---` fences. */
function parseFrontmatter(text, file) {
  const match = normalizeEol(text).match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error(`${file}: missing frontmatter`);
  const data = {};
  for (const line of match[1].split('\n')) {
    if (!line.trim()) continue;
    const separator = line.indexOf(': ');
    if (separator < 1) throw new Error(`${file}: invalid frontmatter line "${line}"`);
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 2).trim();
    if (value.includes(': ')) throw new Error(`${file}: "${key}" contains ": " which breaks plain YAML; rephrase`);
    data[key] = value;
  }
  return { data, body: match[2] };
}

function generatedNote(source) {
  return `<!-- GENERATED from ${source} by scripts/sync-agent-config.mjs. Edit the source, then run npm run sync:agents. -->`;
}

function renderSkillFile(sourcePath) {
  const text = normalizeEol(readFileSync(sourcePath, 'utf8'));
  if (!sourcePath.endsWith('SKILL.md')) return text;
  const name = toPosix(relative(SOURCE_SKILLS, dirname(sourcePath)));
  const { data, body } = parseFrontmatter(text, sourcePath);
  if (data.name !== name)
    problems.push(`${toPosix(relative(root, sourcePath))}: name "${data.name}" must be "${name}"`);
  if (!data.description) problems.push(`${toPosix(relative(root, sourcePath))}: description is required`);
  const frontmatter = text.slice(0, text.length - body.length);
  return `${frontmatter}\n${generatedNote(toPosix(relative(root, sourcePath)))}\n${body.startsWith('\n') ? '' : '\n'}${body}`;
}

function renderAgent({ name, description, tools, model, tier, source, body }) {
  const lines = ['---', `name: ${name}`, `description: ${description}`];
  if (tools) lines.push(`tools: ${tools}`);
  lines.push(`model: ${model}`, '---', '', generatedNote(source), '');
  if (tier) lines.push(`Tier: **${tier}**.`, '');
  return `${lines.join('\n')}\n${body.replace(/^\n+/, '')}`;
}

function expectedFiles() {
  const expected = new Map();

  for (const sourcePath of walk(SOURCE_SKILLS)) {
    const target = join(TARGET_SKILLS, relative(SOURCE_SKILLS, sourcePath));
    expected.set(target, renderSkillFile(sourcePath));
  }

  for (const sourcePath of walk(SOURCE_ROLES).filter((path) => path.endsWith('.md'))) {
    const source = toPosix(relative(root, sourcePath));
    const { data, body } = parseFrontmatter(readFileSync(sourcePath, 'utf8'), source);
    if (!data.name || !data.description) {
      problems.push(`${source}: name and description are required`);
      continue;
    }
    const variants = data.variants ? data.variants.split(',').map((item) => item.trim()) : [null];
    for (const variant of variants) {
      const tier = variant || data.tier;
      const model = TIER_MODELS[tier];
      if (!model) {
        problems.push(`${source}: unknown tier "${tier}" (expected ${Object.keys(TIER_MODELS).join(', ')})`);
        continue;
      }
      const name = variant ? `${data.name}-${variant}` : data.name;
      const description = variant ? `${tier}-tier ${data.name}. ${data.description}` : data.description;
      expected.set(
        join(TARGET_AGENTS, `${name}.md`),
        renderAgent({ name, description, tools: data.tools, model, tier: variant, source, body })
      );
    }
  }
  return expected;
}

const expected = expectedFiles();
if (problems.length) {
  // Invalid sources: report them and touch nothing, so a typo never deletes a valid mirror.
  console.error(problems.map((problem) => `✖ ${problem}`).join('\n'));
  process.exit(1);
}
const existing = [...walk(TARGET_SKILLS), ...walk(TARGET_AGENTS)];

for (const [target, content] of expected) {
  const current = existsSync(target) ? normalizeEol(readFileSync(target, 'utf8')) : null;
  if (current === content) continue;
  if (check) {
    problems.push(`${toPosix(relative(root, target))}: ${current === null ? 'missing' : 'out of date'}`);
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    console.log(`wrote ${toPosix(relative(root, target))}`);
  }
}

for (const path of existing.filter((path) => !expected.has(path))) {
  if (check) problems.push(`${toPosix(relative(root, path))}: has no source in .agents/`);
  else {
    rmSync(path);
    console.log(`removed ${toPosix(relative(root, path))}`);
  }
}

if (problems.length) {
  console.error(problems.map((problem) => `✖ ${problem}`).join('\n'));
  if (check) console.error('Run `npm run sync:agents` and commit the result.');
  process.exit(1);
}
console.log(
  `Agent config ${check ? 'in sync' : 'synced'}: ${expected.size} files (.agents/ → .claude/skills, .claude/agents).`
);
