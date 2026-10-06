# Independent B3 role-boundary review

Date: 2026-10-06 UTC. Status: final bounded revalidation passes after causal-negation and composition repairs; no remaining meaning blocker observed in the reviewed set. This is an engineering safety/contract review, not a human S/Q evaluation or a style-quality pass.

## Scope and isolation

- Read the original-log reread, previous independent B2 report, recognizer, grammar/scopes, operator recipes, new evidence-carrier binding, schemas, structural verifier, output verifier, locking and replay
- Edited only my new `test/v1/structural-v3-independent-review.test.js` in the repository. No core files, existing tests, builds, commits or publication by this reviewer
- Selected 235 distinct varied development probes across the original, resumed and bounded causal-negation review. These are now known regressions; no new sealed dataset or human evaluation was created
- Raw probe scripts, inputs and results are outside the repository at `/tmp/structural-v3-review-*`
- Reviewed initial coherent build `f89a9a6c09d9b0e5c43dde630db492fef12e6a9c7d51429c0624061dd9c2c592`; repaired recheck snapshot `5463835574a3aa55f3d7aae209fd3e3958d2685462d6bf9c09ba8d133ea6a741`
- Final bounded independent snapshot: `5a302a2cef8c11a54a9322a7157348db2279860e5cb7af0ea77d7f1ee9c27428`; build record unchanged before/after validation. Earlier b5cb and 7c31be2 results are interim and superseded
- Final command: `node --test test/v1/structural-v3-independent-review.test.js` → 23 passed, 0 failed/skipped, 11.368 seconds. Log: `/tmp/structural-v3-review-bounded-tests.log`
- Final bounded probe replay: 235 distinct inputs; 90 produced 193 structural plans, every generated plan passed structural, full-candidate and role-local quantity proofs. These deliberately mixed probes are not a coverage estimate
- The initial 126-probe batch and 24 additional probes include fresh domains/verbs, nested subjects/evaluations, quoted/reporting speech, desires/plans, productive ability, source direction, carrier modifiers/conditions, protected values, passives/causatives and nominal-adjective morphology

## Findings and repairs

### F1. High: productive potential was rewritten as performed action. Repaired and independently rechecked

Exact initial input: `時間があったので、私はググれました。`

Accepted output: `私はググった。何故かというと時間があったからだ。`

`validateStructural` returned true and full candidate proof passed. GiNZA analyzes the e-row `ググれ` as lemma `ググる`, godan hypothetical morphology. The generic polite inflector used that lemma as an ordinary verb. The same shared grammar defect affected all four suffixes:

- `ググれます` → `ググる`
- `ググれました` → `ググった`
- `ググれません` → `ググらない`
- `ググれませんでした` → `ググらなかった`

This is actual meaning loss, not merely inaccurate metadata. Integration now binds ambiguous e-row polite morphology generically, preserves the source potential stem through all suffixes, and excludes fact nominalization. The four corresponding regression probes pass. Ordinary lower-ichidan verbs are conservatively classified as modality-unresolved rather than all being claimed as proven lexical potentials.

### F2. Medium: common-noun, embedded and dative evaluands licensed self-assessment. Repaired with paired independent controls

Exact inputs:

- `弟の話し方は未熟ですが、私は説明を終えました。`
- `先生の発音は未熟ですが、私は説明を終えました。`

Both initially generated and passed as `modest-self-presentation`, although the assessed person was not the narrator. Their text retained the participants, so this was a role-license error rather than textual actor replacement. The first named-person guard missed common-noun possessors.

The core owner then found an important defect in my initial test isolation: several refusals used matrix `話した`, which triggered an unrelated reporting-verb guard. Those zero-output results did not establish correct assessment ownership. Unmasked ordinary-matrix probes exposed additional cases:

- `弟は未熟ですが、私は説明を終えました。`
- `私の弟は未熟ですが、私は説明を終えました。`
- `弟は料理が苦手ですが、私は説明を終えました。`

Resumed independent probing with generating controls found further degree/dative scope errors:

- `弟は得意というほどではないが、私は説明を終えました。`
- `私は弟が得意だとは言えないが、説明を終えました。`
- `私は弟が得意だと言えるほどではありませんが、説明を終えました。`
- `弟に自信があるわけではないが、私は説明を終えました。`

A first-person speaker in a metalinguistic wrapper cannot authorize a different embedded evaluand. The repaired binding checks the evaluation heads and their own subject/experiencer relationships, including lexical complement heads that the parser does not expose as separate proposition scopes. It no longer assumes every generic noun is a skill domain. The final suite pairs all nine ordinary actor refusals and four degree/dative refusals with source-matched first-person controls that actually generate and pass full verification.

This deliberately costs coverage. Syntax alone does not distinguish `数学は苦手` from `弟は苦手`; first-person possession does not prove identity (`私の話し方` versus `私の弟`). Untyped/ambiguous domains may abstain. Direct first-person ownership, parser-typed action nominals and grammatical nominalized activities provide bounded licenses without a person/topic fixture list.

The token-global polarity attacks also remain withheld with ordinary non-reporting matrix actions: mentioning a novice in an unrelated clause, remembering being inexperienced, positive expertise with embedded negation, and denying that one is a novice cannot license limited self-competence.

### F3. Medium: embedded causal judgments were certified as asserted facts. Repaired and independently rechecked

Exact input: `彼が犯人だと判断するのは早すぎたので、調査を続けた。`

The output retained the full qualification, but the original relation proof marked the predicates `犯人` and `判断` as asserted causal propositions. The source only asserts that such a judgment was premature. The outer qualifier cannot license `彼が犯人だ` as an asserted fact. Integration now assigns embedded-description/mentioned/embedded-scope roles to nested causal material and prevents form edits or local rewrites inside those scopes. The fresh regression passes; the transformed qualification remains intact.

### F4. Medium: negative verification desire licensed affirmative evidence purpose. Repaired and independently rechecked

Exact input: `この橋が安全か確かめたくないので、点検表を見せてください。`

Initially accepted as a carrier-evidence request, despite the explicit negative desire. The full output retained `確かめたくない`, so it did not invert textual negation, but the cue recognizer incorrectly claimed an affirmative verification purpose. The parser assigned the negative adjective outside the verification predicate's associated chain. Integration now checks dependency-linked negative modifiers. Present, past and contrastive negative-desire variants all abstain. A source-matched pair now makes this diagnostic: `在庫が減ったという話を確かめたいので、検品記録を提示してください。` generates, while `確かめたくないので` and `確かめたくなかったので` versions refuse. An affirmative `安全か確かめたいので` variant still conservatively abstains because the parser lacks a separate target predicate scope; this is disclosed under coverage limitations.

### F5. Medium: initial recipient/conditional clauses could be swallowed into the carrier. Repaired and independently rechecked

Initial recipient case: `太郎に、この橋が安全だという根拠になる昨日の記録を見せてください。`

Output placed `太郎に` inside the postposed object region. The parser's attached NP hull was not reliable evidence that an initial recipient belongs to the carrier. Integration repaired this with conservative refusal for ambiguous comma-initial adjunct attachment. A clear recipient attached to the request remains accepted and is preserved with its action.

Further conditional case found after that repair: `太郎が来たら、この橋が安全だという根拠になる記録を見せてください。`

Accepted output: `見せてくれるか、太郎が来たら、この橋が安全だという根拠になる記録を。`

The conditional was swallowed into the moved carrier, placing the request before its source condition. The text is retained, but that alone does not establish ownership or preservation of the conditional speech act. Integration added a conservative leading-conditional boundary guard, while entirely quoted targets retain their literal scope. This exact probe now abstains. The new independent test permits only an unchanged leading condition or abstention, and passes.

### F6. Integration-found reporting and legacy request regressions. Independently rechecked after repair

The broader aggregate suite found that an intermediate global quotative-particle change had lost reported attribution in `田中が確認したと佐藤が言った。`. That defect was outside my first 150 probes. The repaired shared scope logic restores hearsay attribution and the source speaker. The final independent suite verifies both `言った` and `報告した` variants and resolves the attributed entity to `佐藤`.

Separate style/integration review identified legacy explicit request actions being replaced by mere existence questions. Final independent terminal probes verify action retention through `教えてください`, `教えてほしい`, `教えてほしいです`, `教えてもらえますか`, `教えていただけますか`, and causative inspection-permission equivalents. The output still asks for teaching/presentation or permission to read. Source existence questions retain their separate existence mechanism; unsupported actionless desire, negative/desiderative-past/reporting terminals conservatively abstain.

The final suite also verifies that nonpast future claims (`翌日出発します`, `お昼に買います`) cannot use fact nominalization. These are explicit repaired regression checks, not a claim that every Japanese modality is recognized.

### F7. High: negation of a causal explanation was decomposed into negation of the claim. Repaired and independently rechecked

Independent style review surfaced this inherited blocker on the official known-case comparison, after the 7c31be2 standalone/aggregate passes:

- Source: `理由が分からないので反対しているのではありません。費用が増えると分かっているので反対しています。`
- Accepted output began: `反対しているのではない。何故かというと理由が分からないからだ。…`

The source denies that ignorance is the reason for opposition, then states the actual reason. The output instead denies opposition. This is actual semantic corruption despite retained words and passing shared structural/candidate proofs.

A bounded independent sibling also reproduced the defect: `料金が高かったため、私は帰ったのではない。` generated `私は帰ったのではない。何故かというと料金が高かったからだ。` with all proofs passing. Several other explanatory-negation shapes already abstained; those zeros alone are not proof of a complete fix.

The added family pairs each wide-negation input with a source-matched ordinary negative claim or positive trailing explanation that demonstrably generates. It also requires the safe negative reason `私が逃げたのではないため、彼は謝罪した。` to remain supported, so the fix cannot be a token-global ban on `のではない`. U29's affected first span now remains exact while its independent second explanation transforms. All six positive paired controls generate, the wide-negation cases abstain from causal transformation, and the safe negative reason remains supported. The source-generic guard checks matrix explanatory-negation scope, including direct-AUX and fixed-chain copula parses; independent validation also prevents local rewrites of the unresolved sentence.

One bounded composition check also verifies that a new carrier request does not consume an independently transformable preceding causal sentence. Both isolated sentences are verified positive controls; the repaired combined plan contains two nonoverlapping relation blocks. Current-request-sentence ownership no longer consumes and suppresses the preceding causal transformation.

## What resisted the attacks

- Fresh generic past verbs and domain topics generated valid source-bound plans without any accomplishment whitelist; failures such as breaking a vase or losing a match were not rewritten into success or praise
- Third-person/coordinated matrix actors abstained. A different actor inside a literal relative-clause description did not become the matrix actor
- Reported, quoted, desired, planned, conjectured, failed and commanded events did not become completed self events
- Nested self-assessment content stayed literal and mentioned rather than becoming independent autobiographical assertions
- Known lexical potentials and nominalized `ことができる` retained ability wording; passive/causative negative past and na-adjectives retained grammatical negation/copulas
- Causal/purpose counterexamples abstained. Trailing causes retained original direction, negative claims and ability modality
- New carrier requests retained the source-requested reading permission or presentation action, complete NP, conjunctions, recipient, count, provenance and source purpose; they were not converted to an existence question that lost the requested inspection
- Full quoted targets and `3人以下`, `1.5kg以下`, `-2.5℃`, `一つだけ` stayed literal. Whole quoted/reported requests did not become narrator requests
- Negated, uncertain or denied evidence links and compound/negative request actions abstained rather than dropping sequence or prohibition
- Rehashed event IDs, actors, completion tokens, target/action/carrier/case spans, cue tokens, nested condition roles, attribution, evidence order and fake praise were rejected after relation-ID and plan-ID recomputation
- Strict schemas rejected obsolete versions and invented metadata. The verifier re-recognized all roles from immutable source IR rather than trusting serialized annotations
- Signed/decimal quantities and astral scalar spans remained role-local invariants. Forged output-source spans failed
- Current locked replay reproduced candidates exactly; stale-version and target-forged locks failed. A post-generation invented evidence claim was removed by final verification. S/Q remained null

## Interpretation and remaining limitations

The verifier is independent of the planner, but it intentionally shares the recognizer and grammar library. F1 and F7 are concrete examples of meaning-changing shared grammar/scope defects passing every original proof. F2–F5 show why literal character coverage alone is not a sufficient role-ownership proof; F2 also shows why negative probes need generating matched controls rather than confidence from zero outputs alone. Adversarial linguistic checks remain necessary.

This review checks bounded source preservation in the stated cases; it does not establish general semantic equivalence, naturalness or Buront style quality. Corpus snippets can attest grammatical components without proving that the combined output has the desired voice. Ordinary concession splitting or unchanged clause order plus ending changes is not automatically evidence of strong body-level rhetoric. No human S/Q or style-quality pass is asserted.

Some examples conservatively abstain: unsupported request actions, unclear target scopes, future/time modifiers attached ambiguously, whole purpose/sequence ambiguity, and different actors. Both ordinary loss events and successful actions can satisfy the generic completed-event relation; no favorable outcome is implied by that metadata.

## Final artifacts

- Persistent test: `test/v1/structural-v3-independent-review.test.js` (23 top-level tests)
- Final bounded test log: `/tmp/structural-v3-review-bounded-tests.log`
- Final diagnostic inputs: `/tmp/structural-v3-review-final-bounded-inputs.json` (235 distinct sources)
- Final bounded results: `/tmp/structural-v3-review-bounded-results.jsonl`
- Final bounded build records: `/tmp/structural-v3-review-bounded-build-before.json` and `/tmp/structural-v3-review-bounded-build-after.json`
- Original/extra/resumed/degree/causal-negation inputs and intermediate results remain at `/tmp/structural-v3-review-*` for diagnostic history. Files named `final-results`/`final-tests` or `corrected-results`/`corrected-tests` are superseded intermediate runs; only the latest `bounded` result files represent this final snapshot

The repository-wide aggregate suite and official known-case comparison belong to integration/evaluation and are not claimed by this independent report. This report corrects the interim masking oversight explicitly; it does not convert earlier zero-output cases into evidence they never provided. No prospective sealed dataset or derivatives were read. Review expansion stops at the existing 235-case bounded set.
