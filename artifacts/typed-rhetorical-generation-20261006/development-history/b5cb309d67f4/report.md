# B3 exposed development coverage

All 203 inputs are known development/regression cases. No unseen claim. Human S/Q remains null. Evaluated sourceHash: `b5cb309d67f4a932239c108e006da2cb7384e1de86eb052889d3bafcf088cb6a`.

Coverage counts a case when at least one tested intensity has an actual independently revalidated source-body candidate; pool and displayed coverage are separate. The JSON retains per-intensity counts, all case IDs, candidate categories, exact selected texts and body-candidate texts.

## Complete denominators

| Cohort/domain | Cases | Body pool cases | Body displayed cases | Structural-only/fixed display without body | Only ending/layout display |
|---|---:|---:|---:|---:|---:|
| original-exposed18/reason | 6 | 5 | 4 | 1 | 1 |
| original-exposed18/modesty | 6 | 6 | 6 | 0 | 0 |
| original-exposed18/evidence-request | 6 | 4 | 2 | 3 | 1 |
| first-exposed-ordinary18/reason | 6 | 6 | 6 | 0 | 0 |
| first-exposed-ordinary18/modesty | 6 | 6 | 6 | 0 | 0 |
| first-exposed-ordinary18/evidence-request | 6 | 6 | 5 | 1 | 0 |
| second-exposed-ordinary18/reason | 6 | 6 | 6 | 0 | 0 |
| second-exposed-ordinary18/modesty | 6 | 6 | 6 | 0 | 0 |
| second-exposed-ordinary18/evidence-request | 6 | 6 | 6 | 0 | 0 |
| ALL ordinary | 54 | 51 | 47 | 5 | 2 |
| Controls | 22 | 6 | 6 | 0 | 10 |
| Prior regressions | 127 | 40 | 40 | 11 | 40 |

Original exposed18 are unpaired. Across the two formerly sealed ordinary sets there are 18 paired contrasts; both sides have body pool output in 18, and both display body output in 17. Per-pair/per-intensity outcomes are retained in the JSON. Unsupported cases and controls remain in their denominators.

## Representative exact outputs

### X01: original-exposed18 / reason / displayed-body

Source: 朝の連絡はメールにした。相手が会議中だからだ。

- Display 1: 相手が会議中だから朝の連絡はメールにしたということ。
- Display 2: 朝の連絡はメールにしたからな
何故なら相手が会議中だからだ
- Display 3: 朝の連絡はメールにした
相手が会議中だからだ
- Body candidate in pool only: 相手が会議中だから、朝の連絡はメールにした。
- Body candidate in pool only: 相手が会議中だから朝の連絡はメールにしたという事実。

### X05: original-exposed18 / reason / body-pool-only

Source: 印刷機が故障しているので、受付の案内は手書きにしました。

- Display 1: 印刷機が故障しているから受付の案内は手書きにしたということ。
- Display 2: 印刷機が故障しているので、受付の案内は手書きにしました
- Display 3: 印刷機が故障しているので、受付の案内は手書きにしたからな
- Body candidate in pool only: 受付の案内は手書きにした。何故かというと印刷機が故障しているからだ。

### X03: original-exposed18 / reason / no-body

Source: この資料は保存する。来週の説明に必要だからだ。

- Display 1: この資料は保存する
来週の説明に必要だからだ
- Display 2: この資料は保存するからな
来週の説明に必要だからだ

### X07: original-exposed18 / modesty / displayed-body

Source: 大したことはしていない。机を片付けただけだ。

- Display 1: 机を片付けただけだ。それほどでもない。
- Display 2: 大したことはしていないからな
机を片付けただけだからな
- Display 3: それほどでもない
机を片付けただけだからな
- Body candidate in pool only: それほどでもないが、机を片付けただけだ。

### X14: original-exposed18 / evidence-request / displayed-body

Source: 費用を抑える方針には賛成だ。しかしその予測の根拠を教えてください。

- Display 1: 費用を抑える方針には賛成だ。しかし教えてくれるか、その予測の根拠を。
- Display 2: 費用を抑える方針には賛成だからな
しかしその予測の根拠を教えてください
- Display 3: 費用を抑える方針には賛成だ
しかしその予測の根拠を教えてください

### X13: original-exposed18 / evidence-request / body-pool-only

Source: 便利なのは分かった。しかし安全だという証拠を見せてほしい。

- Display 1: 便利なのは分かった。しかし安全だっていうどういう証拠があるのかよ？
- Display 2: 便利なのは分かったからな
だが安全だという証拠を見せてほしい
- Display 3: 便利なのは分かった
しかし安全だという証拠を見せてほしい
- Body candidate in pool only: 便利なのは分かった。しかしどういう証拠があるのかよ、安全だって。

### X15: original-exposed18 / evidence-request / no-body

Source: 急ぎの案件なのは理解した。しかしこの数値を裏付ける資料を求める。

- Display 1: 急ぎの案件なのは理解したからな
だがこの数値を裏付ける資料を求めるからな
- Display 2: 急ぎの案件なのは理解した
しかしこの数値を裏付ける資料を求める
- Display 3: 急ぎの案件なのは理解したからな
しかしこの数値を裏付ける資料を求めるからな

### U01: first-exposed-ordinary18 / reason / displayed-body

Source: 担当者が休暇中なので、この見積もりへの回答は明日になります。

- Display 1: この見積もりへの回答は明日になる。何故かというと担当者が休暇中だからだ。
- Display 2: 担当者が休暇中なので、この見積もりへの回答は明日になります

### U07: first-exposed-ordinary18 / modesty / displayed-body

Source: 得意というほどではありませんが、共有表の重複行を三つだけ整理しました。

- Display 1: 得意というほどではない。とはいえ、共有表の重複行を三つだけ整理した。
- Display 2: 得意というほどではありませんが共有表の重複行を三つだけ整理しました
- Display 3: 得意というほどではありませんが共有表の重複行を三つだけ整理したからな

### U13: first-exposed-ordinary18 / evidence-request / displayed-body

Source: 早く決めたい気持ちは分かりますが、この契約が必要だという根拠を見せてください。

- Display 1: 早く決めたい気持ちは分かりますが、見せてくれるか、この契約が必要だという根拠を。
- Display 2: 早く決めたい気持ちは分かりますがこの契約が必要だという根拠を見せてください

### U16: first-exposed-ordinary18 / evidence-request / body-pool-only

Source: 口コミが好評なのは承知しています。ただ、このろ過装置で水がきれいになると判断した検証データを見せてもらえますか。

- Display 1: 口コミが好評なのは承知しています。ただ、このろ過装置で水がきれいになると判断した検証データっていうのはどういう検証データなんだ？
- Display 2: 口コミが好評なのは承知しています
ただこのろ過装置で水がきれいになると判断した検証データを見せてもらえますか
- Display 3: 口コミが好評なのは承知しているからな
ただこのろ過装置で水がきれいになると判断した検証データを見せてもらえますか
- Body candidate in pool only: 口コミが好評なのは承知しています。ただ、どういう検証データがあるのかよ、このろ過装置で水がきれいになると判断した検証データって。
- Body candidate in pool only: 口コミが好評なのは承知している。ただ、どういう検証データがあるのかよ、このろ過装置で水がきれいになると判断した検証データって。

### SG2-R01A: second-exposed-ordinary18 / reason / displayed-body

Source: 冷蔵庫に十分な食材があるので、明日の夕食は買い足さずに用意できます。

- Display 1: 明日の夕食は買い足さずに用意できる。何故かというと冷蔵庫に十分な食材があるからだ。
- Display 2: 冷蔵庫に十分な食材があるので、明日の夕食は買い足さずに用意できます

### SG2-M01A: second-exposed-ordinary18 / modesty / displayed-body

Source: 整理整頓は得意ではありませんが、共有棚のファイルには全部ラベルを付け終えました。

- Display 1: 整理整頓は得意ではない。とはいえ、共有棚のファイルには全部ラベルを付け終えた。
- Display 2: 整理整頓は得意ではありませんが共有棚のファイルには全部ラベルを付け終えました

### SG2-E01A: second-exposed-ordinary18 / evidence-request / displayed-body

Source: 受付の応援を頼む案には賛成です。ただ、午前中に来訪者が増えたという根拠になった来訪記録を見せてください。

- Display 1: 受付の応援を頼む案には賛成です。ただ、見せてくれるか、午前中に来訪者が増えたという根拠になった来訪記録を。
- Display 2: 受付の応援を頼む案には賛成だからな
ただ午前中に来訪者が増えたという根拠になった来訪記録を見せてください
- Display 3: 受付の応援を頼む案には賛成です
ただ午前中に来訪者が増えたという根拠になった来訪記録を見せてください

## Interpretation limits

These cases have already informed development. High coverage here is a prerequisite for another prospective check, not evidence of unseen generalization. Structural-fixed-form-only, ordinary endings and lexical changes never become body composition just because the engine labels a program STRUCTURAL. Clause movement and surface split/fusion are distinct from stylistic originality, naturalness or humor.
