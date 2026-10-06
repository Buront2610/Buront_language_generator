# Structural generation B evaluation protocol

## Frozen inputs and provenance

- Baseline: git archive `a25c40a82c80dd9f8209aecf21b669ede8d5619a`, built independently in `pr5-baseline`
- Frozen assets SHA-256: `3ec6501a86329cf5776d3fc487590c424b112e75d65da749fe7378662c6f7404`
- Raw recorder SHA-256: `c9898e8da64580bdac426310e17ccb4877de0e498f75ab3c969784cc42d8afbd`
- 18 exposed work/day-to-day cases, authored separately, are available during implementation
- 127 prior inputs, including every prior so-called holdout, are now regressions
- 30 new sealed inputs were authored before reading the implementation or baseline evaluator. Their exact texts remain withheld from the implementer until core freeze. The seal and distinctness report are recorded separately
- Settings: task=rewrite, faithful, blend, intensities=2/3, series=all, structured backend, fixed seed=structural-body-eval-20261006
- Actual GiNZA 5.2.1 / ja-ginza 5.2.0, spaCy 3.8.16, SudachiPy 0.6.11, SudachiDict-core 20260723

The unseen set is a small synthetic prospective generalization check, not a random natural-language sample. Its authored semantic premises and forbidden readings are review aids, not human S/Q annotations. Every human quality/style rating remains null.

## Raw evidence

For every source and intensity, retain original parser output and hash, source IR, every preselection candidate, exact candidate text, full plan and source/evidence provenance, all check outcomes, before/after verification status, exact displayed order, fallback/shortfall, and full replay manifest. Capture elapsed time for transparency, not as a controlled benchmark. Source and compiled-module hashes are checked unchanged through each run.

The capture script is schema-agnostic and frozen before implementation. Diagnostic postprocessing is separate. Its final source and hash must be saved with the report, and run identically on both captured engines. Comparisons require the same source/input hash, assets, settings, parser identity and original analysis hashes.

## Structural classification requirements

Never equate the STRUCTURAL operator, an appended phrase, candidate-count growth, or a changed rank with improved human quality.

Distinguish preservation/layout-only, ending-only, lexical-only, fixed-phrase construction, and independently revalidated source-body composition. Record source-clause movement and grammatical split/fusion separately. A body-composition count requires inspectable source pieces spanning the necessary relation roles, actual relation-driven reorganization, original-source provenance, and a passing independently rerun bounded-program validator. Validator reuse is an implementation-proof check, not an independent linguistic oracle.

Keep quantity, quote, condition, negation, actor/recipient, and duplicate-premise cases visible even when no structural candidate is generated. A conservative abstention is distinct from success at broad structural generation. Report numerator and denominator for each family and paraphrase pair, all pool candidates versus displayed candidates, and missing or rejected structural coverage.

## Freeze / unseal

Only unseal after the implementer confirms a core freeze with an immutable engine snapshot/hash. Run each sealed case against both frozen engines with unchanged settings/assets. Do not feed sealed failures into tuning while continuing to call the same cases unseen. If the result reveals a safety blocker requiring a repair, preserve the original first result and label subsequent runs regressions; obtain a genuinely new sealed set for any new unseen claim.
