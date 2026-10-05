# 構文合成の修正評価 · 2026-10-02

## 結論

固定資産による最終比較は79入力×強度2/3×修正前後の316実行です。例外は0、表示候補はすべて検証通過、S/Qは全候補でnullでした。

| 入力群 | 表示本文・順序が変わった入力 | 表示候補数・強度2 | 表示候補数・強度3 |
|---|---|---:|---:|
| 既存回帰35件 | 1件：T01 | 71→71 | 72→72 |
| 制御診断20件 | 4件：C01/C02/C08/C20 | 49→50 | 49→50 |
| 初回評価済み12件 | 2件：H01/H03 | 26→27 | 27→28 |
| 最終未使用保留12件 | 3件：F01/F02/F03 | 29→30 | 30→31 |

変化件数は改善率ではありません。F01は理由節内の別の語彙規則 `アピール→アッピル` との合成が表示され、F03は `運んだだけだ` に謙遜構文が表示されました。F02には検証済みの理由＋語彙合成候補がありますが、すべて `not_selected` です。F02で実際に表示が変わるのは、理由標識と丁寧形→普通体の合成です。最終保留の残り9件は表示本文・順序が同じでした。

この比較で確認したのは、既に許可されている語彙編集と理由標識を同じ原文範囲で合成できること、及び過去助動詞の異形態を限定達成の認識に使えることです。語彙変換・語尾変換・談話標識の追加を、段落の再構成や持続的な文体生成と数えていません。既存の通常文 N01–N16 は今回の修正前後で全件同じ表示本文・順序でした。

[集計と全出力索引](../artifacts/composable-constructions-20261002/summary.json)には、表示されなかった候補も含む全候補、構文別診断、編集元の範囲と証拠を収録しています。各 comparison ファイルは45KB未満です。`caseArtifactFiles` から入力IDの全記録に辿れます。

## 入力の分離と測定方法

- [既存回帰35件](../artifacts/composable-constructions-20261002/regression-cases.json)：N01–N16、P01–P03、B01–B03、T01–T13の全文・順序・設定を保持。既に修正に使った入力であり、汎化評価ではありません。基準エンジンは前報の35件×2強度の表示本文・順序を全件再現しました。[照合記録](../artifacts/composable-constructions-20261002/baseline-replay.json)
- [制御診断20件](../artifacts/composable-constructions-20261002/controlled-cases.json)：理由終止の普通体・丁寧体・過去形、語彙の有無、`届けた／運んだ`、未実現・否定・引用などの対照。実装中に参照可能にしたため、こちらも汎化の根拠にはしません。
- [最終保留12件](../artifacts/composable-constructions-20261002/heldout-cases.json)：実装担当に入力・結果を渡さず封印し、最終コードを凍結してから一度だけ実行しました。封印時刻・ハッシュと凍結時刻・ソース/生成済みモジュールのハッシュは[封印](../artifacts/composable-constructions-20261002/holdout-seal.json)と[凍結記録](../artifacts/composable-constructions-20261002/code-freeze.json)にあります。既存ファイル中に全文の一致はありませんでしたが、意味的な近重複までは否定していません。[全文一致の照合](../artifacts/composable-constructions-20261002/holdout-distinctness.json)

最初の保留 H01–H12 は初回凍結版で評価済みでした。その後、保留結果とは独立したコードレビューの実入力調査で、`運びたかっただけだ` に謙遜構文を許していた既存の穴が見つかり、願望助動詞を拒否する安全条件を追加しました。H01–H12 は以後[評価済み回帰](../artifacts/composable-constructions-20261002/exposed-cases.json)として最終版でも再実行し、[初回版の全記録](../artifacts/composable-constructions-20261002/initial-heldout/summary.json)を残しました。最終版の保留評価は、別に封印して未実行だった F01–F12 です。初回12件を最終版の未見例とは呼んでいません。

保留例も、この修正対象に近い構文を人為的に選んだ小規模な入力です。実装調整からの独立性を確保した有限の移転確認であり、無作為な自然文コーパス、独立した人間の好み評価、一般的な文体品質の実証ではありません。

両版で同じ資産バイト・同じ設定・同じGiNZA版を使い、各原文の解析ハッシュも一致しています。強度2/3、`rewrite / faithful / blend / all / structured`、seed `literary-style-eval-20261002` を固定しました。原文は実GiNZAで解析し、変換結果は原文IRに再束縛する有限変換・登録構文の独立証明で検証します。書き換え後の全文を別の意味解析器で理解し直したという意味ではありません。

基準は `24972be7eab0530f7c1e895d4912dca7cc258209`、tree `609dc92de5603392127c35c8bcf410ead257f99d` のGit archiveです。最終版は `1616a4c0c664e3a5b283958e55b2c4da4607c97e7791b4b7f9646e287a199014` の作業ツリースナップショットです。`build-info.json` の古い `toolCommit` や資産側の来歴をテスト対象のコミットと混同せず、`testedRevision`・ソースハッシュ・実モジュールハッシュで識別しています。

## 同じ入力で語彙単独・理由単独・合成を区別

C01の原文：

```text
私はこの方法を選んだ。速度が重要だからだ。
```

修正前の表示1位（強度3）：

```text
俺はこの方法を選んだからな
何故なら速度が重要だからだ
```

修正後の表示1位：

```text
俺はこの方法を選んだからな
何故なら速さとスピードが重要だからだ
```

`velocity-doubling` は独立した `permitsRewrite` で許可され、修正前から語彙単独候補の `validateRewrite` にも通っていました。修正前に理由構文が理由文全体を書き込み範囲として占有し、合法な語彙編集を落としていた例です。不適切な語彙規則を無理に合成した例ではありません。

- 語彙単独：通常生成の表示候補 `俺はこの方法を選んだ\n速さとスピードが重要だからだ`。ここで「単独」は理由構文なしの意味で、人称・句読点の規則は含みます。
- 理由単独：`私はこの方法を選んだ。何故なら速度が重要だからだ。`。これは `makeConstructionPlans(ir, request, assets, [])` により語彙ベースを外した**分離実験**です。通常の候補選択へは投入していません。通常の候補検証と原文からの独立構文検証に通っています。
- 合成：上の修正後表示1位。理由節の中の語彙編集を保持し、語尾・人称・句読点と共存しています。別の最小編集合成案も検証を通りますが、表示枠に採用されないことがあります。

[3種の全文・証明・実際の表示順位](../artifacts/composable-constructions-20261002/composition-demo.json)。C05 `速度が重要だ。` の単独入力でも語彙規則の許可と独立証明を記録しています。

## 変更を5種類に分ける

1. `person_punctuation`：人称・句読点。改行の挿入だけを段落再構成と呼ばない
2. `ending`：有限の語尾・丁寧形の変換
3. `lexical`：それ以外の有限語彙置換
4. `discourse_marker`：`何故なら` の追加、`しかし→だが`。節の移動はない
5. `clause_structure`：感情・期限・謙遜の登録済み節内／節形式の実現。文書全体の再配列を意味しない

1候補が複数種類を持つため、種類別件数の和は候補数と一致しません。接頭辞の追加は4だけに数えます。T01で `何故なら熱があるからです` が `何故なら熱があるからだ` に変わるのは、談話標識と通常の語尾編集の合成です。

## どの段階で止まったか

診断には入力ハッシュ、node、構文ID、原文範囲、候補ID、plan ID、段階、理由が入ります。候補生成前の記録は候補IDがnullです。最終検証後に表示選択結果を更新し、仮の選択を残していません。

- `relation_not_recognized`：例 T05/C10 の `開ける` は達成動詞の登録範囲外。C03/C04 の過去の説明終止も現状の形では認識しない
- `unsupported_form`：T13の明示的逆接は認識しても、強度2には登録表層形がない
- `scope_blocked`：C14の従属節を含む謙遜文脈など、必要な安全条件を満たさない
- `edit_conflict`：C08の謙遜節全体の置換と同じ範囲を触る語尾編集は除外する。読み取り範囲が重なるだけの語彙編集とは区別
- `verification_rejected`：証明不成立の候補。この有限入力セットでは発生0件であり、この集計だけから拒否経路の網羅性は主張しない
- `not_selected`：検証に通っても、多様性・品質規則・最大3件の表示制限で表示されない候補

旧版には生成前の診断機構がないため、その欄は明示的にnullです。旧版の認識不成立理由を後付けの正規表現から推測して埋めてはいません。段階の件数は構文×節×候補に対するイベント数なので、入力の失敗率としては読めません。

## 残る制約

- N01–N16の通常文は今回すべて表示本文・順序が同じです。構文合成の修正が、通常文全般の文体改善になったという結果ではありません
- C03/C04の `からだった／からでした`、T05/C10の `開けただけだ`、`しかしながら`、埋め込みの譲歩などは今回の実現範囲外です
- 語彙・語尾・人称を変えても、自然さ、笑い、話者らしさ、語用的な同一性は別の評価が必要です
- 有限入力での検証通過と、任意の5000字入力に対する性能・安全性の保証は別です。長文負荷と安全条件の変異試験は[実装・検証記録](composable-constructions-20261002.md)を参照してください
- S/Qは全候補でnullです。人間のラベルも、学習済みの好み順位も追加していません

## 別枠の本番資産スモーク

最終ビルドから生成した資産 `88bf704b4fb7f06effbd662d4976ff58cc45f323c1d3d80158a41696b5cc2b51` でも既存35入力×強度2/3を実行しました。エンジン・原文解析は固定資産の最終比較と同一です。例外0、表示候補は71件/72件、全表示が検証通過、S/Qはnullでした。

表示される**本文の集合**は全入力で固定資産の最終比較と一致します。ただしN07だけは3候補の順序が両強度で異なります。固定資産の1位は `安全だ`、本番資産の1位は `安全です` で、候補自体の追加・削除はありません。他34入力は順序も一致しました。資産の来歴がdataset ID・候補ID・同点時の選択に影響するため、同じテストとして混ぜていません。[集計・本文索引](../artifacts/composable-constructions-20261002/summary.json)の `productionSmoke` と `production-smoke-*.json` を参照してください。

## 再実行

Node24、Node依存関係、`services/japanese-analysis/requirements.lock.txt` に従うPython3.11/GiNZA環境を用意し、`BURONT_PYTHON` にその実行ファイルを指定します。資産JSONそのものは追加しませんが、基準のデータとコンパイラから**同じバイト列を再生成できることを実測**しました。[固定資産manifest](../artifacts/composable-constructions-20261002/frozen-asset-manifest.json)の歴史的なengine/toolCommitだけを復元し、内容のmanifest・dataset ID・SHA256が完全一致する場合だけ保存します。評価対象エンジンの情報を、この歴史的資産の来歴で置き換える操作ではありません。

```sh
REPO="$PWD"
BASE=$(mktemp -d)
AFTER=$(mktemp -d)
RUN=$(mktemp -d)
CASES="$REPO/artifacts/composable-constructions-20261002"

git archive 24972be7eab0530f7c1e895d4912dca7cc258209 | tar -x -C "$BASE"
ln -s "$REPO/node_modules" "$BASE/node_modules"
(cd "$BASE" && npm run build:engine)
node scripts/recreate-composition-evaluation-assets.cjs \
  --baseline-root "$BASE" --out "$RUN/frozen-assets.json"

# 修正済みツリーをbuildし、その実行コードを作業中のcheckoutから分離する
npm run build:engine
cp -a dist packages services build-info.json "$AFTER/"
ln -s "$REPO/node_modules" "$AFTER/node_modules"
# 例: export BURONT_PYTHON=/absolute/path/to/python3.11-venv/bin/python

for SUITE in regression controlled exposed heldout; do
  node scripts/evaluate-composable-constructions.cjs \
    --engine-root "$BASE" --assets "$RUN/frozen-assets.json" \
    --cases "$CASES/$SUITE-cases.json" --out "$RUN/before-$SUITE.json" \
    --revision 24972be7eab0530f7c1e895d4912dca7cc258209
  node scripts/evaluate-composable-constructions.cjs \
    --engine-root "$AFTER" --assets "$RUN/frozen-assets.json" \
    --cases "$CASES/$SUITE-cases.json" --out "$RUN/after-$SUITE.json" \
    --revision "working-tree:$(node -p 'require("./build-info.json").sourceHash')"
done
node scripts/summarize-composable-constructions.cjs \
  --before-prefix "$RUN/before" --after-prefix "$RUN/after" \
  --cases-dir "$CASES" --out "$RUN/comparison"
node scripts/verify-composition-evaluation.cjs "$RUN/comparison"
```

公開後の保留入力を再利用した実行は再現試験です。新たな未見評価とは扱いません。comparisonは `input`、`run`、`candidate`、`construction_diagnostic` の型付き記録で、入力ID・強度・before/afterで結合できます。候補本文が同じでもplan IDを区別し、採用・不採用の両方を残しています。
