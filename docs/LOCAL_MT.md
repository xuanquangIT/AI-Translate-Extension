# Local GPU translation (Gemma 4 E2B)

Run a small translation-capable model on your own NVIDIA GPU and use it from LingoFlux like any other provider. Page
text never leaves the machine, and there are no rate limits or quotas.

```text
LingoFlux service worker
  │ POST /v1/chat/completions   (the normal translation-only JSON envelope)
  ▼
Bridge  scripts/local-mt/server.mjs   127.0.0.1:37813
  │ one request per segment, up to --parallel at once, with a plain instruction prompt
  ▼
llama-server (llama.cpp, CUDA)        127.0.0.1:37814   all layers and embeddings on the GPU, continuous batching
  └─ Google Gemma 4 E2B instruct, GGUF by Unsloth (Apache-2.0)
```

Why a bridge: a small local model cannot reliably follow the extension's system policy and JSON-only output contract
(`src/translation/prompt.js`, `response.js`). The bridge reads the envelope, translates each segment separately, and
returns the exact JSON the extension expects. Splitting segments into separate requests is also what lets the GPU
batch them. The extension itself is unchanged.

## Setup (Windows x64, NVIDIA)

```sh
npm run local-mt:setup     # downloads into .local-mt/ (git-ignored): llama.cpp CUDA build + gemma-4-E2B-it-Q4_K_M.gguf
npm run local-mt:start     # starts llama-server + bridge; keep this terminal open
npm run local-mt:bench     # optional: measure tok/s on your GPU
```

Downloads come from `ggml-org/llama.cpp` GitHub releases (about 650 MB with the CUDA runtime) and
`unsloth/gemma-4-E2B-it-GGUF` on Hugging Face (Q4_K_M 3.1 GB, Q5_K_M 3.4 GB, Q6_K 4.5 GB). Nothing under `.local-mt/` or
any `*.gguf` file is committed.

Options:

| Script  | Flag                        | Default           | Meaning                                                              |
| ------- | --------------------------- | ----------------- | -------------------------------------------------------------------- |
| `setup` | `--quant`                   | `Q4_K_M`          | Any quantization published in the GGUF repository                    |
| `setup` | `--cuda` / `--cuda-version` | `13` / `13.5`     | CUDA build; RTX 50 (Blackwell, sm_120) needs CUDA 12.8 or newer      |
| `setup` | `--tag`                     | latest            | llama.cpp release tag; falls back to `b12631` if the API is limited  |
| `start` | `--quant`                   | `Q4_K_M`          | Which downloaded model to load                                       |
| `start` | `--parallel`                | `32`              | Server slots = segments translated at once                           |
| `start` | `--ctx`                     | `32768`           | Total KV cache shared by all slots (`--kv-unified`)                  |
| `start` | `--port` / `--llama-port`   | `37813` / `37814` | Bridge / llama-server ports (both bound to 127.0.0.1)                |
| `start` | `--embed-device`            | `CUDA0`           | Device for the embedding tables; `none` keeps them in RAM (non-CUDA) |

## Run it from the system tray (Windows)

```sh
npm run local-mt:shortcut              # desktop shortcut "LingoFlux Local MT" (add --startup to also start with Windows)
npm run local-mt:shortcut -- --remove  # remove the desktop and Startup shortcuts
```

Double-clicking the shortcut runs `scripts/local-mt/tray.ps1` hidden: it starts the stack in the background and puts an
icon in the notification area. The dot on the icon shows the state: green running, amber starting, gray stopped, red
crashed. Right-click for:

- **Start / Stop / Restart** the server (the tray stays; Stop frees the GPU memory)
- **Copy base URL** (`http://127.0.0.1:37813/v1`), **Open log** (`.local-mt/logs/local-mt.log`), **Open setup guide**
- **Quit (stop server)**

Only one tray runs at a time. If a previous tray was killed and left the server running, the icon shows "started
elsewhere" and Stop clears it (it only stops `node` or `llama-server` processes listening on the two ports). The tray
can also be started from a terminal with `npm run local-mt:tray`.

On other systems, install `llama-server` yourself, run `npm run local-mt:setup -- --skip-llama`, and start with
`npm run local-mt:start -- --llama-server /path/to/llama-server --embed-device none`.

## Add it to LingoFlux

Options → add a provider:

- API interface: **OpenAI-compatible**
- Base URL: `http://127.0.0.1:37813/v1`
- API key: any non-empty text (for example `local`); the bridge ignores it
- Model: discovered automatically (`gemma-4-e2b-q4_k_m`). The bridge answers with the loaded model whatever model name
  the request carries, so an existing provider keeps working after the model changes.

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

## Notes

- The bridge binds to 127.0.0.1 and sends no CORS headers, so web pages cannot read its replies; the extension's service
  worker can because of its host permissions. It never logs page text, only counts and timings.
- Each segment is translated on its own, so cross-segment context (consistent terms, pronouns) is not shared.
- Decoding is greedy (`temperature 0`) with thinking switched off. Parallel batching on the GPU can still change the
  wording of a few segments from run to run (10 of 70 in the test above).
- Output budgets count Han, kana, and hangul as 4 tokens per character. A reply cut at the budget is retried once
  with 4× the budget and otherwise fails, so a truncated translation never reaches the page.
- Custom system prompts and style preferences from LingoFlux are not applied; the bridge uses its own fixed prompt
  (`buildMtPrompt` in `scripts/local-mt/lib.mjs`).
