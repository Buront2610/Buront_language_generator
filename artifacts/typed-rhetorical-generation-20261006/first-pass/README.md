# Typed rhetorical generation B: evaluation

This is a source-bound structural-generation audit, not human naturalness, style, humor, or quality evaluation. S/Q stays null. Every input is synthetic; even the new unseen suite is not a random natural-language sample.

## Suites and retained evidence

- `regression-cases.json`: 127 previously evaluated inputs. This includes prior 35 regression + 20 controlled + 12 exposed + 12 formerly held-out inputs, and PR5's 12 exposed + 24/12 former holdouts. All are regressions now
- `exposed-cases.json`: 18 deliberately exposed work/day-to-day diagnostics, separately authored and available during implementation
- `unseen-cases.json`: 30 work/day-to-day inputs sealed before inspecting implementation, covering vocabulary/paraphrase contrasts and hostile conditions, quotes, quantities, actor/recipient roles, duplicate premises and scope. `evaluation-verification.json` records the seal, code freeze and first-run history
- `*-comparison.json.gz`: one paired, dictionary-deduplicated comparison per suite, retaining every candidate text, exact display ordinal, operation/realization IDs, full source-bound plans and span provenance, evidence records, check outcomes, null-S/Q, parser/source hashes and tested-engine identity
- `*-summary.json`: counts and full measurement identity. These are structural diagnostics, never human-quality ratings
- `verification.json`, `evaluation-verification.json` and `index.json`: test evidence, readback and artifact integrity records

The compact comparison has `rows[].results[].before/after.candidates`, a full `plans` dictionary keyed by each candidate's `planId`, an `evidence` dictionary addressed by `evidenceIds`, and a `checks` dictionary addressed by `checkIds`. Selected candidates are also stored in exact display order. Per-candidate `structuralDiagnostics` contains source slot coverage, role ordering, source sentence grouping and emitted grouping.

Repeated raw source IR and parser objects remain outside the repository. The immutable input fixture, parser versions, source-analysis hash and capture tool reproduce them. Full candidate text, programs, evidence and checks are not omitted. Compaction is losslessly checked against the complete raw captures before delivery.

## Classification

Each candidate is classified as preservation/layout-only, ending-only, lexical-only, fixed-phrase construction, structural fixed-form-only, body composition, or invalid structural program.

Body composition requires a separately rerun bounded structural proof, at least two source-bound relation roles, and an actual source-role order inversion or change of source sentence grouping. Both copied source pieces and source-bound grammatical replacements participate in the order audit; copied-piece inversion is also reported separately. Grouping compares GiNZA source-sentence spans intersecting each block with terminal-delimited output groups. It is a finite surface diagnostic, not an independent syntactic parser.

A nominalized ending, added phrase or `STRUCTURAL` label alone does not count as body composition. Source-clause movement and split/fusion counts are reported separately and can overlap. A program that fails its independent bounded proof is excluded from body-composition counts. The proof reuses production source recognizers/validators afresh, so it is independent of submitted plan claims but not an independently implemented linguistic oracle. Direct slot-partition and source-provenance checks are recorded separately.

All-pool, displayed and first-displayed counts are separate. Candidate-count growth, changed order and first-place structural outputs do not establish improved ranking or style quality. Unsupported inputs and abstentions remain in denominators.

## First-run results and limits

Every suite runs at intensities 2 and 3 on both engines. The final B source hash is `a471e987b69958a2cc2c5dea21d3e7ab0c58468795fe2e29581ba4efc4a30504`. All final runs have stable engines, identical input/asset/parser identities, zero rejected bounded programs, zero failing displayed checks and null S/Q throughout.

| Suite | Cases / requests per version | All structural pool / displayed | Body-composition pool / displayed | Source-role movement displayed | Grouping changes displayed | All displays before → after |
|---|---:|---:|---:|---:|---:|---:|
| Prior regression | 127 / 254 | 199 / 72 | 187 / 70 | 62 | 60 | 605 → 609 |
| Exposed work/day-to-day | 18 / 36 | 34 / 18 | 29 / 14 | 14 | 6 | 89 → 89 |
| Sealed unseen work/day-to-day | 30 / 60 | 15 / 8 | 6 / 4 | 4 | 4 | 108 → 116 |

All before-body counts are zero. Movement and grouping overlap; they must not be added. The prior regression retains the same six no-display requests. Among all 30 unseen cases, only U03 and U25 generate source-body compositions, at both intensities. Of the 18 ordinary unseen vocabulary/paraphrase examples, reason coverage is 1/6, modesty 0/6 and adversative/evidence requests 0/6. The other successful input is the actor-role safety control U25. The narrow generalization result is a limitation of this implementation, not a claim that unsupported input is unsafe or that broad B is complete.

Concrete exact outputs at intensity 3:

- Exposed X01: `朝の連絡はメールにした。相手が会議中だからだ。` → displayed first `相手が会議中だから朝の連絡はメールにしたということ。` (source reason moved before assertion and two sentences fused)
- Exposed X07: `大したことはしていない。机を片付けただけだ。` → displayed first `机を片付けただけだ。それほどでもない。` (limited deed moved before modesty)
- Exposed X13: target-first `便利なのは分かった。しかし安全だっていうどういう証拠があるのかよ？` is displayed first but classified fixed-form-only. The separately verified source-role-reordered candidate `便利なのは分かった。しかしどういう証拠があるのかよ、安全だって。` is in the pool and not displayed. Do not call the displayed version a source-order improvement
- Unseen U03: `駅前の店は改装中ですから、昼ご飯は会社の食堂で食べます。` → displayed first `昼ご飯は会社の食堂で食べる。何故かというと駅前の店は改装中だからだ。` (claim first, reason second, one sentence split into two)
- Unseen U25: `私が佐藤さんに確認を頼んだので、佐藤さんから私に結果が届きます。` → displayed first `佐藤さんから私に結果が届く。何故かというと私が佐藤さんに確認を頼んだからだ。` (same sender/recipient direction retained)

Failure-to-cover examples are retained in full: unseen U04's `工事で休んでいるため`, U07's `得意というほどではありませんが` with three corrected rows, and U13's same-sentence understanding followed by a contract-evidence request receive no structural candidates. They are vocabulary/paraphrase contrasts, not held-out successes hidden by a filtered denominator. No sealed result was used to tune the production code.

Before freeze, four exposed contrast-prefix evidence-question candidates failed the new independent proof and were rejected without display. The exposed mismatch was repaired and retested before this final snapshot; `evaluation-verification.json` records that diagnostic history. Initial failed outputs are not silently presented as final results.

## Reproduction

Use Node 24 and the pinned Python/GiNZA environment. Set `BURONT_PYTHON` if the engine directories lack their own `.venv`. Do not edit or rebuild an engine while it is being captured.

The baseline is `a25c40a82c80dd9f8209aecf21b669ede8d5619a` (PR5). The final tested B source hash is recorded in `verification.json` and each summary. Asset provenance is separate from tested-code identity. Recreate the exact previously frozen assets using the existing `scripts/recreate-composition-evaluation-assets.cjs`; the required asset SHA-256 is `3ec6501a86329cf5776d3fc487590c424b112e75d65da749fe7378662c6f7404`.

```sh
REPO="$PWD"
BASE=$(mktemp -d)
AFTER=$(mktemp -d)
RUN=$(mktemp -d)
git archive a25c40a82c80dd9f8209aecf21b669ede8d5619a | tar -x -C "$BASE"
ln -s "$REPO/node_modules" "$BASE/node_modules"
(cd "$BASE" && npm run build:engine)
node scripts/recreate-composition-evaluation-assets.cjs --baseline-root "$BASE" --out "$RUN/assets.json"
npm run build:engine
cp -a dist packages services build-info.json "$AFTER/"
ln -s "$REPO/node_modules" "$AFTER/node_modules"
CASES="$REPO/artifacts/typed-rhetorical-generation-20261006"
for SUITE in regression exposed unseen; do
  # The sealed file preserves its original byte seal and uses text fields.
  # Convert those to the same source/settings shape only for execution.
  INPUT="$CASES/$SUITE-cases.json"
  if [ "$SUITE" = unseen ]; then
    node - "$CASES/exposed-cases.json" "$INPUT" "$RUN/unseen-input.json" <<'JS'
const fs=require('node:fs');
const settings=JSON.parse(fs.readFileSync(process.argv[2])).settings;
const sealed=JSON.parse(fs.readFileSync(process.argv[3]));
fs.writeFileSync(process.argv[4],JSON.stringify({schemaVersion:1,protocol:'Sealed 30 first-run input; subsequent public reruns are regressions.',settings,cases:sealed.cases.map(({text,...c})=>({...c,currentRole:'sealed-unseen-workday',source:text}))},null,2)+'\n');
JS
    INPUT="$RUN/unseen-input.json"
  fi
  node scripts/evaluate-typed-rhetorical-generation.cjs --engine-root "$BASE" --assets "$RUN/assets.json" --cases "$INPUT" --out "$RUN/before-$SUITE.json.gz" --revision a25c40a82c80dd9f8209aecf21b669ede8d5619a
  node scripts/evaluate-typed-rhetorical-generation.cjs --engine-root "$AFTER" --assets "$RUN/assets.json" --cases "$INPUT" --out "$RUN/after-$SUITE.json.gz" --revision "sourceHash:$(node -p 'require(process.argv[1]).sourceHash' "$AFTER/build-info.json")"
  node scripts/compare-typed-rhetorical-generation.cjs --before "$RUN/before-$SUITE.json.gz" --after "$RUN/after-$SUITE.json.gz" --before-root "$BASE" --after-root "$AFTER" --out "$RUN/full-$SUITE.json.gz" --summary "$RUN/$SUITE-summary.json"
  node scripts/compact-typed-rhetorical-evaluation.cjs "$RUN/full-$SUITE.json.gz" "$RUN/$SUITE-comparison.json.gz"
done
node scripts/verify-typed-rhetorical-evaluation.cjs "$CASES"
```

Comparisons reject mismatched inputs, assets, settings, parser versions or original source-analysis hashes, and changing engines. Public reruns of the sealed inputs are reproducibility/regression runs, never new unseen evaluation. Generation timing is retained for transparency; these suite runs are not controlled performance benchmarks.
