/**
 * Downloads the public parallel test data for the local MT benchmark and builds
 * .local-mt/eval/data/public.jsonl (git-ignored; nothing here is committed).
 *
 *   FLORES-200 devtest   CC-BY-SA-4.0   multi-way parallel Wikipedia-family sentences (news, travel, junior)
 *   WMT24++              Apache-2.0     en→X paragraphs by domain: literary, news, social, speech
 *   NTREX-128            CC-BY-SA-4.0   en→X news (newstest2019 translated by professionals)
 *
 * Sampling is deterministic (evenly spaced), so every model sees exactly the same items.
 * Usage: node scripts/local-mt/eval-data.mjs [--flores 60] [--wmt-vi 15] [--wmt-other 8] [--ntrex 30]
 */

import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spreadIndices } from './eval-lib.mjs';
import { LOCAL_MT_DIR } from './paths.mjs';

const args = process.argv.slice(2);
const count = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 ? Number(args[index + 1]) : fallback;
};
const FLORES_PER_DIRECTION = count('--flores', 60);
const WMT_VI_PER_DOMAIN = count('--wmt-vi', 15);
const WMT_OTHER_PER_DOMAIN = count('--wmt-other', 8);
const NTREX_COUNT = count('--ntrex', 30);

const DATA_DIR = path.join(LOCAL_MT_DIR, 'eval', 'data');
const RAW_DIR = path.join(DATA_DIR, 'raw');
mkdirSync(RAW_DIR, { recursive: true });

const SOURCES = {
  flores: 'https://dl.fbaipublicfiles.com/nllb/flores200_dataset.tar.gz',
  wmt: (pair) => `https://huggingface.co/datasets/google/wmt24pp/resolve/main/${pair}.jsonl`,
  ntrex: (file) => `https://raw.githubusercontent.com/MicrosoftTranslator/NTREX/main/NTREX-128/${file}`
};

async function download(url, file) {
  if (existsSync(file)) return file;
  const response = await fetch(url, { headers: { 'User-Agent': 'lingoflux-local-mt-eval' } });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${url}`);
  const partial = `${file}.part`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  renameSync(partial, file);
  console.log(`[eval-data] downloaded ${path.basename(file)}`);
  return file;
}

const lines = (file) => readFileSync(file, 'utf8').replace(/\r/g, '').split('\n');

const FLORES_CODES = { en: 'eng_Latn', vi: 'vie_Latn', zh: 'zho_Hans', ja: 'jpn_Jpan', ko: 'kor_Hang' };
const FLORES_DIRECTIONS = [
  ['en', 'vi'],
  ['vi', 'en'],
  ['zh', 'vi'],
  ['ja', 'vi'],
  ['ko', 'vi'],
  ['en', 'zh'],
  ['en', 'ja'],
  ['en', 'ko']
];

async function floresItems() {
  const archive = await download(SOURCES.flores, path.join(RAW_DIR, 'flores200_dataset.tar.gz'));
  const root = path.join(RAW_DIR, 'flores200_dataset');
  if (!existsSync(root)) {
    // Windows ships bsdtar in System32; Git's GNU tar mis-reads drive-letter paths.
    const tar =
      process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    execFileSync(tar, ['-xzf', archive, '-C', RAW_DIR]);
  }
  const text = Object.fromEntries(
    Object.entries(FLORES_CODES).map(([code, name]) => [code, lines(path.join(root, 'devtest', `${name}.devtest`))])
  );
  const meta = lines(path.join(root, 'metadata_devtest.tsv'))
    .slice(1)
    .map((row) => row.split('\t'));
  const total = text.en.filter(Boolean).length;
  const picks = spreadIndices(total, FLORES_PER_DIRECTION);
  const items = [];
  for (const [src, tgt] of FLORES_DIRECTIONS) {
    for (const index of picks) {
      const [, sourceDomain = '', topic = ''] = meta[index] ?? [];
      items.push({
        id: `flores-${src}-${tgt}-${index}`,
        set: 'flores',
        domain: sourceDomain === 'wikinews' ? 'news' : 'general',
        topic,
        src,
        tgt,
        source: text[src][index],
        reference: text[tgt][index]
      });
    }
  }
  return items;
}

const WMT_PAIRS = { vi: 'en-vi_VN', zh: 'en-zh_CN', ja: 'en-ja_JP', ko: 'en-ko_KR' };
const WMT_DOMAINS = { literary: 'literature', news: 'news', social: 'social', speech: 'speech' };

async function wmtItems() {
  const items = [];
  for (const [tgt, pair] of Object.entries(WMT_PAIRS)) {
    const file = await download(SOURCES.wmt(pair), path.join(RAW_DIR, `wmt24pp-${pair}.jsonl`));
    const rows = lines(file)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line))
      .filter((row) => !row.is_bad_source && row.source && row.target);
    const perDomain = tgt === 'vi' ? WMT_VI_PER_DOMAIN : WMT_OTHER_PER_DOMAIN;
    for (const [wmtDomain, domain] of Object.entries(WMT_DOMAINS)) {
      const inDomain = rows.filter((row) => row.domain === wmtDomain);
      for (const index of spreadIndices(inDomain.length, perDomain)) {
        const row = inDomain[index];
        items.push({
          id: `wmt24pp-en-${tgt}-${row.document_id}-${row.segment_id}`.replace(/[^\w.-]+/g, '_'),
          set: 'wmt24pp',
          domain,
          src: 'en',
          tgt,
          source: row.source,
          reference: row.target
        });
      }
    }
  }
  return items;
}

async function ntrexItems() {
  const src = lines(await download(SOURCES.ntrex('newstest2019-src.eng.txt'), path.join(RAW_DIR, 'ntrex-src.eng.txt')));
  const ref = lines(await download(SOURCES.ntrex('newstest2019-ref.vie.txt'), path.join(RAW_DIR, 'ntrex-ref.vie.txt')));
  const total = Math.min(src.filter(Boolean).length, ref.filter(Boolean).length);
  return spreadIndices(total, NTREX_COUNT).map((index) => ({
    id: `ntrex-en-vi-${index}`,
    set: 'ntrex',
    domain: 'news',
    src: 'en',
    tgt: 'vi',
    source: src[index],
    reference: ref[index]
  }));
}

const items = [...(await floresItems()), ...(await wmtItems()), ...(await ntrexItems())].filter(
  (item) => item.source?.trim() && item.reference?.trim()
);
writeFileSync(path.join(DATA_DIR, 'public.jsonl'), items.map((item) => JSON.stringify(item)).join('\n') + '\n');
const bySet = items.reduce((acc, item) => ({ ...acc, [item.set]: (acc[item.set] ?? 0) + 1 }), {});
console.log(`[eval-data] wrote ${items.length} items: ${JSON.stringify(bySet)}`);
