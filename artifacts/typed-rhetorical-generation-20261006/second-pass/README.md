# B2 structural-generation evaluation: preserved failure

The second frozen B implementation did not establish broad structural usefulness. Its 175 already-known inputs show more coverage, but only 3 of 18 fresh ordinary inputs produced source-body composition, only 2 of 18 displayed it, and none of the nine ordinary paraphrase pairs had both variants covered. Modesty and source-explicit requests for evidential records/reports each had zero of six structural cases. Clean program checks are not a substitute for generalization or style.

This is a finite source-bound program audit and a small synthetic prospective check, not a random natural-language sample or human naturalness/style/humor evaluation. S/Q stays null. The 28 cases were first exposed only after this core freeze; all 203 known and newly exposed inputs are now regressions for any later implementation. Do not tune on these cases and continue to label them unseen.

## Exact identity and chronology

- PR5 baseline: `a25c40a82c80dd9f8209aecf21b669ede8d5619a`; its independently rebuilt 129 source/compiled modules match the original baseline capture exactly
- B2 core source SHA-256: `59e92db20f2688cc77eade171432a663085f9d7dba00884c5c2d388fd8265e21`; freeze authorized at 2026-10-06 04:20:12 UTC
- B2 exact code patch: `second-core.patch.gz`. An independent baseline archive + patch + build reproduced all 150 frozen source/compiled modules. See `second-core-reproduction-verification.json`
- Frozen common assets: SHA-256 `3ec6501a86329cf5776d3fc487590c424b112e75d65da749fe7378662c6f7404`; independent asset reconstruction reproduced these bytes
- Second input seal: SHA-256 `b1a2573ef1d94951fb11618d1a7891077464dcf7b7d368e4a7015d93aaa7ea3e`, authored at 03:33:20 UTC, 28 cases / 14 pairs
- First exposure: 04:21:39 UTC, after freeze. The initial generic converter expected `text`/`source`, while this fixture used `input`; it stopped before either engine ran. Only this field adapter was corrected. `unseal-execution-start.json` records the failure and exact mapping. No input text, engine, settings, or classifier definition changed
- Each of the 28 cases then ran once at each of intensities 2 and 3 on each frozen engine, using identical inputs, settings, assets, parser identity and original analysis hashes. No postfreeze retuning occurred for this B2 record

`engine-snapshot-manifest.json` inventories the copied tracked/untracked sources and compiled tree. Installed Node/Python dependencies were linked, and the parser versions are pinned in every suite summary. Candidate generation used Node 24 and actual GiNZA 5.2.1 / ja-ginza 5.2.0 / spaCy 3.8.16 / SudachiPy 0.6.11 / SudachiDict-core 20260723.

The frozen recorder intentionally was not changed: `replayManifest.engineVersion` inherits the historical asset identity because the recorder does not override it. It is not the B2 code identity. Use `meta.engineHashes`, `meta.engineHash` and `meta.buildInfo.sourceHash` for the executed code. The baseline archive's stored `buildInfo.toolCommit` is also historical; archive revision plus reproduced module hashes establish baseline provenance. The separate HTTP/API tests use freshly built production assets.

## Results and denominators

Every source runs at intensities 2 and 3. Counts below include the complete pool and actual displayed order; movement and split/fusion overlap and must not be added.

| Suite | Cases / requests per engine | Structural pool / displayed | Body-composition pool / displayed | Role movement displayed | Split/fusion displayed | Total displays before → after |
|---|---:|---:|---:|---:|---:|---:|
| Already exposed regression | 175 / 350 | 298 / 139 | 243 / 112 | 104 | 74 | 802 → 853 |
| Second prospective synthetic suite | 28 / 56 | 14 / 10 | 9 / 6 | 6 | 4 | 106 → 112 |

Before-body and before-structural counts are zero. Both suites have zero request errors, invalid bounded proofs, slot/provenance failures, non-passing displayed checks and non-null S/Q. The six baseline no-display requests in the 175 remain six. There are no no-display requests in the 28; ordinary fallback/ending outputs do not count as structural coverage.

| Fresh family | Cases | Cases with structural/body pool output | Cases displaying body output |
|---|---:|---:|---:|
| Reason-backed assertion | 6 | 3 | 2 |
| Modesty with accomplishment | 6 | 0 | 0 |
| Explicit evidence request | 6 | 0 | 0 |
| Scope control | 2 | 0 | 0 |
| Quotation control | 2 | 0 | 0 |
| Actor/recipient control | 2 | 0 | 0 |
| Quantity control | 2 | 1 | 1 |
| Duplicate-premise control | 2 | 0 | 0 |

Paraphrase pairs R01/R02/R03 each cover only one side in the pool, and R03 covers neither side in body display. M01/M02/M03/E01/E02/E03 cover neither side. Among five control pairs, only C04 covers one side. No pair has both sides structurally covered. `unseen-summary.json` includes every case ID and exact family/pair denominator.

Examples at intensity 3, with actual display status:

- R01A: `冷蔵庫に十分な食材があるので、明日の夕食は買い足さずに用意できます。` → first displayed `明日の夕食は買い足さずに用意できる。何故かというと冷蔵庫に十分な食材があるからだ。` preserves future time, ability and no extra shopping while reversing/splitting the clauses. Its R01B paraphrase has no structural output
- R02B: first displayed `手首が痛んでいるから今週、重量のある箱を持ち運ぶのは無理だという事実。` moves/fuses the source's existing reason and impossibility claim. R02A's `手首を痛めているため、今週は重い箱を運べません。` has no structural output
- R03A: `今日の打ち合わせは別の部屋が必要だ。何故かというと会議室の予約が二重になっているからだ。` is a body-composition candidate in the pool only. First display is the order-preserving nominalized conclusion, classified structural-fixed-form-only
- C04A: first displayed `五枚の精算書のうち三枚だけは確認を終えたが、計算は得意ではない。残り二枚はまだ見ていません。` preserves the three-of-five restriction and two remaining unseen forms. This control is not included in the 18 ordinary examples
- M01A: `整理整頓は得意ではありませんが、共有棚のファイルには全部ラベルを付け終えました。` has no structural output. Neither do the other five modesty inputs or any of the six requests for original visit records, inspection forms or manufacturer reports

All 14 structural candidates and all intensity-3 displayed texts were read. No obvious new semantic break was found in that assistant inspection. This is not a safety certificate, linguistic oracle, or human S/Q annotation. The poor generalization result is retained regardless of the passing finite checks.

## What is counted

Categories are preservation/layout-only, ending-only, lexical-only, fixed-phrase construction, structural-fixed-form-only, source-body composition and invalid structural program. Body composition requires a separately rerun bounded proof from original IR, exact source-slot coverage/provenance, at least two non-context source roles, changed block text, and either actual role-order inversion or a change in source-sentence grouping. Context/marker shuffling alone cannot count. Source-bound-piece inversion, copied-piece inversion, role inversion and split/fusion are retained separately.

Split/fusion is a finite surface diagnostic comparing original GiNZA sentence spans to terminal-delimited output groups, not an independent syntactic judgment. The proof reruns production recognizers/grammar afresh and therefore is independent of serialized claims, not an independently implemented semantic oracle. All-pool, displayed, and first-displayed counts remain separate. Blocks are composed in source document order; this does not establish global narrative construction.

The pre-freeze audit tightened provenance, coverage and role-order checks and retained all candidate output spans/check fields/replay manifests. Rechecking all three B1 suites under that definition changed none of their body/movement/grouping counts. `pre-v2-classifier-b1-audit.json` and `evaluation-verifier-mutation-tests.json` preserve that evidence.

## Files and earlier failures

- `regression-cases.json`: all prior 127 + 18 exposed development + first prospective 30, now 175 exposed inputs
- `unseen-cases.json`: the original 28-case sealed bytes; `unseen-input.json`: exact execution input including unchanged text and mapped metadata
- `*-comparison.json.gz`: dictionary-deduplicated exact before/after candidates, complete plans, evidence, checks, output-source spans, structural diagnostics, replay manifests and exact display order. Full raw repeated parser/IR captures remain outside the repository with hashes in `evaluation-verification.json`
- `second-validation.patch.gz`, `second-validation-patch-manifest.json`: exact B2 test/benchmark changes from the frozen snapshot, independently applied and file-hash checked after the core patch. This preserves the 376-test source suite even after current tests migrate to later versions
- `verification.json`, `near-limit-api.json`, `validation-logs/`: 376/376 tests, typecheck/build/assets/actual-parser checks and six serialized near-limit HTTP workloads, 6.660–24.393 seconds. These authored workloads are not a universal latency guarantee
- `independent-safety-review.md`, `safety-review/`: passive/negative-past, potential-gate and adjective-copula failures and repairs, plus original exploratory and final recheck records
- `open-style-review/`: 20 openly authored qualitative probes using current production assets and a separate seed. The manifest and complete raw capture are included. These probes are not unseen, not human ratings, and not part of the 175/28 paired counts. They distinguish source-distinctive lexical/syntactic compositions from ordinary neutral recomposition and note the shared modesty-evidence leakage group
- `../first-pass/`: immutable B1 package, whose first prospective 30 produced body outputs for only one of 18 ordinary inputs; its exact first-core patch and independent reconstruction remain available. That failure led to B2; this second failure must also remain visible

## Reproduction

Public reruns are regressions, never a fresh unseen evaluation. From the repository root, set PKG to this preserved second-pass directory. Use the installed/pinned Node 24/Python environment; set BURONT_PYTHON to the project's Python executable. The commands never rebuild the main checkout.

```sh
REPO="$PWD"
PKG="$REPO/artifacts/typed-rhetorical-generation-20261006/second-pass"
BASE=$(mktemp -d)
AFTER=$(mktemp -d)
RUN=$(mktemp -d)
export BURONT_PYTHON="$REPO/.venv/bin/python"
git archive a25c40a82c80dd9f8209aecf21b669ede8d5619a | tar -x -C "$BASE"
git archive a25c40a82c80dd9f8209aecf21b669ede8d5619a | tar -x -C "$AFTER"
gzip -dc "$PKG/second-core.patch.gz" > "$RUN/core.patch"
git -C "$AFTER" apply "$RUN/core.patch"
gzip -dc "$PKG/second-validation.patch.gz" > "$RUN/validation.patch"
git -C "$AFTER" apply "$RUN/validation.patch"
ln -s "$REPO/node_modules" "$BASE/node_modules"
ln -s "$REPO/node_modules" "$AFTER/node_modules"
(cd "$BASE" && npm run build:engine)
(cd "$AFTER" && npm run build:engine)
node "$PKG/scripts/recreate-composition-evaluation-assets.cjs" --baseline-root "$BASE" --out "$RUN/assets.json"
# Check assets SHA-256 and AFTER/build-info.json.sourceHash against the values above.
for SUITE in regression unseen; do
  INPUT="$PKG/$SUITE-cases.json"
  if [ "$SUITE" = unseen ]; then INPUT="$PKG/unseen-input.json"; fi
  node "$PKG/scripts/evaluate-typed-rhetorical-generation.cjs" --engine-root "$BASE" --assets "$RUN/assets.json" --cases "$INPUT" --out "$RUN/before-$SUITE.json.gz" --revision a25c40a82c80dd9f8209aecf21b669ede8d5619a
  node "$PKG/scripts/evaluate-typed-rhetorical-generation.cjs" --engine-root "$AFTER" --assets "$RUN/assets.json" --cases "$INPUT" --out "$RUN/after-$SUITE.json.gz" --revision sourceHash:59e92db20f2688cc77eade171432a663085f9d7dba00884c5c2d388fd8265e21
  node "$PKG/scripts/compare-typed-rhetorical-generation.cjs" --before "$RUN/before-$SUITE.json.gz" --after "$RUN/after-$SUITE.json.gz" --before-root "$BASE" --after-root "$AFTER" --out "$RUN/full-$SUITE.json.gz" --summary "$RUN/$SUITE-summary.json"
  node "$PKG/scripts/compact-typed-rhetorical-evaluation.cjs" "$RUN/full-$SUITE.json.gz" "$RUN/$SUITE-comparison.json.gz"
done
node "$PKG/scripts/verify-typed-rhetorical-evaluation.cjs" "$PKG"
```

To rerun the historical B2 validation suite after applying both patches, use `(cd "$AFTER" && npm run typecheck && npm test && npm run build:assets && npm run diagnose)`. The frozen original run had 376 passing tests. The validation patch was independently applied and all changed test/benchmark files matched the frozen snapshot; this packaging check did not itself rerun the full 376 tests. For the serialized HTTP workloads, run `node "$AFTER/scripts/benchmark-structural-generation.cjs" --root "$AFTER" --output "$RUN/reproduced-near-limit-api.json"` after rebuilding assets in AFTER. Keep other CPU-intensive work stopped during that benchmark.

For B1 reproduction, apply `../first-pass/first-core.patch.gz` to the same baseline and use its archived scripts/fixtures; do not build the current main checkout as a substitute for the historical first engine. Its sourceHash must equal `a471e987b69958a2cc2c5dea21d3e7ab0c58468795fe2e29581ba4efc4a30504`.

## Retrospective semantic blocker discovered during B3 review

The later independent review found concrete request-action/acquisition-desire loss in X13, X16, X18, U15, U16 and U18, and these same outputs were confirmed in this immutable B2 known175 capture. The requested show/tell/provide action or desire for evidence was replaced by an existence/definition question even though bounded checks passed. `retrospective-request-action-loss.json` retains exact source/output/plan identities. This strengthens the rejection of broad B2 acceptance. It does not alter original counts or raw results. The earlier no-obvious-break reading concerned the14 structural candidates in the second prospective28, not all known175 outputs.

The same later review found a second inherited B2 blocker in known control U29: a sentence denying that reason-ignorance causes opposition was split into a denial of opposition itself, explained by reason-ignorance. `retrospective-negated-cause-scope.json` preserves the exact original source and first output. This mechanical body-composition count remains in the historical totals, but cannot be counted as semantic acceptance.
