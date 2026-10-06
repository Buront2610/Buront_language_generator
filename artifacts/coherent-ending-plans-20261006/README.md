# Coherent ending plans: compact evaluation

This is an objective audit of the finite ending-edit policy, not a naturalness, humor, literary style, or human-quality evaluation. S/Q remains null. The selector is unchanged; changed candidate pools may still change the displayed order.

## Files and scope

- `regression-cases.json`: the previous 35 regression + 20 controlled + 12 exposed + 12 formerly held-out inputs, all now regression (79 cases; both intensities 2 and 3)
- `diagnostic-cases.json`: 12 exposed inputs: the four original diagnostic sources, plus eight purposeful inflection, scope, replacement-overlap, and insistence-budget controls
- `heldout-selection-cases.json`: 24 separately sealed inputs evaluated only after code freeze, with its seal, protocol, distinctness record, and selection metrics
- `heldout-ending-cases.json`: 12 additional separately sealed ending-focused inputs evaluated only after code freeze, with its seal, protocol, and selection metrics
- `*-comparison.json.gz`: one losslessly compressed JSON per suite, with exact selected text in display order, and every preselection-pool candidate after independent verification; includes candidate ID, plan ID, text, effective edit program and signature, check results, S/Q-null, and ending-coverage measurement
- `*-summary.json`: compact counts and full run identity/provenance; the corpus manifest, exact asset hash, input hash, parser identity, evaluator hash, and source/compiled-module hashes are retained
- `index.json`: file hashes and byte counts, including independently supplied sealed-holdout artifacts when available

Raw before/after runs remain outside the repository. Public artifacts use a small number of files, rather than one file per case/candidate. `gzip -dc FILE.json.gz` yields ordinary JSON.

Each input set's protocol identifies whether it was exposed or sealed. Replaying any published set is a reproducibility test, not a new unseen test. The former holdout is explicitly regression now. The evaluation does not modify or retune the production selector.

## Results

All four comparisons use the same frozen assets, fixed parser/settings, baseline main revision, and final source hash `767344f780e9d906a76189416075557fc835a9af3018d6ff107e28141b845120`. Each case runs at intensities 2 and 3. Exact texts and display order remain in the comparison files.

| Suite | Cases / requests | Partial pool candidates before → after | Partial selected before → after | Partial top before → after | Total displays before → after |
|---|---:|---:|---:|---:|---:|
| Existing regression | 79 / 158 | 8 → 0 | 5 → 0 | 4 → 0 | 359 → 359 |
| Exposed diagnostics | 12 / 24 | 53 → 0 | 39 → 0 | 17 → 0 | 68 → 68 |
| Sealed selection holdout | 24 / 48 | 17 → 0 | 7 → 0 | 4 → 0 | 112 → 112 |
| Sealed ending holdout | 12 / 24 | 27 → 0 | 15 → 0 | 6 → 0 | 62 → 66 |

The four additional ending-holdout displays belong to the separately documented terminal polite-copula quantity-role repair: the candidate texts/edits already existed, and their quantity check changed from fail to pass. They are not attributed to the ending planner. All selected candidates pass recorded checks, and every candidate retains null S/Q. The regression's same six unsupported-relation abstentions remain. Exposed per-request display counts and shortfall reasons are unchanged.

Preserve choices can still rank first, and a construction-only preserve plan can change its construction's tail while keeping polite text elsewhere. No claim of universal register uniformity, improved ranking, or human quality follows from these counts.

## Metric

The evaluator rebuilds source-order narrative units from the original IR. It enumerates every plain ending rule that actually changes its source, qualifies for the request's intensity/series and fixed original-post evidence, and passes `permitsRewrite` for that original unit/span. Overlapping alternatives at one tail form one opportunity. Candidate proposals and output substrings do not define opportunities.

For each independently valid rewrite/construction candidate, a nonzero-width legal non-ending replacement or independently revalidated construction replacement removes any opportunity whose source span it overwrites. A zero-width reason prefix does not remove an opportunity. Of the remaining opportunities, an explicit ending edit converts the touched site. A candidate with at least one explicit ending edit but an untouched eligible site is a partial conversion. Counts are available for the whole pool, selected candidates, and top selections.

Candidates with no explicit ending edits are classified `preserve`; they are not failures. This includes construction-only choices whose registered construction may itself change a tail. Other candidate families have no applicable ending metric. Protected quotations, uncertainty, unsupported inflections, and otherwise untransformable polite text never enter the opportunity set. Therefore zero partial conversions does **not** mean every output has a uniform register, every polite string is transformed, or selection/human quality improved.

The source-bound guards and construction validator are independently rerun against the original IR, but they are production guard implementations, not a second linguistic oracle. All actual candidate checks are recorded separately from this coverage metric. The effective edit signature is SHA-256 over the ordered compact edit objects in that candidate's `edits` field (including the source span, original/replacement text, registered rule or construction, operation, node, and evidence IDs).

## Reproduction

Use Node 24 and the pinned Python 3.11/GiNZA requirements. Set `BURONT_PYTHON` to that environment. Do not rebuild or edit either engine while a run is active. `--revision` is an explicit label; the source/module hashes and `stableEngine` check are the actual runtime identity evidence. Historical `toolCommit` values inside frozen asset/build metadata are not the tested engine identity.

The tested baseline is main commit `4d918a56fba7e77c06788baa1cd33817086b5a12`. The existing `scripts/recreate-composition-evaluation-assets.cjs` recreated the exact fixed asset bytes from that baseline using the prior published frozen manifest; a byte-for-byte comparison passed (`asset-replay.json`). It restores historical asset build provenance only after all substantive manifests match. Asset provenance and tested code remain separate.

To prepare the two immutable engine directories and fixed assets:

```sh
REPO="$PWD"
BASE=$(mktemp -d)
AFTER=$(mktemp -d)
RUN=$(mktemp -d)
git archive 4d918a56fba7e77c06788baa1cd33817086b5a12 | tar -x -C "$BASE"
ln -s "$REPO/node_modules" "$BASE/node_modules"
(cd "$BASE" && npm run build:engine)
node scripts/recreate-composition-evaluation-assets.cjs \
  --baseline-root "$BASE" --out "$RUN/frozen-assets.json"
ASSETS="$RUN/frozen-assets.json"
npm run build:engine
cp -a dist packages services build-info.json "$AFTER/"
ln -s "$REPO/node_modules" "$AFTER/node_modules"
```

With immutable built engine directories in `BASE` and `AFTER`, exact fixed assets in `ASSETS`, and a scratch output directory in `RUN`:

```sh
REPO="$PWD"
CASES="$REPO/artifacts/coherent-ending-plans-20261006"
for SUITE in regression diagnostic heldout-selection heldout-ending; do
  node "$REPO/scripts/evaluate-coherent-ending-plans.cjs" \
    --engine-root "$BASE" --assets "$ASSETS" \
    --cases "$CASES/$SUITE-cases.json" --out "$RUN/before-$SUITE.json" \
    --revision 4d918a56fba7e77c06788baa1cd33817086b5a12
  node "$REPO/scripts/evaluate-coherent-ending-plans.cjs" \
    --engine-root "$AFTER" --assets "$ASSETS" \
    --cases "$CASES/$SUITE-cases.json" --out "$RUN/after-$SUITE.json" \
    --revision "sourceHash:$(node -p 'require(process.argv[1]).sourceHash' "$AFTER/build-info.json")"
  node "$REPO/scripts/evaluate-coherent-ending-plans.cjs" \
    --before "$RUN/before-$SUITE.json" --after "$RUN/after-$SUITE.json" \
    --out "$RUN/$SUITE-comparison.json.gz" --summary "$RUN/$SUITE-summary.json"
done
```

The comparison rejects changing engines, mismatched input/asset/evaluator identities, mismatched parser/settings/source-analysis hashes, and changed plain-tail opportunity sets. This enforces a like-for-like coverage comparison. Elapsed generation time is recorded only for transparency; these corpus runs are not a controlled performance benchmark.

Readback verification (no engine execution):

```sh
node scripts/verify-coherent-ending-evaluation.cjs artifacts/coherent-ending-plans-20261006
```
