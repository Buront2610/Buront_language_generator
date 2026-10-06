# Official statistical generation dependencies

This experiment uses the actual upstream **fast_align**, **Moses**, and **KenLM** executables. It does not substitute a handwritten phrase scorer, aligner, language-model estimator, or decoder and label it as one of those libraries. The Python/shell layer orchestrates the official programs and records their artifacts.

## Sources and licenses

Exact Git commits and archive SHA-256 checksums are in `dependencies.lock.json`. Upstream source and documentation were checked on 2026-10-06:

- [fast_align](https://github.com/clab/fast_align), Apache-2.0: `fast_align` estimates word alignments in each direction; `atools` symmetrizes them
- [Moses](https://github.com/moses-smt/mosesdecoder), LGPL-2.1 with bundled component notices: official `train-model.perl`, phrase `extract`, `score`, `consolidate`, and `moses` decoder
- [KenLM](https://github.com/kpu/kenlm), LGPL-2.1-or-later with file-specific exceptions enumerated in `LICENSE`: `lmplz`, `build_binary`, and `query`
- [Boost 1.74.0](https://archives.boost.io/release/1.74.0/source/), BSL-1.0: local static development libraries used by Moses and KenLM
- [bzip2 1.0.8](https://sourceware.org/bzip2/downloads.html), BSD-style bzip2 license: local compression library required by Moses/Boost iostreams
- [Kitware CMake 3.31.6](https://github.com/Kitware/CMake/releases/tag/v3.31.6), BSD-3-Clause plus bundled notices: pinned Linux x86_64 build tool

The cache preserves complete upstream sources and license files. This research change does not distribute dependency binaries or vendor their source into the application. Check upstream notices before separately redistributing binaries, especially statically linked components. These are source/license observations, not legal advice.

## Build

Requires Linux x86_64, GCC/G++, Make, Perl, Python 3, Git, curl, tar/bzip2, and zlib development headers/library. No sudo, system configuration changes, package-manager installation, external model endpoints, or credentials are used. The script downloads official sources/build tools and compiles into an external cache:

```sh
JOBS=2 bash research/statistical_generation/build_dependencies.sh /absolute/path/outside/repository/buront-statistical-tools
```

Cache paths must be absolute and contain only ASCII letters/digits, underscore, dot, slash, and hyphen. The upstream Perl/shell helpers interpolate paths internally, so whitespace and shell metacharacters are rejected.

Default cache: `$BURONT_STATISTICAL_TOOLS` if set, otherwise `$HOME/.cache/buront-statistical-tools`. The first positional argument overrides it. Build logs are at `CACHE/logs/`; source caches at `CACHE/src/`; invocation paths are recorded in `CACHE/toolchain.json`. Rerunning uses the same pinned source and incremental builds. Changed commits or undocumented tracked source modifications are rejected rather than reset. For a different compiler, toolchain, or Boost source state, choose a clean cache.

The manifest includes actual executable paths, upstream commits, executable SHA-256 hashes, compiler identity, lock/script/patch hashes, and UTC build time. A successful build is **not** a passed model-quality evaluation. A mechanical integration fixture verifies wiring separately.

The tested build uses GCC 14.2.0, locally built Boost 1.74.0, release compilation, two concurrent jobs, no optional XMLRPC server/tcmalloc/libsegfault, and KenLM interpolation disabled. Moses keeps its upstream C++11 build setting. The first Moses link exposed that Boost iostreams must include bzip2 support even for this plain-text/gzip workflow. The recipe therefore builds official bzip2 locally before Boost and passes local include/library paths through the build environment. Optional `.xz` support is disabled by absent headers; no Moses source patch is needed for bzip2.

## Pipeline contract

1. Tokenized source and target sentences form `source ||| target` lines for official `fast_align -d -o -v`, repeated with `-r` for reverse alignment
2. `atools -c grow-diag-final-and` produces Pharaoh alignment pairs
3. Target-side training text feeds official `lmplz`; `build_binary` creates the queryable language model
4. Official `train-model.perl --first-step 4 --last-step 9` consumes the existing corpus/alignment, estimates lexical probabilities, extracts phrases, scores them in both directions, consolidates the table, and writes a Moses configuration
5. Official `moses` performs phrase-based decoding; official KenLM queries can independently record LM scores

`train-model.perl` locates binaries in the `bin` directory alongside its upstream `scripts` directory. The build script therefore retains that directory layout. Its obsolete `--bin-dir` and `--scripts-root-dir` flags are ignored by this pinned version and must not be relied upon.

## Phrase provenance and n-best output

The official extractor accepts `--IncludeSentenceId`, not `--SentenceId`. Run it **separately** with the same source, target, alignment, and phrase-length setting to produce provenance records. The forward extraction receives a fourth `|||` field containing the **one-based corpus line number**. Map that line to the immutable training-row manifest. Do not add that field to the ordinary scoring pipeline: absent specific domain-feature options, the scorer treats the fourth field as a count, which would corrupt training weights.

Decoder flags supported by the locked source:

- `-n-best-list FILE N distinct`
- `-include-segmentation-in-n-best`
- `-print-alignment-info-in-n-best`
- `-report-segmentation` / `-report-segmentation-enriched` for one-best output

Use the upstream-generated feature configuration and actual emitted n-best fields rather than inventing score positions. Conservative experiment settings such as distortion limit zero are research configuration choices, not changes to Moses algorithms.

## Mechanical fixtures

Any machine-generated ASCII symbol fixture is only for dependency/integration testing. Symbols such as `s0 s1 s2` and `t0 t1 t2` do not represent human-authored translation pairs, Japanese paraphrases, Buront-language examples, or quality judgments. They must not enter a research training corpus or support claims of generalization or language quality. A tiny fixture may use KenLM's explicit `--discount_fallback`; this is disclosed because it changes discount estimation when count-of-counts statistics are insufficient.

## Verified execution on 2026-10-06

The checked-in build script completed successfully in the external cache on GCC 14.2.0. All three upstream source trees had no tracked source edits; no compatibility patches were required. The receipt contains ten executable hashes, 110 training/generic helper-file hashes, and hashes for the available system utilities used by the Perl orchestration. Upstream compiler deprecation warnings remain; the complete upstream test suites were not run.

A separate cache-only mechanical fixture used all 64 length-three combinations of the symbols `s0`…`s3`, mapped by index to `t0`…`t3`. Genuine forward/reverse alignment, symmetrization, trigram LM estimation, binary LM creation/querying, official lexical/phrase training, phrase scoring/consolidation, decoding, segmented n-best output, and sentence-ID extraction all ran successfully. `s0 s1 s2` decoded to `t0 t1 t2`; KenLM returned finite scores and zero OOVs. This verifies integration only. It is not Japanese/Buront training data or an unseen-language-quality evaluation.

Operational details verified during that test:

- Create `ROOT/model` before invoking `train-model.perl --first-step 4`; earlier skipped steps normally create it
- Set `-distortion-limit 0` at **decoder invocation**. This upstream training script ignores zero in its truthiness check and otherwise leaves the generated configuration at its default
- The fifth n-best field contains source-to-target phrase ranges such as `0=0 1=1 2=2`, and the sixth contains word alignments when the requested flags are enabled
- If `-report-segmentation` is also enabled, the hypothesis text can include inline segmentation markers; consumers should parse the enabled output format explicitly
