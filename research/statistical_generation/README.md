# Non-LLM statistical phrase-generation experiment

This is an **isolated research backend**. The default Web/API generator is unchanged. No Moses candidate receives the production engine's closed-rule verification label. No LightGBM, KNP, Pynini, external LLM, synthetic linguistic teacher, or automatic quality judge is added.

[日本語の実装詳細：変更ファイル・関数・データ形式・呼び出し順・再現手順](../../docs/statistical-generation-implementation-20261006.md)

## Current answer

The first **repository-only** audit found zero manually verified parallel pairs. That did not establish that published originals/adaptations were unavailable. The subsequent source investigation recovered actual human-published originals and adaptations from the user-specified sites and their antecedents.

A separate `documentary_published_pairs` mode now verifies captured source bytes and exact span correspondence, discloses assistant/tool alignment, and keeps semantic review **unreviewed**. It does not manufacture ordinary Japanese or human quality labels. The local trial uses 17 document captures, 12 original-work families and 220 paired spans derived from 140 documented passage windows. Of 146 training spans, 65 fit the conservative protected-value inventory; 81 were excluded, which is not a human judgment that every excluded pair changes meaning.

The real held-out comparison and its limitations are in [the documentary research report](../../artifacts/statistical-documentary-20261006/README.md). The model and protected source texts remain local. There is no production activation. Publication of code, source metadata, aggregates and short examples was subsequently authorized; protected corpus text and model weights remain excluded.

The earlier [repository audit](../../artifacts/statistical-generation-20261006/data-audit.md) and optional 12-row blank human-annotation starter remain as historical/optional intake work. Filling that workbook is **not a prerequisite** for documentary-source research.

## Documentary-source mode

This mode requires a manifest of legitimately accessible published source/adaptation documents: URLs, attribution evidence, raw/text hashes, exact codepoint spans, original-work/variant families, rights metadata, and explicit unreviewed semantics. No teacher text is accepted inline; it is derived verbatim from hashed external caches. Unknown licenses are recorded as unknown, not permission. Full protected texts, models that may memorize them and detailed candidate outputs stay outside the repository; public metadata or examples require a separate scope/rights check.

```sh
.venv/bin/python -m research.statistical_generation documentary-audit --manifest /private/paired-spans.json
.venv/bin/python -m research.statistical_generation documentary-split \
  --manifest /private/paired-spans.json --seed documentary-20261006-v1 --out /private/frozen-split.json
.venv/bin/python -m research.statistical_generation train-documentary \
  --manifest /private/paired-spans.json --split /private/frozen-split.json \
  --tools /external/tool-cache/toolchain.json --out /private/model
.venv/bin/python -m research.statistical_generation --repo /frozen/baseline evaluate \
  --model /private/model --out /private/comparison
```

`alignment.refine_manifest` optionally subdivides large documented windows with monotonic lexical matching. Its comparison-only normalization does not change source/target teacher strings; every resulting pair is an original document slice. Scores and assistant window selection are alignment evidence, not semantic labels. Source versions, correspondence and speaker attribution can still be uncertain. Whole original works, all variants and normalized duplicate pairs stay together across train/dev/test.

## Reproduce on Linux x86_64

Use the repository's Node 24 / Python 3.11 pinned environment. Its existing SudachiPy and SudachiDict-core packages provide the research tokenizer; no new Japanese parser is installed. The native tools are optional and remain outside the repository. Tool-cache and model directories must use absolute ASCII paths containing only letters, digits, `/`, `_`, `.`, and `-`; spaces and shell metacharacters are rejected because upstream Perl tooling constructs shell commands internally.

```sh
bash research/statistical_generation/build_dependencies.sh /absolute/external/tool-cache
.venv/bin/python -m unittest research.statistical_generation.test_statistical_data research.statistical_generation.test_statistical_pipeline research.statistical_generation.test_statistical_review research.statistical_generation.test_statistical_csv -v
.venv/bin/python -m research.statistical_generation audit
.venv/bin/python -m research.statistical_generation smoke \
  --tools /absolute/external/tool-cache/toolchain.json \
  --out /absolute/new/mechanical-smoke
```

The independent smoke dataset is a programmatic symbol mapping (`ax→az`, etc.), explicitly **not Japanese, not human data, and not Buront quality evidence**. It exercises the actual fast_align, atools, Moses extractor/scorer/decoder, and KenLM executables. It cannot be imported as human teachers or summarized as human quality results.

The pinned bootstrap requires ordinary Linux build tools and zlib development headers, uses no sudo, verifies upstream commits and archive checksums, records binary/helper hashes and any compatibility patches, and refuses unexpected source changes. It has not been validated on native Windows/macOS. WSL/Linux is the current research route. See [dependency provenance](dependencies.lock.json) and [build notes](DEPENDENCIES.md).

## Optional manually annotated mode

1. Copy the blank batch or export another bounded batch
2. A human verifies attribution/context and writes the ordinary-Japanese side, without LLM text or baseline-output teachers
3. Human review explicitly confirms correspondence and known duplicate families. The same person may author and review; this is not presented as independent review
4. Import and freeze split before training or decoding held-out inputs

```sh
.venv/bin/python -m research.statistical_generation export-annotations --out /new/blank.jsonl --limit 12
.venv/bin/python -m research.statistical_generation split \
  --pairs /completed/human-pairs.jsonl --seed study-001 --out /new/frozen-split.json
.venv/bin/python -m research.statistical_generation train \
  --pairs /completed/human-pairs.jsonl --split /new/frozen-split.json \
  --tools /absolute/external/tool-cache/toolchain.json --out /new/model
.venv/bin/python -m research.statistical_generation decode \
  --model /new/model --source '人が用意した未知入力' --out /new/decoded.json
npm run build
.venv/bin/python -m research.statistical_generation evaluate \
  --model /new/model --out /new/comparison
```

### Workbook CSV intake

The optional full-context starter pack is kept local rather than duplicated in this PR. Generate a local template with `export-annotations` above. A companion workbook can be exported from its `入力` sheet as UTF-8 CSV, preserving its exact 17 headers and immutable pair/source columns. Then merge it without editing JSON IDs:

```sh
.venv/bin/python -m research.statistical_generation import-csv \
  --template /new/blank.jsonl \
  --csv /completed/input.csv --out /new/human-pairs.jsonl --report /new/import-report.json
```

Only explicitly filled human author/reviewer identities, literal `human` types, and all seven `はい` confirmations are accepted. Blank/`いいえ` rows are excluded with field-specific reasons; zero approved rows writes only the report, not a training file. Unknown booleans, changed originals/IDs/URLs, and duplicate rows fail. Additional same-family IDs use one per line. No workbook entry is silently promoted to human approval.

`evaluate` sends exactly the same frozen test ordinary text to both the actual current structured baseline and Moses. It saves complete candidate pools, the baseline's displayed candidates, protected-fact diagnostics, trace/evidence, a score/method-blinded blank review file, and a separate origin map. The input's reference target does not enter generation, LM fitting, ranking or automatic quality scoring. No development labels are inferred.

A person fills `meaning_preserved`, `buront_style_good`, and `readable` for candidates in a copy of `review.blank.json`, supplies their identity and the explicit no-LLM declaration, then runs:

```sh
.venv/bin/python -m research.statistical_generation summarize-reviews \
  --comparison /new/comparison --reviewed /completed/review.json --out /new/human-summary.json
```

Only fully reviewed input pools enter the descriptive denominator. A success requires a research-only text, no hard diagnostic rejection, and affirmative human judgments on all three dimensions. Blank, incomplete, nonhuman, altered-content, or mechanical-fixture records cannot become quality success. The report is personal human evidence with group-dependence cautions, not a calibrated safety score, significance claim, or generalization guarantee.

## What actually learns and generates

- Reversible Sudachi surface tokens retain original Unicode and whitespace, encoded losslessly so Moses metacharacters cannot be interpreted as model syntax
- Numbers, quotations, opaque strings and detected proper nouns are protected with occurrence-specific placeholders; training targets must preserve their inventories
- Genuine `fast_align` forward/reverse training, then `atools grow-diag-final-and`
- Official Moses `train-model.perl` steps 4–9: lexical weighting, phrase extraction/scoring, configuration. A separate official `extract --IncludeSentenceId` pass links phrases to training rows. Its sentence-ID format is not fed to the scorer
- Genuine KenLM trigram model fits **training targets only**, using documented discount fallback for sparse counts, then builds a binary model
- Moses runs with distortion limit 0, untuned default weights, distinct n-best capped at 30. Decoding copies OOV tokens. This bounded first test deliberately suppresses large reordering
- Every used phrase records input/output token ranges, original Unicode source span, supporting training pair IDs/source references, or explicitly identified copy/untraced status
- KenLM's raw and length-normalized log probability/OOV values are reported as local likelihood, never semantic/style quality. S/Q remain null

The implementation does not contain its own replacement phrase extractor or decoder. The only phrase indexing reads the official extractor's sentence IDs for provenance.

## Integrity and uncertainty

Schema v1, model `moses-human-parallel-research-v1`, feature schema `moses-kenlm-surface-diagnostics-v2`, tokenizer/parser dependency versions, source data, frozen split, training files, alignments, model files, implementation and executable hashes are recorded. Changing relevant code, tokens, binaries or model bytes invalidates replay rather than silently pretending the same experiment ran. Model directories are local research artifacts, are path-bound by Moses configuration, and should be rebuilt rather than copied to another location.

The split uses connected components for original posts, quotation variants, known leakage groups, exact normalized duplicates, known near-duplicate families and reviewer-supplied additional families. Train/dev/test membership is bound to all imported row bytes. Known variants cannot cross partitions. Unknown semantic duplicates still require human review. Three independent components meet a plumbing minimum only; no sufficiency claim follows. A target LM trained on additional raw logs would need equivalent held-out-family exclusion and is not enabled here.

Placeholder loss, duplication/order changes, literal reinsertion, numbers/quotes/opaque inventories and detected proper-name mismatches are hard diagnostic failures. Inputs consisting entirely of protected content/whitespace cannot acquire new outside content. This last diagnostic was added after inspecting the first documentary trial and is disclosed as post-exposure. Polarity/modal/conditional surface cue differences are review warnings. Such detectors have false positives and false negatives; they do **not** prove subject/object, quantity attachment, scope, time, causal relation, attribution, politeness or meaning equivalence. An unflagged candidate is still `needs_human_review`, never `passed`.

The research pool remains inspectable outside the closed registry, so unfamiliar learned phrases are not rejected merely for lacking a handwritten rule. Untraced non-copy phrases and protected-fact failures are marked separately. The default generator, source/quantity/polarity/modal/quote safeguards, selector, and fallback remain unchanged. The comparator uses the baseline’s supported `blend` mode and fails on `unsupported_generation_mode`; the initial `invent`-mode baseline coverage report was invalid and is explicitly superseded. There is no automatic model activation, production switch, merge or deployment.

## Decision after human comparison

First establish whether the candidate pool contains genuinely new, useful meaning-preserving transformations on frozen unseen inputs. If it does, collect appropriate human ranking evidence before considering LightGBM. Add KNP only for diagnosed parsing/role failures or Pynini only for diagnosed connection/control failures. Installing libraries and passing software tests are not acceptance evidence.
