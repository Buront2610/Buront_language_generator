# Why B remains WIP after three failed prospective rounds

## Conclusion

The implementation has real, bounded clause composition, but its semantic coverage is still governed by narrow dependency shapes and handwritten licensing conditions. It has not established the broader contract of useful structural generation for ordinary Japanese in the promised reason, self-assessment/action, and evidence-request domains. **The appropriate status is WIP / failed acceptance, not completed B or ready to merge.**

The final frozen source is `66c681f3d2f48ff6bb7d218711da08be4ea948c06d6d5a861d83b2364e491092`. Freeze was 2026-10-06 05:44:14 UTC; first prospective exposure was 05:45:26.896 UTC. No changes to implementation, guards, examples, or benchmarks were made for this diagnosis.

- B1: body composition in 1/18 fresh ordinary cases
- B2: 3/18 in the pool, 2/18 displayed; 0/9 pairs covered on both sides
- B3: domain-matched body composition generated and displayed in 1/18: reason 1/6, modesty 0/6, evidence requests 0/6; 0/9 pairs covered on both sides

These are small authored prospective checks, not population estimates. Their repeated failure is nevertheless direct evidence against the claimed broad usefulness. B3's 50/54 pooled and 49/54 displayed coverage on already exposed ordinary development cases cannot substitute for it. The examples are short, ordinary Japanese within the high-level domains; their unfamiliarity is not an explanation that excuses the result.

## Where coverage is lost

**Selection/C cannot fix this result: 17/18 ordinary inputs have no matching body candidate in the pool.** Read-only re-evaluation of the frozen recognizer on the existing captured IR recognizes a relation for only two ordinary inputs: SG3-R02-A and SG3-R03-A. The latter then fails grammatical realization. These failures overwhelmingly precede selection, and the long-input budget does not apply to these short inputs.

The three strongest concrete failure paths follow. Line numbers refer to the frozen source files under `packages/core/`; the inspected checkout copies match the frozen copies.

### 1. Topical arguments are confused with actors; a connective is confused with an unresolved pronoun

SG3-M01-A:

> 見栄えのよい資料を作るのはまだ苦手ですが、私が担当した会議用の集計表は、昨日のうちに全ページの数値を確認しました。

The captured parser attaches `集計表` (token 20) as `nsubj` of `確認` (32), while `私` (13) is the subject of embedded `担当` (15). `facts.ts:26–32` maps active `nsubj` directly to `agent`; consequently fact-4 records **agent = 集計表**, patient = 数値. That is a semantic-role representation defect: the table is the topic of the checking statement, not its checking agent. The embedded first person also cannot simply be promoted into the matrix clause as a repair.

The concessive assessment itself is recognizable. Coverage is lost in `bindCompletedEvent`, `rhetorical-recognition.ts:500–522`: lines 510–517 treat every matrix `nsubj`/`dislocated` as a potential actor and reject the non-first-person table. The small `taskTopic` exception only covers a particular perfective causative result state, not this past event. This guard is appropriately refusing the deficient role analysis; weakening it would risk assigning other people's actions to the narrator.

The paired SG3-M01-B makes the matrix actor explicit: `…数値は、私が昨日確認しました。` Its IR nevertheless records both 数値 and 私 as agents. It also tokenizes `それでも` as `それ` (PRON/cc) + `で` + `も`. Two handwritten decisions compound the role problem:

- `rhetorical-recognition.ts:530–534` recognizes the contrast prefix only when its first token is CCONJ; the general discourse-marker check sees `cc`, so this source is rejected at that gate
- `grammar-scope.ts:86–89` treats any scoped `それ` as ambiguous, including this connective. The recorded confirmation fact therefore has unknown polarity, tense, and realization despite its explicit past affirmative form

This is a mix of parser-interface/IR defects and overrestrictive recognizer normalization, not evidence that the input lacks a self-assessment and completed action. Neither variant produces a structural relation. Its literal/local output is a coverage failure, not demonstrated output semantic corruption.

### 2. A shared object in coordinated requested actions is outside the implemented action contract

SG3-E01-A:

> 新しい梱包材で破損が減ったという説明について、先月と今月の配送事故記録を並べ、根拠が分かるように見せてください。

The stored dependency path is `記録(20) --obj→ 並べる(22) --advcl→ 分かる(26) --advcl→ 見せる(29)`. Fact-2 gives 並べる the patient 配送事故記録; fact-4 gives 見せる no arguments.

`evidence-request-roles.ts:242–252` can accept the final 見せる action and てください suffix. It then requires **exactly one direct noun object of that final root**, lines 253–256. There are zero, so it exits before target binding. The source's instruction to arrange and show the same records has no shared-argument/action-sequence representation for the operator to consume. Replacing a record-name whitelist would not solve this; record names are already open vocabulary.

This is principally a missing argument-sharing and coordinated-action contract. The dependency parser need not be declared wrong merely because it puts the overt object on the first action. Blindly attaching every earlier object to the final verb would be unsafe. The unchanged request remains in the output; the observed defect is failure to generate a structural candidate, not deletion of the arranging action from a generated rewrite.

### 3. The evidence target exists in discourse, but the carrier binder can only find it inside one sentence

SG3-E03-B:

> 雨の日にもこの自転車のブレーキはよく利くと聞きました。裏づけを確認したいので、雨天の制動試験報告書を見せてください。

Here the IR correctly marks 利く as hearsay and records `reported_by` to 聞く. The next sentence has an explicit 見せる action, its 報告書 object, and the verification purpose 確認したいので. The failure is not a blanket prohibition on hearsay.

The request passes the direct-object shape. In `evidence-request-roles.ts:158–165`, 確認 qualifies as a verification-purpose cue. But `bindCue` uses only the current sentence's tokens/scopes (`:74–85`). `targetUnder(確認)` finds no subordinate target proposition under that cue, and returns undefined at `:99`. No unique cue is produced at `:174–175`, so recognition stops at `:275`. The target proposition is in the preceding sentence. Lines 296–300 explicitly keep that previous sentence outside the request block; there is no separate discourse-reference binding that can refer back without taking ownership of its text.

That is a missing discourse/reference contract. Preserving the previous statement's hearsay status is correct, but it does not itself connect the later evidence request to that statement. The resulting near-literal two-sentence output is not a semantic break and is not structural coverage.

## Other independently located gaps

- **Nested plan:** SG3-R01-B (`…点検するので、…受け取るようお願いするつもりです`) has 点検 parsed as `acl` under the nominal ROOT つもり. `rhetorical-recognition.ts:245–248` requires the causal predicate to be a direct `advcl` of the root, so it rejects this shape. `grammar-scope.ts:82–90` additionally classifies つもり and its `acl` children as speculative/prospective; the inspection fact becomes unknown rather than a separately bound causal premise. This combines attachment sensitivity with insufficient separation of the reason, intended request, and embedded requested action.
- **Recognition is not realization:** SG3-R03-A does obtain `reason-claim:causal-tame`. Its claim ends in `歩くことにしました`. The captured する is AUX/fixed under こと, with ます/た attached to 歩く. `rhetorical-grammar.ts:44–49` supports AUX/aux and a special fixed できる nominalization, but not this fixed する chain. `clauseInflection` returns undefined; `embeddableClause` rejects the remaining ました at `:96–97`; `rhetorical-operators.ts:72–96` cannot realize the claim. No structural candidate reaches ranking.

## Why repeated repairs did not generalize

B1's preserved recognizer licensed a small modesty construction and a `completedDeeds` vocabulary. B2 expanded single-sentence assessments and other surface forms but retained `completedDeeds` and `assessmentTopics` (frozen B2 `rhetorical-recognition.ts:15,347–373`). B3 genuinely improved this: it removed those achievement/topic catalogs, added source-role metadata, nested literal preservation, and action-preserving evidence carriers. These are substantive changes, not just copied full-sentence outputs.

However, operators still obtain their semantic roles through narrowly prescribed dependency paths and lexical/grammatical gates. Role metadata is downstream of successful recognition; it does not supply a general normalization layer for topics versus actors, shared action arguments, nested plan/request scopes, or discourse targets. The expanded developmental successes therefore mostly establish coverage of the forms already encountered.

**Developmental overfitting** here means repeated repairs driven by exposed examples without a sufficiently general representation. It is not statistical overfitting of a learned model, nor an allegation that the final holdout was leaked or tuned after exposure. Earlier sealed failures legitimately became development regressions for subsequent rounds; their recovery ceased to be fresh evidence.

Passing 416 tests and six HTTP workloads establishes important finite functionality and operational checks. It does not establish semantic coverage or style. The verifier rebinds plans to original IR, but imports the same recognizer and realization grammar (`structural-validation.ts:5–6,118–135`). It detects forged plans, not all shared linguistic mistakes. Earlier request-action loss and negated-cause scope corruption, subsequently corrected, make that distinction concrete.

## What remains demonstrated, and a bounded next direction

Actual compositional capability exists. The reviewed mixed source beginning `速度が重要なので、私はこの方法を選びました。` and ending with a request for safety evidence produced this first display:

> 俺はこの方法を選んだ。何故かというと速度が重要だからだ。見せてくれるか、この装置が安全だという証拠を。

A pooled, undisplayed variant also composed `速さとスピード` into the reason. That is a separate known-example selection limitation: a more compositional candidate exists but is not displayed. It is different from the final prospective pool-coverage failure. The example demonstrates two source-bound operators plus an available lexical composition; it does not certify humor, naturalness, source-distinctive voice, all seven mechanisms, or sustained narrative generation. Ordinary concessive splitting is not, by itself, successful modesty/boasting tension. Human S/Q remains null.

A bounded architectural direction would be to normalize explicit semantic/discourse roles **before** rhetorical licensing: distinguish topic from actor/patient; represent action sequences and shared arguments; retain nested intent/request/mentioned scopes; and represent an evidence target as a reference independent of which source block owns its text. Transform only resolved roles, preserving literal spans and abstention where genuinely unresolved. Keep generation, semantic preservation, source-style correspondence, and displayed selection as separate evaluations, with independent contrast judgments in addition to the existing structural proof. This is a proposed direction, not a new implementation authorization or another example-patching round.

## Evidence

- Complete final raw source/parser/IR/candidates: [baseline raw capture](prospective-raw-before.json.gz) and [final raw capture](prospective-raw-after.json.gz). These are byte-identical to the original frozen captures
- Exact paired plans, checks and display order: [compact prospective comparison](prospective-comparison.json.gz), [every source and displayed output](prospective-report.md), and [prospective summary](prospective-summary.json)
- [Read-only frozen-helper trace](failure-diagnosis-trace.json): records the raw capture hash and contains no new inputs or generated candidates
- Historical failures and exact code: [first pass](first-pass/README.md), [second pass](second-pass/README.md), and [development snapshots](development-history/)
- Source/style contrast: [final qualitative source review](open-style-review/qualitative-source-review.md); assistant analysis, not human S/Q
- Broader versus implemented scope: [typed rhetorical generation](../../docs/typed-rhetorical-generation-20261006.md) and [source-role architecture](../../docs/structural-v3-source-roles.md)

The large historical raw repetitions remain outside the repository as documented in the package README. Final prospective raw captures are included above for direct inspection.
