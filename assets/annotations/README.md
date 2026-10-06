# 人手注釈

比較データでは投稿・スレッド・近似重複・family単位の分割を生成前に固定する必要があります。ただし、現在の `npm run evaluate` の手書きケースはすべてpilotであり、コーパスfamilyを保留した評価ではありません。`artifacts/v1-evaluation/comparisons-blind.json` には比較用の文を、別のprivateファイルには方法・特徴量・分割を保存します。S（語り口）、Q（句の魅力）、C（意味保持）を独立に、left/right/tie/both_bad/cannot_judgeから選び、評価者IDと理由を記録してください。

画面での評価はセッション中に保持され、明示操作でJSONへ出力できます。画面の試用データはpilotです。保留試験へ勝手に昇格しません。モデル学習用には生成前に固定した分割を含む比較ファイルと、人が回答したpreferencesを合わせて使います。

`npm run train:preferences -- comparisons-with-labels.json evaluators.json` はS/Qを別々に学習し、係数JSONと保留精度を出します。最低件数はプログラムの起動条件であり、品質承認基準ではありません。一人の回答ならpersonal=trueです。注釈がない現状では学習済みと表示しません。

## 起動と保存形式

起動用スクリプトは `BURONT_PYTHON` があればその実行ファイルを使用し、なければWindowsの `.venv/Scripts/python.exe`、macOS/Linuxの `.venv/bin/python` を使用します。上書きはコマンド文字列ではなく実行ファイルのパスです。NumPy/scikit-learnを含む依存は `services/japanese-analysis/requirements.lock.txt` に固定されています。入力・出力パスは通常どおり引用できます。

```sh
npm run train:preferences -- "saved comparisons/comparisons with labels.json" "saved models/evaluators.json"
```

`/api/v1/export` のJSONは `comparisons` と `preferences` を持ち、既存学習器が受け取る形式と一致します。余分な `history` などのフィールドは学習には使いません。

「人間チェック」の `/api/v1/review/export` は別形式（`pack`、`answers`、`history`）です。保存済みの `buront-human-review-*.json` は、ビルド後に次の明示的な変換を行ってから同じ学習器に渡せます。

```sh
npm run prepare:preferences -- "saved reviews/buront-human-review.json" "saved comparisons/review preferences.json"
npm run train:preferences -- "saved comparisons/review preferences.json" "saved models/evaluators.json"
```

変換は比較セットのハッシュ、項目ID、保存済みの明示回答を検査します。表示された左右の本文から既存の共通特徴量を再抽出し、最新の `answers` だけをS/Q/Cの回答へ展開します。古い `history` を追加票にせず、ベクトル値や方式名から評価を作りません。元のJSONは変更せず、出力先が既存ファイルなら停止します。groupとsplitは保持し、未指定splitはpilotにします。この変換だけではpilot回答を学習用の保留評価へ昇格できません。

- 各comparisonの `comparisonId` と、preferencesの `comparisonId` を対応させます。左右を入れ替えるとラベルの意味も変わるため、保存した対応を保持します。
- privateメタデータには `features`（左・右の順）、`featureVersion`、`group`、`split` が必要です。現在の共通特徴量は `output-text-dense-v2` の44項目です。旧特徴量は拒否され、バージョン名を書き換えるだけでは移行できません。
- 各preferenceは `comparisonId`、`annotatorId`、`dimension`、`choice`、`reason` を保存します。S/Qは別々に学習し、Cやtie/both_bad/cannot_judgeを方向付き学習ラベルに変換しません。
- S/Qそれぞれに重複整理後20件以上の人手によるleft/right回答、うちtrain 10件以上とtestの回答が必要です。同一groupを複数splitにまたがらせません。
- 画面のexportや現在の手書き評価ケースはpilotです。件数が揃っても `FROZEN_SPLIT_REQUIRED` で停止します。学習のために後からtrain/testへ書き換えず、生成前に固定した分割の比較と、それに対する人の回答を用意してください。
- 人手ラベルが不足すると `HUMAN_LABELS_REQUIRED` で終了し、新しい係数ファイルは書きません。既存ファイルの自動削除・更新もしません。学習済みモデルがないときはS/Qは引き続き `null` です。

現在の保存済み比較（`artifacts/v1-evaluation-experimental.3/comparisons-private.json`）は共通特徴量と一致しますが、人手ラベルは0件です。より古い `artifacts/v1-evaluation/comparisons-private.json` の旧特徴量はそのまま学習できません。起動とラベル不足の拒否を実データでテストしていますが、人手モデルの学習成功・品質評価を検証したという意味ではありません。保存・再読込・変換の接続には一時ディレクトリの明記された架空回答を使い、実際の評価データや係数へ混ぜません。OSごとの実行ファイル選択と特殊文字を含む引数転送はスタブで確認し、実際のPythonによる試験は実行したOS上だけの確認です。

原ログの概念写像・操作妥当性の人手注釈、pilotによる閾値凍結、family保留評価は未完了です。

学習済み係数は `assets/annotations/evaluators.json` に置いて `npm run build:assets` で取り込みます。資産に係数・学習ラベルのハッシュを記録し、画面では相対選好点として表示します。同一比較・評価者の重複回答は最後の回答を使い、評価者間の不一致率もレポートします。個人選好モデルや最低件数の達成だけで公開品質を承認したとは扱いません。
