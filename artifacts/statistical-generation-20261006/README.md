# Statistical generation experiment, 2026-10-06

## Historical first-stage result

**At this first, repository-only checkpoint, verified human parallel pairs = 0 and the genuine fast_align + Moses + KenLM wiring worked. This was not an audit of all obtainable web sources.** Subsequent source recovery and actual documentary-pair training are reported in [the later documentary trial](../statistical-documentary-20261006/README.md). Human quality judgments remain absent.

This is a separate research branch from stable main `4d918a56`. It does not continue paused semantic-rule expansion, change the production backend, or merge/deploy anything. Earlier draft [PR6](https://github.com/Buront2610/Buront_language_generator/pull/6) is background; its assistant-authored probes and qualitative reviews are not human gold and are not reused as teachers or acceptance labels.

## Evidence in this directory

- `data-audit.json` / `.md`: actual source inventory, exclusions, missing human data, attribution and lineage cautions
- `annotation-selection.json`: metadata for an optional 12-row starter. The full-context blank JSONL is preserved locally and excluded from publication; the exporter can create a new local template
- `dependency-receipt.json`: exact upstream commits/binary hashes and independent official-tool smoke; full upstream source remains in the external cache, not duplicated here
- `mechanical-smoke.json`: programmatic symbol mapping, 14 training rows, 1 dev row, 1 held-out symbol combination
- `mechanical-decode.json`: actual candidate, decoder/KenLM scores and official phrase provenance
- `mechanical-comparison.json`: historical symbol comparison; its baseline used unsupported `invent` mode, so baseline coverage is invalid and superseded. Library wiring itself was independently tested.
- `verification.json`: tests, code/tool/model hashes, resolved wiring failures, and limits

The observed `dx dx → dz dz` is a **nonlinguistic software check**. It demonstrates learned phrase recombination and actual library integration only. It is not a Buront paraphrase, human parallel pair, human quality label, or generalization result. Four additional mechanical inputs checked quantity/quotation/opaque/whitespace copying; 12 real original sentences roundtripped through the actual pinned Sudachi tokenizer without being trained on or assigned quality labels.

## Verification

- Main baseline: npm test **310/310**, typecheck, engine/Web build, asset build and diagnose passed
- Research contracts: **56/56** Python tests passed, including strict CSV import for the companion human workbook
- Official tool bootstrap completed; GCC 14.2.0 + local Boost 1.74 + bzip2 1.0.8 resolved the old Moses build, without upstream source patches
- The checked-in build script was rerun using the compiled cache. A second clean rebuild was not performed
- Native Windows/macOS builds and actual human-data training/quality comparison have not been validated
- A statistical score or an unflagged research candidate never becomes production rule-certified. Every research candidate remains human-review-required or diagnostic-rejected

The separate tool-builder also ran a 64-row symbol fixture through the official tools. Its result is independent integration confirmation, not additional language-quality evidence.

## Optional manual annotation path

The included 12-row batch remains an optional human-annotation workflow, not a prerequisite or a request for the user to create the documentary originals. Subsequent research recovered existing originals and human adaptations, then trained the separate documentary mode without inventing teacher text or human judgments. See the later report for the actual trial. Human quality review is still distinct from source recovery and software verification.

[Runnable commands and exact limits](../../research/statistical_generation/README.md) · [Dependency sources/build notes](../../research/statistical_generation/DEPENDENCIES.md)
