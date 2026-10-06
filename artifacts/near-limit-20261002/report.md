# Near-limit generation performance and validation

Captured 2026-10-02T04:46:57.513Z. These are isolated single observations on v24.19.0, AMD EPYC 9V74 80-Core Processor, linux; not latency guarantees. Full machine-readable results: [benchmark.json](benchmark.json). Exact authored/repeated input sources and their scalar counts/hashes: [workloads.json](workloads.json); benchmark.json records its file SHA-256.

## What changed

- Bounded exact retrieval replaces eager per-query-term result materialization. A query-local cache retains at most 32 terms and 20,000 posting records plus one current term and the output accumulator. Repeated-term scores are added in original order, preserving floating-point results, metadata and stable ties. No query truncation, term-frequency approximation, or change to candidate eligibility.
- Literal extraction for output uses the same protected-value extractor as input, with the existing 12,000-scalar output bound. Input admission remains 5,000 scalars. The previous validator wrongly passed expanded output to the 5,000-scalar input constructor, rejecting otherwise valid 5,002/5,003-scalar candidates.
- BMP source slicing avoids repeated whole-text scalar arrays; astral strings retain scalar slicing. Output-span realization and partition checks count total scalars once. Stage-local grammar scope construction and independent verifier recomputation remain unchanged.

## Engine observations

Generation excludes parser time, imports, assets loading and one five-character warmup. RSS is peak resident memory of the isolated Node engine process, including warmup and its index; Python is not in these figures. 1 MiB = 1,048,576 bytes.

| Workload | Build | Generation seconds | Peak Node RSS MiB | Selected | Result |
|---|---|---:|---:|---:|---|
| synthetic1200 | fixed | 1.877 | 545.54 | 3 | 3 candidates |
| synthetic1200 | baseline | 4.814 | 1677.07 | 3 | 3 candidates |
| synthetic5000 | fixed | 16.311 | 627.23 | 3 | 3 candidates |
| synthetic5000 | baseline | n/a | not captured on abort | n/a | SIGABRT |
| synthetic5000 | baseline-large-heap | 29.722 | 3420.05 | 3 | 3 candidates |
| repeated | fixed | 11.932 | 572.15 | 2 | candidate_shortage |
| repeated | baseline | 24.573 | 2275.43 | 0 | no_valid_candidate |
| prose | fixed | 5.295 | 562.34 | 3 | 3 candidates |
| prose | baseline | 9.032 | 1709.04 | 3 | 3 candidates |

All rows use the default V8 heap except baseline-large-heap, which explicitly uses --max-old-space-size=4096. The default baseline synthetic 5,000 run aborted with V8 heap exhaustion at 23.555s total process wall time. This is not a generation-only time or a completed equivalence measurement. Its enlarged-heap rerun completed and established output equivalence.

Synthetic workloads tile the unchanged real five-character analysis with remapped IDs, dependency heads and spans; their many sentence boundaries are synthetic. “Repeated” is a real GiNZA parse of the full 5,000-character repeated string. “Prose” is a reconstructed 4,928-character authored multi-paragraph factual passage, repeated intact and parsed as-is, including quantities, quotation, incomplete work and completed work. It is not a captured user document or representative-user benchmark.

## Equality and correction

- Synthetic 1,200, synthetic 5,000 and prose: exact complete ordered semantic-result hashes match the frozen baseline, including full pool, selected candidates, plans, spans, checks, IR, evidence, novelty and scores. Build/replay metadata is excluded.
- Real repeated 5,000: full pool language, plans, spans, evidence, novelty and scores match exactly. The only proof changes are the two erroneous V-quantity failures becoming passes. Correcting precisely those baseline checks and recomputing normal selection yields the exact new complete semantic-result hash. Selected count rises from 0 to 2; candidate_shortage remains honest.
- Native MiniSearch differential tests compare all ordered raw results and exact numeric scores across repeats, ties, multiple fields, Unicode, series filters and cache saturation. Unsupported options fail explicitly.

## Production API observations

Fastify injection uses the production Coordinator, real Python parser and Piscina worker, with the default 30,000 ms job deadline. Startup is separate. All returned candidates pass S-bounded-rewrite and S-realization; the internal candidate pool is absent from the public response. These are independent bounded-program proofs, not a fresh parse of the entire generated output and not a broad semantic/fluency guarantee.

| Workload | Coordinator seconds | Startup seconds | Source parse seconds | Independent proof seconds | Selected | Node peak MiB | Python sampled peak MiB | Combined sampled peak MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| repeated (5000) | 17.415 | 2.396 | 4.012 | 0.833 | 2 | 715.47 | 691.14 | 1406.61 |
| prose (4928) | 8.189 | 2.168 | 2.747 | 0.394 | 3 | 632.57 | 656.81 | 1289.38 |

Node RSS includes the API process and its worker thread. Python RSS is sampled every 25 ms from /proc; combined peak is the largest sampled sum, not a sum of independently occurring peaks. V8 reported 2240.00 MiB total heap limit with no explicit Node flags. RSS includes non-heap memory and must not be confused with the V8 heap limit.

## Remaining limits

The 5,000-scalar input cap is admission, not a promise that every input completes within 30 seconds or produces a candidate. Only these two long API shapes were measured once; hardware, grammar complexity, parser frames, output size and candidate count remain relevant. The near-limit API observations still use roughly 1.26–1.37 GiB combined resident memory. Arbitrary long-input performance, parser behavior, naturalness and general semantic equivalence are not established. Existing output/pool/schema limits remain enforced. No validator was weakened to force 3 results.

The retrieval adapter intentionally uses the pinned MiniSearch 7.2.0 private raw-query executor because the public per-term API sorts away native tie order. Version/API/unsupported-option mismatch fails explicitly. A MiniSearch upgrade requires re-running full native-result equality tests and these benchmarks.

## Identity and reproduction

- Baseline commit: c7631aeab30d962ef0ccb55c1e97f289da47e632
- Frozen compiled core SHA-256: e210cd2fc37968da1d4c7dbd13528a61b61fa61f1ec17971590ba0d5ca6038c9
- Shared engine benchmark assets SHA-256: bf91fe4135d4827b644980eb15ff0c6c1de59bdcd9c26fc8b260b1f87b02a09d
- Shared engine dataset ID: 046ec575f1f871f9c4f849a126f7c343927be82ae1485df49790eae136899bdb
- Saved base analysis SHA-256: 338b4e05d748400dffc41cfeca61193e2211f8a065b05316854a9da60deaa866
- API declared build-info sourceHash: d57d9925bb7dfb1da7c8232c81d2b14df889b18134fcff65a4a3ac34093d0ba3
- API dataset ID: fbf590e9bee33f09c6310595e8568d881ab2f4f3984cf82f1c0a7ee9d303aa67
- API assets SHA-256: 463b0ed3428a54f467d59974cf0cf6cd933bfaf6ab868b334755a8795dd075d5

The benchmark snapshots compiled JavaScript. Its compiled-core fingerprint is the authoritative measured-code identity; the API build-info field above is copied metadata, last generated separately by build:engine. A release build must regenerate build metadata/schemas before publishing.

Run from the repository root after npm run build:engine:

```sh
node --test test/v1/bounded-search.test.js test/v1/long-output-validation.test.js test/v1/rewrite-scope-reuse.test.js
node scripts/benchmark-near-limit.js --reference c7631ae --output artifacts/near-limit-20261002/benchmark.json
```

Focused tests passed 9/9. The benchmark passed all final-engine/API outcomes and all expected equality/correction checks. The 4 GiB baseline rerun is explicit comparison evidence; no larger heap is enabled in application runtime. Full temporary analyses and complete result files are retained only in the local benchmark workspace recorded in JSON, avoiding large tracked artifacts.
