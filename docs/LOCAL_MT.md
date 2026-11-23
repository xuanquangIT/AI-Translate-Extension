# Local GPU translation (Gemma 4 E2B, Index-Translate 2B)

Run a small translation-capable model on your own NVIDIA GPU and use it from LingoFlux like any other provider. Page
text never leaves the machine, and there are no rate limits or quotas.

```text
LingoFlux service worker
  │ POST /v1/chat/completions   (the normal translation-only JSON envelope, "model": <id>)
  ▼
Bridge  scripts/local-mt/server.mjs   127.0.0.1:37813   routes by model id; unknown ids go to the first loaded model
  │ one request per segment, up to --parallel at once, with the model's own instruction prompt
  ├─▶ llama-server (llama.cpp, CUDA)  127.0.0.1:37814   gemma: Google Gemma 4 E2B instruct, GGUF by Unsloth
  └─▶ llama-server (llama.cpp, CUDA)  127.0.0.1:37815   index: Index-Translate 2B Q8_0, GGUF by IndexTeam
      all layers on the GPU, continuous batching; only the selected models run (both Apache-2.0)
```

| Selection | Loads                        | Model id(s) in `/v1/models`                     | Best for                                    |
| --------- | ---------------------------- | ----------------------------------------------- | ------------------------------------------- |
| `gemma`   | Gemma 4 E2B (default)        | `gemma-4-e2b-q4_k_m`                            | Fastest; dialogue and Vietnamese address    |
| `index`   | Index-Translate 2B           | `index-translate-2b-q8_0`                       | Documents, news, HTML-heavy pages, en→zh    |
| `all`     | Both, half the slots/KV each | `gemma-4-e2b-q4_k_m`, `index-translate-2b-q8_0` | Picking per provider/model inside LingoFlux |

Measured on an RTX 5060 Laptop 8 GB: `all` uses about 6.0 GB of VRAM (7.2 GB peak with the desktop) and translated a
29K-character page in 22 s on Gemma and 28 s on Index-Translate with both loaded at the same time (15 s and 20 s when
each runs alone). The model catalog is `scripts/local-mt/models.mjs`; the benchmark behind the choice is in
[Choosing a model](#choosing-a-model-benchmark).

Why a bridge: a small local model cannot reliably follow the extension's system policy and JSON-only output contract
(`src/translation/prompt.js`, `response.js`). The bridge reads the envelope, translates each segment separately, and
returns the exact JSON the extension expects. Splitting segments into separate requests is also what lets the GPU
batch them. The extension itself is unchanged.

## Setup (Windows x64, NVIDIA)

```sh
npm run local-mt:setup -- --models all   # downloads into .local-mt/ (git-ignored): llama.cpp CUDA build + both GGUFs
npm run local-mt:start -- --models all   # starts the llama-servers + bridge; keep this terminal open
npm run local-mt:bench                   # optional: measure tok/s on your GPU
```

Downloads come from `ggml-org/llama.cpp` GitHub releases (about 650 MB with the CUDA runtime),
`unsloth/gemma-4-E2B-it-GGUF` (Q4_K_M 3.1 GB, Q5_K_M 3.4 GB, Q6_K 4.5 GB) and `IndexTeam/Index-Translate-2B-GGUF`
(Q8_0 2.1 GB) on Hugging Face. Nothing under `.local-mt/` or any `*.gguf` file is committed.

Options:

| Script          | Flag                        | Default           | Meaning                                                                                          |
| --------------- | --------------------------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| `setup`/`start` | `--models`                  | saved, else gemma | `gemma`, `index`, `all`, or a list (`gemma,index`); saved in `.local-mt/config.json` by the tray |
| `setup`/`start` | `--quant`                   | `Q4_K_M`          | Gemma quantization (Index-Translate is always Q8_0)                                              |
| `setup`         | `--cuda` / `--cuda-version` | `13` / `13.5`     | CUDA build; RTX 50 (Blackwell, sm_120) needs CUDA 12.8 or newer                                  |
| `setup`         | `--tag`                     | latest            | llama.cpp release tag; falls back to `b12631` if the API is limited                              |
| `start`         | `--parallel`                | `32`              | Server slots in total; split evenly between loaded models                                        |
| `start`         | `--ctx`                     | `32768`           | Total KV cache, split evenly between loaded models (`--kv-unified` per server)                   |
| `start`         | `--port` / `--llama-port`   | `37813` / `37814` | Bridge port / first llama-server port (Index-Translate uses the next one)                        |
| `start`         | `--embed-device`            | `CUDA0`           | Device for Gemma's embedding tables; `none` keeps them in RAM (non-CUDA)                         |

## Run it from the system tray (Windows)

```sh
npm run local-mt:shortcut              # desktop shortcut "LingoFlux Local MT" (add --startup to also start with Windows)
npm run local-mt:shortcut -- --remove  # remove the desktop and Startup shortcuts
```

Double-clicking the shortcut runs `scripts/local-mt/tray.ps1` hidden: it starts the stack in the background and puts an
icon in the notification area. The dot on the icon shows the state: green running, amber starting, gray stopped, red
crashed. Right-click for:

- **Start / Stop / Restart** the server (the tray stays; Stop frees the GPU memory)
- **Model**: Gemma 4 E2B, Index-Translate 2B, or Both models (load all). The choice is saved in
  `.local-mt/config.json` (also used by `local-mt:start` without `--models`); a running server restarts with it. A model
  that is not downloaded yet shows "Model not downloaded" with the `local-mt:setup` command to run.
- **Copy base URL** (`http://127.0.0.1:37813/v1`), **Open log** (`.local-mt/logs/local-mt.log`), **Open setup guide**
- **Quit (stop server)**

Only one tray runs at a time. If a previous tray was killed and left the server running, the icon shows "started
elsewhere" and Stop clears it (it only stops `node` or `llama-server` processes listening on ports 37813-37815). The
tray can also be started from a terminal with `npm run local-mt:tray` (`-Models all` overrides the saved choice).

On other systems, install `llama-server` yourself, run `npm run local-mt:setup -- --skip-llama`, and start with
`npm run local-mt:start -- --llama-server /path/to/llama-server --embed-device none`.

## Add it to LingoFlux

Options → add a provider:

- API interface: **OpenAI-compatible**
- Base URL: `http://127.0.0.1:37813/v1`
- API key: any non-empty text (for example `local`); the bridge ignores it
- Model: discovered automatically from `/v1/models` (`gemma-4-e2b-q4_k_m` and/or `index-translate-2b-q8_0`, whatever
  is loaded). With both loaded, pick either one in LingoFlux; a request for a model that is not loaded (or an old
  model name) goes to the first loaded model, so an existing provider keeps working after the tray switches models.

## Why Gemma 4 E2B

Five local models were compared on 70 segments into Vietnamese (news, UI strings, docs with code and URLs, slang,
idioms, numbers and dates, names, medical and legal text, long paragraphs, poetry; sources in English, Chinese,
Japanese, and Korean). Each segment had a checklist of facts a correct translation must keep (for example 周三 is
Wednesday, 1000亿 is 100 billion). Translations were graded blind, in shuffled order, for accuracy and fluency (0-10)
and for major errors that would mislead a reader.

| Model (Q4_K_M)        | Accuracy | Fluency | Major errors | 350-segment page, 32 slots | VRAM   |
| --------------------- | -------- | ------- | ------------ | -------------------------- | ------ |
| Hy-MT2-1.8B (Tencent) | 7.73     | 7.44    | 11 / 70      | 11.6 s                     | 3.3 GB |
| **Gemma 4 E2B**       | **8.94** | 8.29    | **4 / 70**   | 13.3 s                     | 2.1 GB |
| Gemma 4 E4B           | 9.19     | 8.73    | 4 / 70       | 21.7 s                     | 4.3 GB |

Hy-MT2-1.8B reversed the meaning twice ("missed estimates" as "beat estimates", data "leaving the device" as "stored on
the device"). Gemma 4 E2B writes fewer tokens for the same Vietnamese text, so it keeps pace with the 1.8B model in
wall time. Gemma 4 E4B is a little better but almost twice as slow. TranslateGemma 4B, Qwen3.5 4B, and Hy-MT2-7B were
also tried: slower and not more accurate (all three made day-of-week or name errors).

None of them is reliable for classical poetry or unusual proper names (all misread the mountain in 日照香炉). Use a
large cloud model for literary text and keep the local model for translating whole pages quickly.

## Measured (RTX 5060 Laptop 8 GB, Gemma 4 E2B Q4_K_M, `--parallel 32`, llama.cpp b12631)

| Test                                                        | Result                                   |
| ----------------------------------------------------------- | ---------------------------------------- |
| 1 stream                                                    | 100 tok/s, about 280 ms per sentence     |
| 32 parallel streams                                         | **769 tok/s** total                      |
| One page batch through the bridge (28 segments, 2.5K chars) | **0.94 s**                               |
| Whole page, 12 batches, 2 in flight like the content script | 29.8K chars in **11.6 s** (2.6K chars/s) |
| VRAM for the whole stack                                    | about 3.8 GB                             |
| llama-server RAM (working set)                              | about 0.65 GB idle, 1.2 GB after load    |

Host RAM stays small because every layer is offloaded (`-ngl 99`), the GGUF is not memory-mapped
(`--load-mode none`), and the embedding tables are moved to the GPU (`--override-tensor token_embd=CUDA0`). Without
the override, llama.cpp keeps Gemma 4's token and per-layer embeddings (about 1.7 GB) in host RAM and the working set
is about 2.4 GB. The host prompt cache is also off (`--cache-ram 0`): it keeps the KV state of past requests in RAM,
up to 8 GB by default, and grew the working set by about 0.8 GB in one benchmark run. The remaining growth after the
first load (about 0.5 GB) is CUDA runtime memory and stays flat afterwards.

Ports `37813` / `37814` are deliberately uncommon (and below the Windows ephemeral range) to avoid clashing with dev
servers. The defaults live in `scripts/local-mt/paths.mjs`; `tray.ps1` repeats them and a unit test keeps both in sync.

## Choosing a model (benchmark)

`scripts/local-mt/eval*.mjs` compare candidate GGUF models on the same items with the same llama.cpp build. Nothing
they download or write leaves `.local-mt/eval/` (git-ignored).

```sh
npm run local-mt:eval-data                       # FLORES-200, WMT24++, NTREX-128 samples → .local-mt/eval/data/public.jsonl
npm run local-mt:eval -- --model hymt2-7b        # llama-bench + llama-server run of one model (stop local-mt:start first)
uv run --no-project --python 3.12 --with "sacrebleu[ko]" --with sentencepiece --with unbabel-comet --with "setuptools<81" \
  python -I scripts/local-mt/eval-score.py       # chrF++, spBLEU, COMET (wmt22-comet-da) → .local-mt/eval/scores.json
npm run local-mt:eval-report -- --blind          # shuffled, unlabeled dialogue outputs for hand grading
npm run local-mt:eval-report                     # report.json + report.md
```

- Models, their files, and their prompt formats are listed in `EVAL_MODELS` (`scripts/local-mt/eval-lib.mjs`). Each
  translation model is prompted the way its model card asks (Hy-MT2, MiLMMT-46, Seed-X); general instruction models
  get the bridge prompt (`buildMtPrompt`). Decoding is greedy.
- `scripts/local-mt/eval-items.json` holds 46 hand-written items (multi-speaker dialogue with Vietnamese forms of
  address, literature, slang and idioms, markup and placeholders, IT, legal, medical) in en/vi/zh/ja/ko. Each item
  has `require`/`forbid` patterns; the unit test checks that every reference passes its own rubric.
- Public test data is downloaded, sampled deterministically, and never committed: FLORES-200 devtest (CC-BY-SA-4.0),
  WMT24++ (Apache-2.0), NTREX-128 (CC-BY-SA-4.0).
- Set `HF_HOME=.local-mt/eval/hf` before scoring to keep the COMET checkpoint (2.3 GB) inside `.local-mt/`.

Results on the RTX 5060 Laptop 8 GB (2026-11-23, 712 items, 8 parallel streams). Speed is source characters per
second, because tokenizers split Vietnamese very differently (Hy-MT2 7B emits 48.5K tokens where Gemma needs 28K).
Dialogue is a blind hand grade of 16 multi-speaker items (forms of address, who speaks to whom, meaning, fluency).

| Model (GGUF)                     | VRAM added | chars/s | COMET | chrF++ | Rubric | Dialogue /12 |
| -------------------------------- | ---------- | ------- | ----- | ------ | ------ | ------------ |
| Gemma 4 E2B Q4_K_M               | 3.5 GB     | 1600    | 86.5  | 48.6   | 94%    | 11.19        |
| Hy-MT2 1.8B Q8_0                 | 4.1 GB     | 1596    | 87.9  | 46.3   | 84%    | 8.88         |
| MiLMMT-46 4B Q4_K_M              | 4.2 GB     | 1204    | 88.5  | 49.2   | 92%    | 8.88         |
| Gemma 4 E4B Q4_K_M               | 5.8 GB     | 951     | 87.6  | 49.9   | 95%    | 11.44        |
| Hy-MT2 7B Q4_K_M (\*)            | 5.8 GB     | 529     | 88.7  | 48.5   | 93%    | 10.44        |
| Qwen3.5 9B Q4_K_M (\*)           | 5.8 GB     | 537     | 87.6  | 48.6   | 93%    | 9.44         |
| Index-Translate 2B Q8_0          | 2.7 GB     | 1232    | 87.9  | 49.1   | 93%    | 10.19        |
| PLaMo 3 Translate 2B Q4_K_M (\*) | 2.3 GB     | 1264    | 88.2  | 49.0   | 94%    | 9.06         |
| LMT-60 4B Q4_K_M (\*)            | 3.9 GB     | 1168    | 87.1  | 49.1   | 74%    | 3.25         |
| EraX-Translator 4B Q4_K_M        | 4.3 GB     | 281     | 78.4  | 29.3   | 70%    | 5.25         |

(\*) 16K context with a q8_0 KV cache; with 32K f16 a 7B model spills past 8 GB. Gemma 4 E2B stays the default (best
speed, second-best dialogue); Gemma 4 E4B is the quality option. Index-Translate 2B (Apache-2.0) is the best of the
translation-only models: higher COMET than Gemma 4 E2B in every X→vi direction and much better at keeping HTML, but
23% slower and weaker on Vietnamese forms of address. PLaMo 3 Translate 2B scores well but is free only for
non-commercial use. LMT-60 translates only the first line of multi-line input. The EraX-Translator GGUF never emits
its end-of-turn token (it writes a literal `<|im_end|>`; 64 of 712 items still loop to the token limit). 12B models
(Gemma 4 12B, MiLMMT-46 12B) do not fit in 8 GB and ran at about 16 tok/s; the community Seed-X-PPO 7B GGUF is
broken (its `<vi>` tag splits into three tokens and output degenerates).

## Notes

- The bridge binds to 127.0.0.1 and sends no CORS headers, so web pages cannot read its replies; the extension's service
  worker can because of its host permissions. It never logs page text, only counts and timings.
- Each segment is translated on its own, so cross-segment context (consistent terms, pronouns) is not shared.
- Decoding is greedy (`temperature 0`) with thinking switched off. Parallel batching on the GPU can still change the
  wording of a few segments from run to run (10 of 70 in the test above).
- Output budgets count Han, kana, and hangul as 4 tokens per character. A reply cut at the budget is retried once
  with 4× the budget and otherwise fails, so a truncated translation never reaches the page.
- Custom system prompts and style preferences from LingoFlux are not applied; the bridge uses each model's own fixed
  prompt (`buildMtPrompt` in `scripts/local-mt/lib.mjs` for Gemma, `buildIndexTranslatePrompt` in
  `scripts/local-mt/models.mjs` for Index-Translate).
