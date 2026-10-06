# B2 evaluation preparation, before second unseal

The immutable raw recorder remains SHA-256 c9898e8da64580bdac426310e17ccb4877de0e498f75ab3c969784cc42d8afbd. Assets remain SHA-256 3ec6501a86329cf5776d3fc487590c424b112e75d65da749fe7378662c6f7404. The second sealed-input hash was checked without reading its content: b1a2573ef1d94951fb11618d1a7891077464dcf7b7d368e4a7015d93aaa7ea3e, authored 2026-10-06 03:33:20 UTC, 28 cases / 14 pairs. No second-sealed contents or derivatives were read while preparing these scripts.

## Diagnostic audit changes before B2 freeze

- Classifier now compares the actual source/compiled module inventory to each raw capture before and after classification. A stored stableEngine flag alone is insufficient
- Body composition still requires a separately rerun source-bound proof, at least two source roles, and real role movement or source-sentence split/fusion. Direct slot coverage/provenance and changed block text are now explicit prerequisites. Context/marker-only movement cannot satisfy the movement test
- Source-bound-piece inversion, copied-piece inversion, non-context role inversion, and surface sentence split/fusion remain distinct inspectable fields. No measure is a human naturalness/style/humor rating
- All original candidate metadata, output spans, full checks, and replay manifests now survive compaction. Readback checks the exact request metadata and every candidate field in addition to texts, plans, evidence, check records, and display order
- Verifier recomputes role ordering, slot partitions, surface sentence counts/group changes, source/parser provenance, all summary counters, and exact displayed selection. The original B1 package still passes this stricter verifier. Five deliberately corrupted diagnostics/summaries were rejected, as recorded in evaluation-verifier-mutation-tests.json
- Reclassification of B1's first unseen raw capture under the tightened definition retains its same six body-composition pool candidates and four displayed body candidates. It does not change the recorded initial failure to generalize

## Identity caveat retained, not silently patched

The recorder calls generate with its historical frozen assets and no engineVersion override. replayManifest.engineVersion therefore identifies the frozen asset manifest's historical version; it is not the identity of B1 or B2 code. Actual tested code identity is meta.engineHashes + meta.engineHash + meta.buildInfo.sourceHash; archive baselineRevision provides the PR5 provenance. The baseline archive has a historical toolCommit in its stored build-info, so that field alone is not the archive identity either. All these separate identities are retained. Production API replay against freshly rebuilt production assets is a separate integration test.

## Freeze/execution procedure

1. Await the parent's explicit UTC freeze and expected sourceHash after final integration/tests. Do not build the main checkout here
2. Run freeze-v2-engine.cjs to copy every tracked/untracked file except the report artifacts and the complete compiled dist tree into second-frozen-engine, with an exact file/hash manifest. Shared installed Node/Python dependencies are linked; source/compiled files are copied and checked unchanged during copy
3. Capture B2's 175 exposed inputs once against that snapshot and frozen assets. Compare to already captured second-before-regression.json.gz; the classifier must confirm baseline modules still match that capture. Check all errors, proof/slot/provenance failures, displayed checks and null S/Q before unsealing
4. Record the authorized freeze and first unseal start, verify the seal, then derive source/settings input from the 28 sealed cases. Run PR5 and B2 exactly once each on that identical derived input and same assets/settings. No tuning after exposure while calling the same cases unseen
5. Classify, compact, verify, record source/module/asset/input/evaluator hashes, and preserve exact first-run raw captures outside the repo. Ship complete candidate evidence in compact report, the original sealed bytes, a source patch + reproduction instructions, and the first failed package byte-for-byte

Public reruns of either exposed sealed suite are regression/reproduction runs, never a new unseen test. A safe narrow abstention is not broad structural usefulness. Every human S/Q is null.
