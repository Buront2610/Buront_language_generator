# Independent structural v2 review

Date: 2026-10-06 UTC. Status: final independent regression and repair checks pass. No unresolved safety blocker found in the reviewed probes. This is an engineering review, not human S/Q evaluation or a style-quality pass.

## Scope and isolation

- Reviewed planner, recognizer, grammar recipes, structural verifier, source/evidence rendering, output verifier, contracts, locking and replay in `Buront_language_generator`
- Read the original-log reread and typed-rhetorical-generation documents. Did not inspect sealed28 or derivatives. This review's probes are now known regressions
- Wrote only `test/v1/structural-v2-independent-review.test.js` in the repository. No core edits, builds, commits or publication by this reviewer
- Ran 107 exploratory probes in two batches, 15 causal/purpose probes, and targeted repair rechecks. Persistent suite: 12 top-level tests covering dozens of source cases plus program/output mutations
- Reviewed snapshot for the 12/12 standalone pass: `59e92db20f2688cc77eade171432a663085f9d7dba00884c5c2d388fd8265e21`
- Command: `node --test test/v1/structural-v2-independent-review.test.js`; result 12 passed, 0 failed, 0 skipped, 6.415 seconds. Log: `/tmp/structural-v2-independent-final.log`

## Findings

### F1. Medium: passive/causative negative past accepted malformed grammar. Repaired and regression passed

Exact original probe:

- Input: `雨が降っていたので、彼に叱られませんでした。`
- Accepted output before repair: `彼に叱られませんだった。何故かというと雨が降っていたからだ。`
- Second input: `雨が降っていたので、仕事をさせられませんでした。`
- Accepted output before repair: `仕事をさせられませんだった。何故かというと雨が降っていたからだ。`

`validateStructural` returned true. The fallback copula conversion treated unresolved verbal `でした` as nominal `だった`. Both generator and verifier reused the flawed grammar recipe. Integration repaired passive auxiliary inflection and added a fallback guard. My new regression detects the malformed hybrid and any plain positive promotion; unsupported analyses may safely abstain.

### F2. Medium: productive lexical potential bypassed the conservative nominalization contract. Repaired and regression passed

- Input: `雨が降っていたので、私は休めませんでした。`
- Accepted output before repair: `雨が降っていたから私は休めなかったという事実。`
- Other exact probes: `水が増えたので、私は泳げます。`; `水が増えたので、私は泳げました。`; `道が塞がったので、私は通れませんでした。`; `収入が減ったので、家賃を払えませんでした。`; `電池が入ったので、この装置は使えます。`; `練習したので、私は勝てます。`; `練習したので、私は長く走れます。`; `電車が止まったため、私は行けませんでした。`

All could previously use fact nominalization because an example-sized potential vocabulary missed their productive lower-ichidan forms. This did **not** demonstrate potential→completed-event textual promotion: the potential wording survived. It violated the stated policy that potential/future claims only use modality-preserving explanation. Integration now conservatively treats lower-ichidan clauses as modality-preserved; all nine probes obey the gate. This deliberately withholds some nominalizations for ordinary non-potential lower-ichidan verbs too.

### F3. Medium: na-adjective copula omission reported by integration. Repaired and independently rechecked

Integration independently found `料理は苦手ですけど、夕食を作れました。` producing `料理は苦手が、夕食を作れた。`, and `この店が便利ですから、私はここを選びました。` producing an accepted `便利から` reason. GiNZA's broad ADJ tag includes na-adjectives, so dropping `です` for every ADJ is unsound. Final independent checks confirm `苦手だ`, `便利だから`, `安全だから`, `元気だから` and `不得意だ`, while i-adjective `高い` retains no added copula. All nine targeted repair probes were valid; the final passive outputs are `彼に叱られなかった。何故かというと雨が降っていたからだ。` and `仕事をさせられなかった。何故かというと雨が降っていたからだ。`

### F4. Low, evidence limitation: distinct modesty posts are not independent quality validation

All 14 registered operator evidence snippets were found in `artifacts/fulltext-analysis-20260921/posts.jsonl` and correspond to corpus posts. Exact reference text is hash-checked by the verifier, and mutated references are rejected. Historical speaker identity remains explicitly unverified.

The three modesty evidence records share `leakageGroupId=leakage_6c2b149cd8f5dc00`. The complete third post (`post_01690_01eabacc0c5882f8`) is only `それほどでもない`, with no accomplishment relation in its own text. The other two full posts support modest self-presentation alongside rank/possession/praise at raw lines 5779–5783 and 7150–7154. They do not independently demonstrate every ordinary completed-deed template. Distinct post IDs and exact snippet identity should not be reported as independent stylistic validation.

## What resisted the attacks

- Verifier does not call the planner. It re-recognizes source relations, matches the complete relation, regenerates constrained recipes, checks role coverage, program/node hashes and source-bound local edits. It does not accept serialized condition/intent/role claims as proof
- Edited source hash, attribution, modality, target role, piece span, context coverage, grammar text, evidence order, schema version and unknown properties were rejected after rehashing
- Output text and output-source spans were independently reconstructed. Astral `🦀` prefixes retained scalar offsets and exactly one copy. Forged output spans failed
- Signed/decimal/compared values remained in the correct roles: `1.5kg`, `-5℃`, `3人以下しか`, `10人以上`, and `A社がB社より2倍`
- Quoted, hearsay, conditional and negative context stayed literal: `「彼は来る」と聞きましたが、…`; `彼は賛成したと言ったが、…`; `条件を満たせば賛成するが、…`; `私は説明を聞いていないが、…`; `私は説明を聞いたと思うが、…`
- Nominal/adnominal targets retained full negation, attribution and uncertainty; `太郎が犯人かもしれない根拠…` remained mentioned and literal, not asserted
- Extra request recipients (`太郎に`, `私に`), deadline (`明日`), count (`一つだけ`), negative request and temporal `まだ` variants abstained rather than dropping constraints
- Changed/coordinated self-achievement actors, failed deeds, intentions and conjectured completion abstained. `太郎が来たので、花子は帰った。` preserved both explicit actors
- Causal/purpose counterexamples all abstained, including `家族が安全であるために、防犯設備を整えました。`, `部屋が清潔であるために、毎日掃除します。`, and `誰にも見えないために、物陰に隠れました。`; past causal controls still generated
- Current replay reproduced accepted candidates. Old-version, attribution-forged and invented-text locks were rejected. Tampering with final candidate text was caught during final semantic verification and removed from selection

## Remaining limitations and interpretation

Planner independence is not independence from the recognizer and grammar library: generator and verifier deliberately share these. F1/F3 demonstrate why adversarial language probes are still needed despite all program proofs passing. The verifier establishes membership in the bounded registered transformation language; it is not a general semantic equivalence or Japanese grammar oracle.

The output is genuinely source-bound composition, including evidence-question syntax mixing and clause split/reordering, rather than arbitrary invented events. However, many modesty outputs simply exchange the order of bland source clauses; broad competence recognition adds coverage, not inherently stronger Buront style. Full original-log mechanisms such as self-serving evidentiary reinterpretation, escalating argument and dialogue payoff are not established here. Provenance, output count, top-three inclusion and test totals cannot replace style/naturalness assessment. S/Q remains null; this report adds no invented scores.

Raw exploratory probes/results are at `/tmp/structural-v2-{inputs,inputs2,tame-inputs,recheck-inputs}.json` and `/tmp/structural-v2-{probe-results,probe-results2,tame-results,recheck-results}.jsonl`. They predate or cross repairs as described above and are diagnostic history, not final holdout evaluation.

Final grammar recheck record: `/tmp/structural-v2-recheck-final-results.jsonl`. These nine rechecks and the 12-test suite ran after the final copula repair; the earlier exploratory records intentionally retain the original failures.
