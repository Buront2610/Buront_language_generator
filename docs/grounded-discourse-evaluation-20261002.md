# Grounded-discourse output comparison · 2026-10-02

## Observed result

The controlled run improves three of the sixteen reused ordinary cases: N03 and N04 make an existing reason explicit with `何故なら`; N05 places `それほどでもない` before the unchanged limited achievement. These are actual displayed candidates. The other **13/16 ordinary cases are text/order-identical** to baseline.

- Ordinary passages: **32 → 34 displayed candidates**, and **0 → 3 displayed discourse constructions**, at each intensity. Cases with fewer than three candidates change from 14/16 to 12/16; shortages are not automatically failures.
- P01–P03 remain unchanged with the same three supported constructions and eight total candidates per intensity. B01–B03 still return no candidate with `unsupported_relation` and the source fallback.
- Separate targeted diagnostics: T01–T04 gain explicit reason frames; T13 gains a contrast frame only at intensity 3. T05–T12 remain unchanged.
- All 35 cases execute at both intensities without errors. Every displayed candidate passes the existing verification. **S and Q remain null**, with no learned preference/style score.
- All sixteen ordinary cases still have identical displayed text/order between intensity 2 and 3. The new intensity distinction is observed only in targeted T13 here.
- The controlled after snapshot is identified as `c7631ae+working-tree`, source hash `f7768acb4768ee7727fdf6b1f968509062bc9f33bb93fb39232bec2f1966a89e`. It was copied after the aggregate build; before/after file hashes are stable, and all recorded engine hashes/texts are identical to the earlier controlled snapshot. It is not falsely labeled as an already committed revision.

[Comparison summary and artifact index](../artifacts/grounded-discourse-20261002/comparison-summary.json) · [Full source case set](../artifacts/grounded-discourse-20261002/cases.json) · [Qualitative inspection](../artifacts/grounded-discourse-20261002/qualitative-assessment.json)

## Actual before/after examples

The examples identify the displayed candidate's ordinal. Complete ordered candidates at both intensities, including unchanged cases, are in the indexed JSON; this section does not substitute a hand-picked output for the engine's first result.

### N03 · 根拠を伴う比較

Input:

```text
車より電車で行くほうがよいと思う。駐車場を探す必要がなく、到着時刻も読みやすいからだ。
```

Before, displayed candidate 1 (intensity 2):

```text
車より電車で行くほうがよいと思う
駐車場を探す必要がなく、到着時刻も読みやすいからだ
```

After, displayed candidate 1 (same intensity):

```text
車より電車で行くほうがよいと思う
何故なら駐車場を探す必要がなく、到着時刻も読みやすいからだ
```

The old second candidate ended in `読みやすいからだからな`. That explanatory-causal repetition is absent after repair. The opinion `と思う` and both reasons stay intact. This is a reason introducer, not a new argument or a reordered paragraph.

### N04 · 反論と根拠

Input:

```text
その案には賛成できない。費用が高いだけでなく、準備に一週間もかかるからだ。まず小さく試すべきだと思う。
```

Before, displayed candidate 1 (intensity 2):

```text
その案には賛成できないからな
費用が高いだけでなく、準備に一週間もかかるからだ
まず小さく試すべきだと思う
```

After, displayed candidate 1 (same intensity):

```text
その案には賛成できないからな
何故なら費用が高いだけでなく、準備に一週間もかかるからだ
まず小さく試すべきだと思う
```

High cost, one-week preparation, disagreement and the small-trial recommendation remain intact. The output still uses the pre-existing `からな` emphasis; richer narrator voice is not established by adding the reason marker.

### N05 · 謙遜を伴う達成

Input:

```text
大したことはしていない。故障の原因を見つけて、止まっていた機械を動かしただけだ。
```

Before, displayed candidate 1 (intensity 2):

```text
大したことはしていないからな
故障の原因を見つけて止まっていた機械を動かしただけだ
```

After, displayed candidate 1 (same intensity):

```text
それほどでもない
故障の原因を見つけて止まっていた機械を動かしただけだ
```

The original achievement and `だけだ` limitation are preserved. No praise or additional success is supplied. T05, an analogous key-and-door example ending in `開けただけだ`, is unchanged, showing that the modesty support remains narrow.

### T13 · 追加陽性確認・明示的逆接

Input:

```text
この道は近い。しかし、夜は暗くて歩きにくい。
```

Before, displayed candidate 1 (intensity 3):

```text
この道は近いからな
しかし夜は暗くて歩きにくい
```

After, displayed candidate 1 (same intensity):

```text
この道は近いからな
だが夜は暗くて歩きにくい
```

T13 was explicitly added as a support-confirming diagnostic. At intensity 2 it is unchanged. The already explicit contrast is realized with a different connective; the factual clauses keep their order and content.

### Limits visible in ordinary outputs

N14 input:

```text
この傘は軽くて丈夫だ。値段は少し高かったが、毎日使うものなので満足している。
```

Before and after, candidate 1 at both intensities are identical:

```text
この傘は軽くて丈夫だからな
値段は少し高かったが毎日使うものなので満足している
```

The embedded concessive `が` is not reframed. Plain narration, thanks, requests, scenery, weak irritation, uncertainty, quotations and scene progression are also unchanged in this ordinary set. The comparison supports a narrow gain in explicit relation signaling and modest self-presentation, not a claim that ordinary paragraphs now match the supplied works' sustained voice.

N02 still displays `明日の会議は午後三時からだからな`. Here `から` is the start-time case particle; its literal resemblance to the repaired explanatory repetition is not evidence of the same grammatical bug. The repetitive surface and mixed register remain visible limitations; this repair is not a global cleanup of awkward endings. The audit's substring count is therefore diagnostic only, not a grammar-error count.

No newly invented actor/event, changed quantity, removed negation or promoted uncertainty was found in model inspection of this bounded output set. Quotes and attributions in the targeted guards remain intact. Factual preservation and pragmatic identity are different: pronoun, emphasis and modesty choices can change a speaker's stance even when facts stay fixed. An independent human evaluation on fresh material is still needed for naturalness, humor and personal style preference.

## Scope and method

This is a same-input regression comparison with actual surfaced output, followed by a separately labeled production-dataset smoke check. It is **not** a human taste evaluation, a learned style score, a blinded preference test, or a claim of general literary quality.

- Baseline: `c7631aeab30d962ef0ccb55c1e97f289da47e632`, archived from Git and built in isolation before this stage's changes. Its tree is equivalent to `f4147c7`; the prior evaluation's seven recorded engine module hashes match the archive build.
- Cases stay in authored order: N01–N16 ordinary passages; P01–P03 supported-structure positive controls; B01–B03 abstention controls. All 22 source strings, settings and seed are reused without alteration. This set already informed the requested repairs, so it is **not held out**.
- T01–T12 are separate new targeted diagnostics, authored before the final implementation was inspected. T13 was added after inspecting explicit-connective support, and is explicitly a positive diagnostic rather than independent generalization evidence.
- Both controlled runs use the exact same frozen historical asset bytes and dataset `bd298f18d096233609ee2a826b22d2082aaf89922b6edecc91c52ab83bda3bc2`.
- Settings: `rewrite / faithful / blend / all / structured`, intensities 2 and 3, client revision 0, seed `literary-style-eval-20261002`, default disabled experimental operators. Source strings are parsed in each run; equality of the source-analysis hashes and parser versions is checked.
- All displayed candidates are recorded in engine order, including shortages and abstentions. The isolated baseline reproduces the prior 22 cases' displayed text/order exactly at both intensities: [baseline replay](../artifacts/grounded-discourse-20261002/baseline-replay.json).
- `assetManifest.engine` is historical dataset provenance. It is **not** the identity of the engine under test; see `testedRevision`, `testedEngineBuild.sourceHash` and the recorded engine file hashes.

## Interpretation against the supplied works

A fresh bounded inspection of [寺生まれのBさん](https://syosetu.org/novel/107412/4.html) and the readable カサブロント, 矛盾, ボダブレ and 方丈記 passages in [謎の改変物](https://kenkyonanight.xxxxxxxx.jp/oii.html) supports comparing clause relations, self-positioning and the progression from reasons to evaluations, as well as vocabulary. Their narrative voice is sustained through sequences of claims and incidents. Some examples invent narrative material; that is not a license to add causes, achievements, opponents or praise in faithful mode.

This report's qualitative observations are model inspection of those bounded passages and actual outputs. Counting a construction, passing verification, or removing a bad ending does not measure humor, naturalness, personal preference or equivalence to those works. [Source review and access limitations](../artifacts/grounded-discourse-20261002/source-review.json)

## Separate production-dataset smoke

The final aggregate build's freshly compiled dataset is `0fd001528a59d2fe9b35d63310acba66cc6fa65de362f1f17044ea81fc89b1f8`. It is deliberately separate from the historical fixed-dataset experiment. The same 35 inputs at both intensities were run through an isolated copy of that build, using these production asset bytes.

- Full tested-engine file hashes match the controlled after run; the snapshot stayed stable.
- All 70 runs completed without exceptions. All displayed candidates passed verification; S/Q remained null.
- Displayed candidate texts **and order matched the controlled after run for every case**, despite the different dataset identity. This was checked rather than assumed.
- N02's temporal `午後三時からだからな`, the 13 unchanged ordinary cases, the unsupported modesty analogue T05 and embedded-concession N14/T06 remain visible here too.

[Production metadata](../artifacts/grounded-discourse-20261002/production-smoke-metadata.json) and the `production-smoke-*.json` files are indexed in the [comparison summary](../artifacts/grounded-discourse-20261002/comparison-summary.json).

## Reproduction

The runner accepts explicit paths and does not depend on an agent workspace. It requires Node/Python dependencies, the repository data, and a built engine snapshot. The historical frozen asset file is not tracked; exact reproduction of this controlled experiment requires obtaining the asset bytes with the SHA-256 recorded in `before-metadata.json`. A newly compiled asset file is a different experiment because engine provenance affects dataset identity and deterministic tie order.

```sh
REPO="$PWD"
BASE=$(mktemp -d)
BEFORE=c7631aeab30d962ef0ccb55c1e97f289da47e632
git archive "$BEFORE" | tar -x -C "$BASE"
ln -s "$REPO/node_modules" "$BASE/node_modules"
ln -s "$REPO/.venv" "$BASE/.venv"
(cd "$BASE" && npm run build:engine)

# Set this to the verified historical frozen asset JSON, not active.json.
ASSETS=/path/to/frozen-assets.json
node scripts/evaluate-grounded-discourse.cjs \
  --engine-root "$BASE" --revision "$BEFORE" \
  --assets "$ASSETS" --out /path/to/before.json

# Archive/build the tested after revision separately in the same way.
node scripts/evaluate-grounded-discourse.cjs \
  --engine-root /path/to/after-snapshot --revision AFTER_COMMIT \
  --assets "$ASSETS" --out /path/to/after.json

# Run a separate smoke pass with freshly compiled final production assets.
node scripts/evaluate-grounded-discourse.cjs \
  --engine-root /path/to/after-snapshot --revision AFTER_COMMIT \
  --assets /path/to/production-assets.json --out /path/to/production-smoke.json

node scripts/summarize-grounded-discourse.cjs \
  --before /path/to/before.json --after /path/to/after.json \
  --smoke /path/to/production-smoke.json \
  --out artifacts/grounded-discourse-20261002
```

The optional `--cases` flag supplies another explicitly identified case file. The default is the tracked `cases.json` beside this report's artifacts. The summary script verifies fixed inputs/order, asset bytes/dataset, settings, parser identity, source analyses and stable engine hashes before writing comparison evidence. It splits output groups into JSON files smaller than 45,000 bytes. Full checks are summarized as check counts plus non-passing checks; all candidate texts, IDs, order, scores and primary construction/rewrite edit descriptions remain present. Generation timings are diagnostic single-run measurements and are not the near-5k performance benchmark.
