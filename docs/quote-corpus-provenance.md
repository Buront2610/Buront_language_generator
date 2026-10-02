# Quote corpus extraction and provenance

`npm run build:quotes` downloads the actual Shift_JIS source and builds schema v2.
No synthetic examples enter `data/quote-corpus.json`. Offline parser regressions
use a compact explicitly synthetic fixture:

```sh
node --test test/quote-corpus.test.js test/faithful-quote-evidence.test.js
```

`source.sha256` hashes the downloaded original bytes, `decodedSha256` hashes the
decoded HTML, and `originalLogSha256` fixes the original logs used for linking.
The source URL and hashes are retained, but the full third-party HTML page is not
redistributed. Reproducing production data requires source retrieval, or a local
capture supplied as `node scripts/prepare-quote-corpus.js /path/to/source.html`
(gzip input is also supported). Live bytes may change due to page edits or
injected hosting scripts; compare hashes before claiming identical reproduction.
The source page is https://kenkyonanight.xxxxxxxx.jp/goroku.html. Rights remain
unverified/local-only, consistent with the existing corpus.

## Distinct evidence units

- `headings`: editorial blue headings, including one-to-four-character labels
- `excerpts`: complete visible highlighted lines, including text outside inline
  bold/red markup; never a concatenation of disconnected bold fragments
- `pagePosts`: reconstructed post bodies and their displayed source headers
- `sourcePosts`: linked, unchanged whole original-log post text; source identity
  is the original `post_...` ID, distinct from the quote page's location

`sections`, `headingIds`, `excerptIds`, `pagePostId`, and `sourcePostIds` connect
these units. `emphasizedSpans` include `start`, exclusive `end`, `text`, and `style`
(`bold` or `red`); offsets count Unicode code points, so JavaScript consumers must
slice `Array.from(text)`, not UTF-16 string indices. Nested bold/red spans may
overlap because both visible styles are meaningful. Block elements and `<br>`
create visible-line boundaries; inline tags do not. Numeric entities are decoded
after markup tokenization so escaped tags remain text. This is a bounded static
parser for the legacy page; it does not execute JavaScript or external CSS.

The red/bold/black explanatory legend and pre-heading introduction are editorial
metadata. They are excluded from quote examples. All original logs remain the
positive base. An unhighlighted post is not a negative example. Family labels are
heuristic lexical cues, not gold rhetorical-function annotations. In particular,
`感謝` is a gratitude cue and the character `謝` alone is not an anger cue.

## Context confidence

All nonempty heading queries are searched, including short headings. Source
post bodies and header metadata establish nearby section context. Unique nearby
matches disambiguate short labels. `contexts` may contain provisional candidates;
`sourcePostIds` contains only a unique confident match. Check `contextMatch` and
`confidence` before promoting a candidate to established provenance. No arbitrary
four-result cutoff hides ambiguity. Missing original posts are retained as
unmatched page posts rather than fabricated originals.

## Duplicate weighting and holdout leakage

- `quoteGroupId`: typography-normalized identical visible text
- `variantGroupId` / `groupId`: identical variants plus a section heading and its
  matching emphasized realization
- `samplingWeight`: fractional record weight summing to one for a variant group;
  prefer drawing one canonical `quoteGroups` entry rather than every member
- `leakageGroupId`: connected variants and quotes from the same confidently linked
  original post; conservative `leakagePostIds` also connect ambiguous or duplicate
  text candidates without asserting provenance. Source posts share this ID, and
  grouped holdouts must use it

These are deliberately different concerns: unrelated phrases in the same post
should not necessarily be a single sampling example, but cannot cross train/test
boundaries. Typography normalization preserves quantities and negation. Automatic
semantic paraphrase clustering is not claimed.

## 2026-10-02 rebuild audit

Source retrieval succeeded: 240,539 bytes, SHA-256
`4e00cf7d842150db81c65525a10fb3bb9a78e9d7666e791ac4f7c403deaa8adf`.
The rebuilt corpus has 165 headings, 840 emphasized full lines, 846 variant groups,
401 page posts and 487 distinct originals represented for conservative holdout
linkage (400 have confident links). 155 headings have candidate
contexts (previously 141), with 161 heading-context links. Three headings remain
ambiguous. `名誉既存`, `烏合の民`, and `真骨董` now resolve from nearby context;
`○○美` is explicitly ambiguous. Two page-post occurrences do not have a unique
original match.

All 837 old non-legend excerpt texts are retained inside reconstructed full lines,
allowing only typography normalization. The two old excerpt records removed are
the red and bold legend descriptions. The black legend is excluded as well.
`data/log-corpus.json` is unchanged: 2,452 posts and 9,591 sentences. Machine-readable
audit: `artifacts/quote-corpus-audit-20261002/audit.json`.

Offline tests use an explicitly synthetic HTML fixture, separate from production
data. They cover split/nested inline tags, numeric entities, astral characters,
legend removal, nested color overrides, gratitude classification, short-label ambiguity, provenance links,
weight normalization, source-level leakage groups, and unchanged original logs.


## Runtime enforcement

Compiled assets retain the 2,452 whole original posts and 9,591 original sentences
as positive records, together with typed quote metadata and original-code-point
spans. Retrieval indexes one representative per quote variant before computing
term statistics, and does not add an identical quote as a second original-source
vote. The underlying evidence records remain available for provenance. Excluding
an original, quote alias, or leakage group excludes the whole connected holdout
group. `splitBeforeGeneration` includes quote/variant/leakage and provisional
source-post links before allocating train/validation/test groups.

The old faithful-grammar evidence check serialized all corpus metadata, which
incorrectly accepted the red legend as evidence for `確定的に明らか`. No original
log or actual highlighted quote in this source attests that complete phrase. All
six legacy renderers that emit it are now disabled when support is absent; the
remaining 30 report explicit supporting record IDs. Missing support is neither a
positive nor a negative label, and no unrelated lexeme can justify that added
formula. This is lexical-evidence checking, not a claim of trained quality scores.
