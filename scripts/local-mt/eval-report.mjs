/**
 * Builds the benchmark report from .local-mt/eval/ (runs/<model>/summary.json + outputs.jsonl, scores.json from
 * eval-score.py, and optional manual-grades*.json) into report.json and report.md in the same folder.
 *
 *   node scripts/local-mt/eval-report.mjs            → report.json, report.md
 *   node scripts/local-mt/eval-report.mjs --blind    → blind-sheet.md + blind-key.json for hand grading: dialogue
 *                                                      and literature outputs of every model, shuffled, unlabeled
 *   ... --blind --models a,b --round r2              → blind-sheet-r2.md + blind-key-r2.json for a later round
 *
 * manual-grades*.json map blind ids to { register, speakers, meaning, fluency } scores from 0 to 3; every
 * blind-key*.json and manual-grades*.json in the folder is merged.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EVAL_MODELS, checkRubric, looksLikeTarget, percentile } from './eval-lib.mjs';
import { LOCAL_MT_DIR } from './paths.mjs';

const EVAL_DIR = path.join(LOCAL_MT_DIR, 'eval');
const RUNS_DIR = path.join(EVAL_DIR, 'runs');
const readJson = (file, fallback = null) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback);
const readJsonl = (file) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));

const crafted = JSON.parse(readFileSync(new URL('./eval-items.json', import.meta.url), 'utf8')).items;
const craftedById = new Map(crafted.map((item) => [item.id, item]));
const order = new Map(EVAL_MODELS.map((model, index) => [model.id, index]));
const runIds = existsSync(RUNS_DIR)
  ? readdirSync(RUNS_DIR)
      .filter((id) => existsSync(path.join(RUNS_DIR, id, 'outputs.jsonl')))
      .sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99))
  : [];

/** Deterministic shuffle (mulberry32) so the blind sheet is reproducible. */
function shuffled(values, seed = 20261123) {
  let state = seed;
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const BLIND_DOMAINS = new Set(['dialogue', 'literature']);

/**
 * `--models a,b` limits the sheet to some runs and `--round r2` names a separate sheet (blind-sheet-r2.md,
 * blind-key-r2.json, ids "r2-b001"), so grades from earlier rounds stay valid.
 */
function writeBlindSheet(models = runIds, round = '') {
  const entries = [];
  const prefix = round ? `${round}-` : '';
  const suffix = round ? `-${round}` : '';
  for (const model of models) {
    for (const row of readJsonl(path.join(RUNS_DIR, model, 'outputs.jsonl'))) {
      const item = craftedById.get(row.id);
      if (item && BLIND_DOMAINS.has(item.domain)) entries.push({ model, item, hyp: row.hyp });
    }
  }
  const key = {};
  const lines = ['# Blind grading sheet', '', 'Score each output 0-3 for register, speakers, meaning, fluency.', ''];
  const byItem = new Map();
  for (const entry of entries) {
    if (!byItem.has(entry.item.id)) byItem.set(entry.item.id, []);
    byItem.get(entry.item.id).push(entry);
  }
  let counter = 0;
  for (const [id, group] of byItem) {
    const { item } = group[0];
    lines.push(`## ${id} (${item.src}→${item.tgt})`, '', '```text', item.source, '```', `Notes: ${item.notes}`, '');
    for (const entry of shuffled(group, 20261123 + counter)) {
      const blindId = `${prefix}b${String(++counter).padStart(3, '0')}`;
      key[blindId] = { model: entry.model, id };
      lines.push(`### ${blindId}`, '```text', entry.hyp, '```', '');
    }
  }
  writeFileSync(path.join(EVAL_DIR, `blind-sheet${suffix}.md`), lines.join('\n'));
  writeFileSync(path.join(EVAL_DIR, `blind-key${suffix}.json`), JSON.stringify(key, null, 1) + '\n');
  console.log(`[eval-report] blind sheet: ${counter} outputs from ${models.length} models`);
}

/** Merges every blind-key*.json (or manual-grades*.json) in the eval folder. */
function readMerged(pattern) {
  const merged = {};
  if (!existsSync(EVAL_DIR)) return merged;
  for (const name of readdirSync(EVAL_DIR).filter((file) => pattern.test(file))) {
    Object.assign(merged, readJson(path.join(EVAL_DIR, name), {}));
  }
  return merged;
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function buildReport() {
  const scores = readJson(path.join(EVAL_DIR, 'scores.json'), { groups: [], items: [] });
  const key = readMerged(/^blind-key(-[\w-]+)?\.json$/);
  const grades = readMerged(/^manual-grades(-[\w-]+)?\.json$/);
  const manualByModel = {};
  for (const [blindId, grade] of Object.entries(grades)) {
    const target = key[blindId];
    if (!target) continue;
    (manualByModel[target.model] ??= []).push(grade);
  }

  const models = runIds.map((id) => {
    const summary = readJson(path.join(RUNS_DIR, id, 'summary.json'), {});
    const outputs = readJsonl(path.join(RUNS_DIR, id, 'outputs.jsonl'));
    const group = (kind, groupKey) =>
      scores.groups.find((g) => g.model === id && g.kind === kind && g.key === groupKey);
    const groups = (kind) =>
      Object.fromEntries(
        scores.groups
          .filter((g) => g.model === id && g.kind === kind)
          .map((g) => [g.key, { n: g.n, chrf: g.chrf, spbleu: g.spbleu, comet: g.comet ?? null }])
      );

    let rubricPassed = 0;
    let rubricTotal = 0;
    const rubricByDomain = {};
    const failures = [];
    for (const row of outputs) {
      const item = craftedById.get(row.id);
      if (!item) continue;
      const result = checkRubric(item, row.hyp);
      rubricPassed += result.passed;
      rubricTotal += result.total;
      const domain = (rubricByDomain[item.domain] ??= { passed: 0, total: 0 });
      domain.passed += result.passed;
      domain.total += result.total;
      if (result.failures.length) failures.push({ id: row.id, failures: result.failures });
    }
    const wrongScript = outputs.filter((row) => row.hyp && !looksLikeTarget(row.tgt, row.hyp)).length;
    const empty = outputs.filter((row) => !row.hyp).length;
    const manual = manualByModel[id] ?? [];
    const manualMean = (field) => mean(manual.map((grade) => grade[field]));
    const probe = summary.probe ?? [];

    return {
      id,
      label: summary.label ?? id,
      file: summary.file,
      sizeGB: summary.fileBytes ? summary.fileBytes / 1e9 : null,
      ngl: summary.ngl,
      vramPeakMiB: summary.vramPeakMiB,
      vramBaselineMiB: summary.vramBaselineMiB,
      llamaBench: summary.llamaBench ?? null,
      singleStreamTokPerSecond: mean(probe.map((p) => p.predictedPerSecond)),
      promptTokPerSecond: mean(probe.map((p) => p.promptPerSecond)),
      ttftMs: percentile(
        probe.map((p) => p.ttftMs),
        50
      ),
      longParagraphMs: probe.at(-1)?.totalMs ?? null,
      batch: summary.batch ?? null,
      quality: {
        public: group('overall', 'public') ?? null,
        bySet: groups('set'),
        byDomain: groups('domain'),
        byDirection: groups('direction'),
        bySetDirection: groups('set_direction')
      },
      rubric: {
        passed: rubricPassed,
        total: rubricTotal,
        rate: rubricTotal ? rubricPassed / rubricTotal : null,
        byDomain: rubricByDomain,
        failures
      },
      manual: manual.length
        ? {
            n: manual.length,
            register: manualMean('register'),
            speakers: manualMean('speakers'),
            meaning: manualMean('meaning'),
            fluency: manualMean('fluency'),
            total: mean(manual.map((g) => g.register + g.speakers + g.meaning + g.fluency))
          }
        : null,
      wrongScript,
      empty
    };
  });

  writeFileSync(
    path.join(EVAL_DIR, 'report.json'),
    JSON.stringify({ generated: new Date().toISOString(), models }, null, 1) + '\n'
  );

  const fmt = (value, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits) : '–');
  const md = ['# Local MT benchmark', ''];
  md.push(
    '| Model | VRAM peak (MiB) | tg128 tok/s | 1-stream tok/s | TTFT ms | Batch tok/s | chrF++ | spBLEU | COMET | Rubric | Manual /12 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
  );
  for (const m of models) {
    const q = m.quality.public ?? {};
    md.push(
      `| ${m.label} | ${m.vramPeakMiB ?? '–'} | ${fmt(m.llamaBench?.tg128, 0)} | ${fmt(m.singleStreamTokPerSecond, 0)} | ` +
        `${fmt(m.ttftMs, 0)} | ${fmt(m.batch?.aggregateTokPerSecond, 0)} | ${fmt(q.chrf)} | ${fmt(q.spbleu)} | ` +
        `${fmt(q.comet)} | ${fmt((m.rubric.rate ?? NaN) * 100, 0)}% | ${fmt(m.manual?.total, 2)} |`
    );
  }
  for (const [title, field] of [
    ['COMET by domain', 'byDomain'],
    ['COMET by direction', 'byDirection']
  ]) {
    const keys = [...new Set(models.flatMap((m) => Object.keys(m.quality[field])))].sort();
    md.push('', `## ${title}`, '', `| Model | ${keys.join(' | ')} |`, `| --- | ${keys.map(() => '---').join(' | ')} |`);
    for (const m of models) {
      md.push(
        `| ${m.label} | ${keys.map((k) => fmt(m.quality[field][k]?.comet ?? m.quality[field][k]?.chrf)).join(' | ')} |`
      );
    }
  }
  writeFileSync(path.join(EVAL_DIR, 'report.md'), md.join('\n') + '\n');
  console.log(`[eval-report] ${models.length} models → ${path.join(EVAL_DIR, 'report.md')}`);
}

const cli = process.argv.slice(2);
const option = (flag) => (cli.includes(flag) ? cli[cli.indexOf(flag) + 1] : undefined);
if (cli.includes('--blind')) {
  const only = option('--models')?.split(',');
  writeBlindSheet(only ? runIds.filter((id) => only.includes(id)) : runIds, option('--round') ?? '');
} else buildReport();
