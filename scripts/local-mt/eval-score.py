"""Quality scores for the local MT benchmark (see docs/LOCAL_MT.md, "Choosing a model").

Reads .local-mt/eval/runs/<model>/outputs.jsonl, the references in .local-mt/eval/data/public.jsonl and
scripts/local-mt/eval-items.json, and writes .local-mt/eval/scores.json with:
  - per item: sentence chrF++ and COMET (wmt22-comet-da)
  - per group (model x set x direction, model x domain, model x target): corpus chrF++, spBLEU (flores200
    tokenizer, which handles zh/ja/ko without word segmentation) and mean COMET

Runs outside the repository's dependencies (nothing is installed into the project):
  uv run --no-project --python 3.12 --with sacrebleu[ko] --with sentencepiece --with unbabel-comet --with "setuptools<81" \
      python -I scripts/local-mt/eval-score.py [--no-comet] [--models a,b]
Set HF_HOME to keep the COMET checkpoint under .local-mt/ (git-ignored).
"""

import argparse
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EVAL_DIR = ROOT / ".local-mt" / "eval"


def load_references():
    refs = {}
    crafted = json.loads((ROOT / "scripts" / "local-mt" / "eval-items.json").read_text(encoding="utf-8"))
    for item in crafted["items"]:
        refs[item["id"]] = {**item, "set": "crafted"}
    public = EVAL_DIR / "data" / "public.jsonl"
    if public.exists():
        for line in public.read_text(encoding="utf-8").splitlines():
            if line.strip():
                item = json.loads(line)
                refs[item["id"]] = item
    return refs


def load_runs(models):
    runs = {}
    for run_dir in sorted((EVAL_DIR / "runs").iterdir()):
        if models and run_dir.name not in models:
            continue
        outputs = run_dir / "outputs.jsonl"
        if outputs.exists():
            runs[run_dir.name] = [json.loads(l) for l in outputs.read_text(encoding="utf-8").splitlines() if l.strip()]
    return runs


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-comet", action="store_true")
    parser.add_argument("--models", default="")
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--gpus", type=int, default=0)
    options = parser.parse_args()

    from sacrebleu.metrics import BLEU, CHRF

    refs = load_references()
    runs = load_runs(set(filter(None, options.models.split(","))))
    if not runs:
        sys.exit("No runs found under .local-mt/eval/runs")

    chrf = CHRF(word_order=2)
    rows = []
    for model, outputs in runs.items():
        for out in outputs:
            ref = refs.get(out["id"])
            if ref is None:
                continue
            hyp = (out.get("hyp") or "").strip()
            rows.append(
                {
                    "model": model,
                    "id": out["id"],
                    "set": ref["set"],
                    "domain": ref.get("domain"),
                    "src": ref["src"],
                    "tgt": ref["tgt"],
                    "source": ref["source"],
                    "reference": ref["reference"],
                    "hyp": hyp,
                    "chrf": chrf.sentence_score(hyp, [ref["reference"]]).score,
                }
            )

    if not options.no_comet:
        from comet import download_model, load_from_checkpoint

        comet = load_from_checkpoint(download_model("Unbabel/wmt22-comet-da"))
        data = [{"src": r["source"], "mt": r["hyp"], "ref": r["reference"]} for r in rows]
        prediction = comet.predict(data, batch_size=options.batch_size, gpus=options.gpus, progress_bar=True)
        for row, score in zip(rows, prediction.scores):
            row["comet"] = float(score) * 100

    groups = defaultdict(list)
    for row in rows:
        direction = f"{row['src']}-{row['tgt']}"
        groups[(row["model"], "set_direction", f"{row['set']}:{direction}")].append(row)
        groups[(row["model"], "domain", row["domain"] or "unknown")].append(row)
        groups[(row["model"], "direction", direction)].append(row)
        groups[(row["model"], "target", row["tgt"])].append(row)
        groups[(row["model"], "set", row["set"])].append(row)
        if row["set"] != "crafted":
            groups[(row["model"], "overall", "public")].append(row)

    summary = []
    for (model, kind, key), members in sorted(groups.items()):
        hyps = [m["hyp"] for m in members]
        references = [[m["reference"] for m in members]]
        entry = {
            "model": model,
            "kind": kind,
            "key": key,
            "n": len(members),
            "chrf": CHRF(word_order=2).corpus_score(hyps, references).score,
            "spbleu": BLEU(tokenize="flores200").corpus_score(hyps, references).score,
        }
        if "comet" in members[0]:
            entry["comet"] = sum(m["comet"] for m in members) / len(members)
        summary.append(entry)

    items = [{k: r[k] for k in ("model", "id", "chrf", "comet") if k in r} for r in rows]
    # Scoring a subset (--models) keeps the earlier scores of every other model.
    previous = EVAL_DIR / "scores.json"
    if previous.exists():
        old = json.loads(previous.read_text(encoding="utf-8"))
        summary = [g for g in old.get("groups", []) if g["model"] not in runs] + summary
        items = [i for i in old.get("items", []) if i["model"] not in runs] + items
    (EVAL_DIR / "scores.json").write_text(
        json.dumps({"groups": summary, "items": items}, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print(f"scored {len(rows)} outputs from {len(runs)} models -> {EVAL_DIR / 'scores.json'}")


if __name__ == "__main__":
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    main()
