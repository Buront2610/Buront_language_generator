# Exposed development pipeline stages

Snapshot sourceHash: `b5cb309d67f4a932239c108e006da2cb7384e1de86eb052889d3bafcf088cb6a`. All 203 cases are exposed. Recognition is rerun from retained original IR; planned counts mean source-structural plans present in the raw pool. Noncoverage labels do not claim a specific linguistic rejection reason.

| Cohort/domain | Cases | Recognized | Structural plan in pool | Actual body in pool | Actual body displayed |
|---|---:|---:|---:|---:|---:|
| prior127/prior-regression | 127 | 40 | 40 | 40 | 40 |
| original-exposed18/reason | 6 | 5 | 5 | 5 | 4 |
| original-exposed18/modesty | 6 | 6 | 6 | 6 | 6 |
| original-exposed18/evidence-request | 6 | 4 | 4 | 4 | 2 |
| first-exposed-ordinary18/reason | 6 | 6 | 6 | 6 | 6 |
| first-exposed-ordinary18/modesty | 6 | 6 | 6 | 6 | 6 |
| first-exposed-ordinary18/evidence-request | 6 | 6 | 6 | 6 | 5 |
| first-exposed-controls12/control | 12 | 5 | 5 | 5 | 5 |
| second-exposed-ordinary18/reason | 6 | 6 | 6 | 6 | 6 |
| second-exposed-ordinary18/modesty | 6 | 6 | 6 | 6 | 6 |
| second-exposed-ordinary18/evidence-request | 6 | 6 | 6 | 6 | 6 |
| second-exposed-controls10/control | 10 | 1 | 1 | 1 | 1 |

## Request noncoverage categories

- reason: {"body-displayed":32,"no-recognized-relation":2,"body-pool-not-displayed":2}
- modesty: {"body-displayed":36}
- evidence-request: {"recognized-no-realization-at-intensity":16,"body-pool-not-displayed":3,"body-displayed":13,"no-recognized-relation":4}

## Ordinary cases with no displayed body composition

- X03: この資料は保存する。来週の説明に必要だからだ。 (2:no-recognized-relation; 3:no-recognized-relation)
- X05: 印刷機が故障しているので、受付の案内は手書きにしました。 (2:body-pool-not-displayed; 3:body-pool-not-displayed)
- X13: 便利なのは分かった。しかし安全だという証拠を見せてほしい。 (2:recognized-no-realization-at-intensity; 3:body-pool-not-displayed)
- X15: 急ぎの案件なのは理解した。しかしこの数値を裏付ける資料を求める。 (2:no-recognized-relation; 3:no-recognized-relation)
- X16: 説明は聞いた。しかしこの方法が確実だという証拠が欲しい。 (2:recognized-no-realization-at-intensity; 3:body-pool-not-displayed)
- X17: 便利そうですが、なぜ必要なのかを示す記録を確認させてください。 (2:no-recognized-relation; 3:no-recognized-relation)
- U16: 口コミが好評なのは承知しています。ただ、このろ過装置で水がきれいになると判断した検証データを見せてもらえますか。 (2:recognized-no-realization-at-intensity; 3:body-pool-not-displayed)
