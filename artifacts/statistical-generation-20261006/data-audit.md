# Human parallel-data audit

Audited 2026-10-06 against main `4d918a56fba7e77c06788baa1cd33817086b5a12` and existing PR6 provenance artifacts (read only).

**Usable verified human ordinary-Japanese ↔ original-Buront pairs: 0.** Training and held-out quality comparison are blocked. Existing rules, assistant-authored probes, generated candidates, heuristic labels and qualitative assistant reviews are excluded.

## Available source material

- 2,452 archive post records and 9,591 source sentence records
- 165 quote headings + 840 excerpts = 1,005 quote records, in 846 variant groups
- 487 quote-linked original post records and 401 quote-page post records
- Quote context links: 981 matched, 4 ambiguous, 20 unmatched
- 2,227 archive posts have source URLs; 225 do not
- The conservative NFKC/casefold/whitespace duplicate grouping has 2,354 unique post texts and 8,206 unique sentence texts; these differ from historical normalizer counts
- Source/quote/variant/exact/near-duplicate closure produces 2,068 components, largest 69 posts. All 6 existing raw-log near-duplicate edges map to archive post IDs

These are archived candidates, not certified Buront authorship. Earlier raw-log analysis marks mixed/unverified speakers. Human source verification remains mandatory. Target-side monolingual material is not aligned parallel data.

## Evidence

- `Buront_statistical_research/assets/annotations/README.md`: Explicitly documents zero human labels and incomplete original-log human annotation
- `Buront_statistical_research/assets/sources/README.md`: Original assets and derivatives separated; rights unverified-local-only
- `Buront_language_generator/artifacts/typed-rhetorical-generation-20261006/open-style-review/authored-probes.json`: Protocol explicitly calls 20 inputs assistant-authored; no human S/Q ratings
- `Buront_language_generator/artifacts/typed-rhetorical-generation-20261006/open-style-review/manifest.json`: Assistant qualitative source review, not human S/Q
- `Buront_language_generator/artifacts/typed-rhetorical-generation-20261006/prospective-cases.json`: Independently authored synthetic semantic probes; human S/Q null
- `Buront_language_generator/artifacts/typed-rhetorical-generation-20261006/second-pass/evaluation-protocol.md`: 30 synthetic unseen semantic checks; all human quality/style ratings null

Full source/evidence hashes are in `data-audit.json`. No external corpus upload was performed. Existing rights status remains unverified-local-only.

## First bounded human annotation batch

A local-only `annotation-batch-001.blank.jsonl` was prepared with 12 original source sentences from 12 distinct conservative components. Selection prefers same-post literal heading/excerpt anchors, with heading priority and stable source-ID tie-breaking, after 12–120 character, source URL, balanced-delimiter and table-spacing filters. All 12 final rows have direct heading/excerpt anchors. The metadata selection record preserves exact IDs in `annotation-selection.json`: its final unfinished clause was replaced with a standalone, source-anchored original during intake review. This source selection is not a human training annotation. These are intake-usability filters, not authorship or semantic-quality labels. An initial raw ID-hash sampler included a numeric table row and was replaced before publication; it does not claim semantic representativeness. Original context, source URL, sentence/post IDs, quote/variant/leakage/duplicate lineage and source hashes are included. `source.quote_ids` records conservative post-context/leakage links; it does not assert each sentence exactly matches every linked quote. Every ordinary-text slot and author/reviewer identity is blank, and all attestations/review flags are false. This local file is rejected as training data and is not included in the public PR. Use the exporter below to create a fresh local template.

A human must:

1. Inspect the linked original and full post context, including actual speaker attribution. Exclude unsuitable or unclear records
2. Fill `ordinary_text` with their own meaning-preserving ordinary-Japanese rendering of the exact `original_text`. Do not use an LLM or existing rule output as the teacher
3. Supply `annotation.annotator_id`, set `author_type` to `human`, and affirm `human_authored` / `no_llm_or_synthetic` only when true
4. Review source attribution and semantic correspondence, supply `review.reviewer_id`, set `review.author_type` to `human`, affirm the reviewer’s own `review.no_llm_or_synthetic`, and affirm `reviewed`, `meaning_preserved`, `source_verified`, `lineage_reviewed` only when satisfied
5. Add shared IDs in `lineage.additional_family_ids` for human-discovered paraphrase/duplicate/variant families. Never edit computed source, lineage or target fields
6. Import/validate the completed file, freeze grouped train/dev/test split, then fit only on train. A batch of 12 is an intake pilot; no data-sufficiency or quality-improvement claim follows

Authorship declarations are enforceable metadata requirements, not a detector of dishonest declarations. The same person may author and review a row; no independent second-review claim is made. Computed grouping prevents known lineage/exact/near-duplicate leakage, but an unknown semantic duplicate still requires human review.

## Reproduction

```sh
python -m research.statistical_generation.data audit
python -m research.statistical_generation.data export /tmp/annotation-blank.jsonl --limit 12
python -m research.statistical_generation.data split /path/to/completed-human.jsonl /path/to/frozen-split.json
python -m unittest research.statistical_generation.test_statistical_data -v
```

Export and split refuse to overwrite existing output files. Import rejects blank/unreviewed, nonhuman/LLM/rule/synthetic, altered-source, altered-lineage and duplicate-ID rows. Frozen split validation binds all source/text/review bytes and checks all known relationship components remain within one partition. Three independent components only satisfy plumbing minima, never a quality benchmark.
