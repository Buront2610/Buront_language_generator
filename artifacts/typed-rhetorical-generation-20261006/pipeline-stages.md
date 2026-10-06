# Exposed development pipeline stages

Snapshot sourceHash: `66c681f3d2f48ff6bb7d218711da08be4ea948c06d6d5a861d83b2364e491092`. All 203 cases are exposed. Recognition is rerun from retained original IR; planned counts mean source-structural plans present in the raw pool. Noncoverage labels do not claim a specific linguistic rejection reason.

| Cohort/domain | Cases | Recognized | Structural plan in pool | Actual body in pool | Actual body displayed |
|---|---:|---:|---:|---:|---:|
| prior127/prior-regression | 127 | 40 | 40 | 40 | 40 |
| original-exposed18/reason | 6 | 6 | 6 | 6 | 5 |
| original-exposed18/modesty | 6 | 6 | 6 | 6 | 6 |
| original-exposed18/evidence-request | 6 | 3 | 3 | 3 | 3 |
| first-exposed-ordinary18/reason | 6 | 6 | 6 | 6 | 6 |
| first-exposed-ordinary18/modesty | 6 | 6 | 6 | 6 | 6 |
| first-exposed-ordinary18/evidence-request | 6 | 6 | 6 | 6 | 6 |
| first-exposed-controls12/control | 12 | 5 | 5 | 5 | 5 |
| second-exposed-ordinary18/reason | 6 | 6 | 6 | 6 | 6 |
| second-exposed-ordinary18/modesty | 6 | 5 | 5 | 5 | 5 |
| second-exposed-ordinary18/evidence-request | 6 | 6 | 6 | 6 | 6 |
| second-exposed-controls10/control | 10 | 1 | 1 | 1 | 1 |

## Request noncoverage categories

- reason: {"body-displayed":34,"body-pool-not-displayed":2}
- modesty: {"body-displayed":34,"no-recognized-relation":2}
- evidence-request: {"recognized-no-realization-at-intensity":15,"body-displayed":15,"no-recognized-relation":6}

## Ordinary cases with no displayed body composition

- X05: 印刷機が故障しているので、受付の案内は手書きにしました。 (2:body-pool-not-displayed; 3:body-pool-not-displayed)
- X15: 急ぎの案件なのは理解した。しかしこの数値を裏付ける資料を求める。 (2:no-recognized-relation; 3:no-recognized-relation)
- X16: 説明は聞いた。しかしこの方法が確実だという証拠が欲しい。 (2:no-recognized-relation; 3:no-recognized-relation)
- X17: 便利そうですが、なぜ必要なのかを示す記録を確認させてください。 (2:no-recognized-relation; 3:no-recognized-relation)
- SG2-M01B: 片付けが上手なほうではないものの、共有の棚にあるファイルのラベル付けはすべて済ませています。 (2:no-recognized-relation; 3:no-recognized-relation)
