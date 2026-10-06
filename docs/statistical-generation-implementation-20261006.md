# 何を実装したか：用例から学ぶ統計生成の独立研究経路

## 1. 今回の実装範囲

**既存の変換規則を増やす代わりに、公開された原作と人による改変の対応からフレーズを学習し、実際の fast_align・Moses・KenLM で候補を生成する別の研究CLIを実装しました。** データの由来、学習／保留の分割、生成に使ったフレーズ、保護値の診断、現行版との比較まで記録します。

実データで学習・生成・比較は実行済みです。ただし、意味保持やブロント語としての品質が改善したとは結論していません。本番Web/APIの生成器は変更しておらず、研究候補をそのまま本番へ表示する切替機能も追加していません。

### 読む順番

1. **この文書**：処理の中身、変更ファイル、入出力、制約
2. [実験結果・失敗・実出力](../artifacts/statistical-documentary-20261006/README.md)
3. [集計値](../artifacts/statistical-documentary-20261006/metrics.json)／[短い実出力と基準版](../artifacts/statistical-documentary-20261006/short-examples.json)
4. [資料のURL・版・権利状態](../artifacts/statistical-documentary-20261006/source-catalog.json)／[区間の位置情報](../artifacts/statistical-documentary-20261006/pair-locators.jsonl)
5. [再現用ハッシュ](../artifacts/statistical-documentary-20261006/reproducibility.json)／[検証記録](../artifacts/statistical-documentary-20261006/verification.json)
6. [研究CLIの操作説明](../research/statistical_generation/README.md)／[依存ライブラリの構築詳細](../research/statistical_generation/DEPENDENCIES.md)

## 2. 処理の全体像

```text
取得済みの原作・改変資料（リポジトリ外のローカルキャッシュ）
  URL・作者の根拠・版・権利状態・取得本文のハッシュ
        |
        v
元文書の連続区間を取り出す                 documentary.py
  人が公開した本文をそのまま参照
  対応付けはassistant/tool、意味審査はunreviewed
        |
        v
長い対応窓を、文字列比較で細分化           alignment.py
  原作140窓対 -> 220区間対、文章は生成しない
        |
        v
原作・派生版・重複を束ね、分割を凍結       documentary.py
  train146 / dev9 / test65区間、作品9 / 1 / 2
        |
        v
Sudachi分割・保護値の対応・可逆符号化       text.py
  学習側146対中、保護値対応が合う65対を使用
        |
        v
fast_align正逆 -> atools -> Moses学習       pipeline.py
  同じtrainの改変本文 -> KenLM trigram
        |
        v
Mosesの最大30候補 + 区間・教師・出典追跡    pipeline.py
  KenLM値と保護診断を付ける。意味の合格判定ではない
        |
        +---- 同じ保留入力を現行mainでも実行 ---- baseline.cjs
        |
        v
候補プール比較・空欄の人手確認ファイル     evaluation.py
  方式／点数を隠す。人の評定を勝手に埋めない
```

## 3. 追加・変更したファイルと、実際の仕事

リンク先はこのPR内の実装です。既存の `packages/`、`services/`、`apps/` の本番実装は変更していません。

| ファイル | 主な関数・入口 | 実装内容 |
|---|---|---|
| [CLI](../research/statistical_generation/__main__.py) | `main` | audit、取込、split、train、decode、evaluate、確認結果の集計。明示コマンドでのみ実行 |
| [公開資料の取込](../research/statistical_generation/documentary.py) | [load_documentary_pairs](../research/statistical_generation/documentary.py#L269), [validate_documentary_pairs](../research/statistical_generation/documentary.py#L366), [make_documentary_split](../research/statistical_generation/documentary.py#L407), [validate_documentary_split](../research/statistical_generation/documentary.py#L412) | 取得物・本文・区間を検証し、原文と改変を元の文字列から再構築。人の意味審査と混同しない |
| [対応区間の細分化](../research/statistical_generation/alignment.py) | [sentence_spans](../research/statistical_generation/alignment.py#L21), [align_windows](../research/statistical_generation/alignment.py#L43), [refine_manifest](../research/statistical_generation/alignment.py#L82) | 引用境界を見ながら分割し、単調な動的計画法で1～2単位ずつ対応付け。本文は書き換えない |
| [分かち書き・保護](../research/statistical_generation/text.py) | [Tokenizer.tokenize](../research/statistical_generation/text.py#L74), [protections](../research/statistical_generation/text.py#L61), [restore](../research/statistical_generation/text.py#L118), [encode/decode](../research/statistical_generation/text.py#L27) | 表層・空白・Unicode位置を保持。保護値を一時識別子へ写し、出力から復元・診断 |
| [学習・生成](../research/statistical_generation/pipeline.py) | [toolchain](../research/statistical_generation/pipeline.py#L31), [train](../research/statistical_generation/pipeline.py#L73), [verify_model](../research/statistical_generation/pipeline.py#L159), [decode_inputs](../research/statistical_generation/pipeline.py#L209), [parse_segmented](../research/statistical_generation/pipeline.py#L187) | 実バイナリを起動し、モデル・教師・フレーズ・出典・診断を結び付ける |
| [基準版アダプター](../research/statistical_generation/baseline.cjs) | バッチ実行部分 | 固定チェックアウトの本来の `generate` と `verifyGeneratedResult` を使用。GiNZAも通常どおり実行 |
| [比較・確認結果](../research/statistical_generation/evaluation.py) | [evaluate](../research/statistical_generation/evaluation.py#L8), [review_content_hash](../research/statistical_generation/evaluation.py#L63), [summarize_reviews](../research/statistical_generation/evaluation.py#L66) | 同一入力を確認し、候補集合と空欄の人手確認ファイルを作る。人の回答を内容ハッシュに結び付ける |
| [任意の手作業用取込](../research/statistical_generation/data.py) | [SourceCatalog](../research/statistical_generation/data.py#L100), [export_annotations](../research/statistical_generation/data.py#L237), [validate_pairs](../research/statistical_generation/data.py#L315), [make_split](../research/statistical_generation/data.py#L395) | 元ログに対して人が通常文を書いた場合の別経路。空欄や未確認の行を教師にしない |
| [CSV取込](../research/statistical_generation/csv_import.py) | [merge_csv](../research/statistical_generation/csv_import.py#L13), [import_csv](../research/statistical_generation/csv_import.py#L57) | ExcelからのUTF-8 CSVを原文・ID・URLと照合。明示的に確認された行だけを取込 |
| [依存構築](../research/statistical_generation/build_dependencies.sh) | Bashスクリプト | 公式ソース／チェックサムを固定し、リポジトリ外へビルド。sudoは使わない |
| [依存ロック](../research/statistical_generation/dependencies.lock.json) | JSON v1 | Gitコミット、公式取得元、アーカイブSHA-256、ライセンス情報、ビルド条件 |
| [集計レポート](../scripts/report-statistical-documentary.py) | スクリプト引数：試験ディレクトリ、出力ディレクトリ | 本文や重みをコピーせず、URL・ハッシュ・位置・集計・既定の短い実出力だけを書き出す |

## 4. 原作・改変はどのように用意したか

最初の監査はリポジトリ内だけが対象で、そこに人が通常文を書いた対訳はありませんでした。その後、指定されたサイトを調べ、**既存の原作と、既に人が公開していた改変**を照合しました。LLMで改変前文を作って教師にしたわけではありません。

具体例は以下です。

- [段階的な改変例](https://kenkyonanight.xxxxxxxx.jp/aaa.html)：サイト自身が原文と4段階の改変を並べている
- [謎の改変物](https://kenkyonanight.xxxxxxxx.jp/oii.html)：『蜘蛛の糸』『雨ニモマケズ』『猿かに合戦』等の原作を確認
- [注文のおおすぐる料理店](https://kenkyonanight.xxxxxxxx.jp/suguru.html)：[宮沢賢治の本文](https://www.aozora.gr.jp/cards/000081/files/43754_17659.html)と対応
- [ハーメルンの作品](https://syosetu.org/novel/107412/)：『寺生まれのTさん』の既存記録まで遡り、6原話を照合
- 『時そば』も具体的な既存本文と照合

資料調査・対象箇所の特定にはassistantの作業が含まれます。取り出した通常側／改変側の文字列は公開本文の連続区間であり、自由な逆翻訳や補作文ではありません。改変者が使った厳密な版が不明な場合や、原話が匿名・二次転記の場合は、その不確かさを残しています。

**取込コードは全サイトを自動巡回するスクレイパーではありません。** 調査で用意した取得物・抽出本文・対応窓のmanifestを読み、再照合する実装です。HTML／web取得記録からの本文抽出手順は各documentの `extraction` に記録します。今回の取得物にはHTTP本文とwebツールの取得記録があり、`raw_kind` で区別します。

権利不明の改変全文・学習本文・モデル重みは公開しません。リポジトリのメタデータだけで、非公開のキャッシュまで復元できるとは主張していません。同じ試験の厳密な再実行には、記録したハッシュに一致する正当に取得済みの資料が必要です。

### 4.1 二つの取込経路を区別する

**今回使用した資料ベースの経路**は `documentary_published_pairs` です。

- 公開資料の人による執筆・帰属の根拠を記録
- `alignment.method` は `assistant`、`tool`、`assistant_and_tool` のいずれか
- `semantic_review_status` は `unreviewed`、`human_review` は `null`
- この根拠から「人が意味同値を確認した」というフラグは作らない
- 原作本文も文学・コピペの文であり、日常日本語へ書き直した正解文ではない

**任意の手作業用経路**は、元ログに対する人の通常表現と確認を受け取ります。ここでは作者／確認者ID、`author_type=human`、LLM等を不使用という明示宣言、意味・出典・系列の確認が必要です。CSVの空欄や `いいえ` は採用せず、別途理由を返します。この経路のExcel入力は、今回の資料ベースの学習を進める条件ではありません。

### 4.2 入力スキーマの要点

資料manifestは `schema_version=1`、`mode=documentary_published_pairs`、`scope=local_research_only`、`source_kind=literary_adaptation` を持ちます。

| 配列／フィールド | 主な内容 |
|---|---|
| `documents[]` | `document_id`, `url`, `title`, `version`, `retrieved_at`, `raw_path/raw_sha256/raw_kind`, `text_path/text_sha256`, `extraction`, `authorship_evidence`, `rights` |
| `works[]` | `work_id`, `title`, `original_author`, `source_document_ids`, `adaptation_document_ids`, `relationship_evidence`, `version_status`, 任意の `family_ids` |
| `pairs[]` | `work_id`, source／targetの `document_id/start/end`, `alignment`, `semantic_review_status`, `human_review`。任意の出典位置・区間ハッシュ・注意事項 |

位置はUnicodeコードポイント単位、startを含みendを含まない範囲です。取込時にrawと抽出本文の全ハッシュを照合し、本文を読み直して区間文字列を取り出します。inlineの生成済み教師文字列を受け取る方式ではありません。

共通の学習処理へ渡す行では、歴史的なフィールド名に合わせて、原作側を `ordinary_text`、改変側を `original_text` に入れます。資料経路の `original_text` は「ブロント本人の原投稿」という意味ではありません。`mode`、`source_kind`、原作／改変それぞれの文書情報を併記して区別しています。

## 5. 140窓対から220区間対へ細分化した方法

[alignment.py](../research/statistical_generation/alignment.py) は文章を生成せず、元のoffsetを取り直します。

- 長さが両側とも240文字以下の窓は、その対応窓を保持
- 長い窓は句読点・改行で分割。ただし引用の途中を通常の文境界にしない
- source／targetそれぞれ1または2単位を結合し、単調な動的計画法で対応付け
- 比較には `SequenceMatcher` の類似度を使用。NFKC・casefold・空白除去は**比較のためだけ**に行い、教師文字列には適用しない
- 比較対象は最大320文字、類似度の下限0.35、長さ比0.25～4。対応しない挿入／脱落単位は記録
- 子区間には親窓・元manifestのハッシュ・方法・類似度を残す。区間ハッシュが指定されている場合は、新しい範囲で再計算

これは意味同値の判定器ではありません。短い窓には複数の文が含まれる場合もあり、「220文の人手対訳」ではなく**220区間対**と表記します。

## 6. 分割と、実際に学習へ入った65対

[documentary.py](../research/statistical_generation/documentary.py) の `_components` は次を同じ連結成分へ束ねます。

- 同じ原作ID
- 正規化した原作名と原作者
- 宣言された派生・系列ID
- 両側を共通の名前空間で扱った、正規化後の完全一致文字列

成分を固定seedで順位付けし、train/dev/testを決定します。今回は `documentary-20261006-v1` で、作品は9/1/2、区間は146/9/65です。全文字列・文書ハッシュ・成分・割当をmanifestに結び付け、学習時と再読込時に照合します。未知の意味的な類似まで完全に検出する保証ではありません。

保留作品は『注文の多い料理店』と「夜釣り」です。同じ原作の4段階改変を、独立した4作品としてtrain/testに分けていません。

学習側146区間に対し、数値・引用・固有名詞等の表層が両側で対応するかを確認した結果、65対を使用し、81対を除外しました。例えば物語の改変では、金額や登場人物や視点が変わることがあります。文字列表記の違いを過剰に拒否する可能性もあり、除外81対を「人間が意味破壊と判定した81件」とは扱いません。

資料経路で除外されるのは、明示的な `PAIR_PROTECTED_VALUE_MISMATCH` です。他の実行エラーを黙って捨てて学習成功にはしません。使用対が0件なら停止します。

## 7. 分かち書き・可逆符号化・保護値

[text.py](../research/statistical_generation/text.py) は既存の固定環境のSudachiを使用します。

- SudachiPy **0.6.11**、SudachiDict-core **20260723**、分割モードA
- 表層・空白・改行を保持し、Unicodeコードポイントの原文位置を記録
- 通常トークンをUTF-8バイト列の16進表記 `u...` に可逆変換し、Mosesの `|||` やfactor等の予約構文と衝突させない
- 引用、数値の文字列、URL／メール／コード片、Sudachiが固有名詞とした範囲を、出現ごとの `P0000` 等へ置換
- 重なる保護範囲は広いものを優先し、引用内部の数値を二重に数えない
- 改変側では同じ保護値の出現を探して同じ識別子を割り当てる。値が消えたり追加されたりする対は学習側で除外
- Sudachiが省略記号等に対して返す長さ0の解析単位は、元の文字を消さずに読み飛ばす

本経路でGiNZAやKNPの格解析を使って意味同値を認定してはいません。基準版の実行では、既存のGiNZA処理をそのまま使います。

数値の主要な保護は半角／全角の算用数字と対応単位の正規表現です。漢数字全般、数量の係り先、人物の役割、引用者の帰属まで網羅する仕組みではありません。引用全体を保護するため、引用の中を言い換えた文学会話の対は、学習から除外されることもあります。

## 8. 本物のライブラリをどうビルド・接続したか

[ロックファイル](../research/statistical_generation/dependencies.lock.json)で固定した公式ソースをコンパイルします。独自のアラインメント／phrase decoderをMoses等と名付けたものではありません。

| ツール | 固定コミット | 使用箇所 |
|---|---|---|
| fast_align | `cab1e9aac8d3bb02ff5ae58218d8d225a039fa11` | `fast_align` 正逆方向、`atools` 対称化 |
| Moses | `08e782040189e0abb3b43a4ec9245e6179e39eca` | 公式 `train-model.perl`, `extract`, `score`, `consolidate`, `moses` |
| KenLM | `4cb443e60b7bf2c0ddf3c745378f76cb59e254e5` | `lmplz`, `build_binary`, `query` |

補助依存はCMake 3.31.6、Boost 1.74.0、bzip2 1.0.8。確認した環境はLinux x86_64、GCC 14.2.0、Node 24.19.0、Python 3.11.15です。

```sh
JOBS=2 bash research/statistical_generation/build_dependencies.sh /absolute/external/tool-cache
```

- 公式アーカイブのSHA-256とGitコミットを確認し、リポジトリ外へ構築
- キャッシュとモデルのパスは空白・シェル特殊文字を禁止。upstreamのPerl処理内部でシェルコマンドを組み立てるため
- 当初のMosesリンク失敗は、公式bzip2をローカル構築しBoost iostreamsを再構築して解決。upstreamのアルゴリズムやソースのパッチはなし
- 実行ファイル10件、補助スクリプト110件、システムコマンド19件のハッシュ等を `toolchain.json` へ記録
- チェックインした構築スクリプトを、構築済みキャッシュを使って再実行し成功。空の環境からの2回目の全面再構築ではない
- native Windows/macOSの構築は未検証。既存のWindows用通常起動へこの依存を無検証で組み込んでいない

### 8.1 学習時の呼び出し順

[pipeline.py](../research/statistical_generation/pipeline.py) の `train` が次を実行します。パスは生成ディレクトリ内の実ファイルです。

```text
fast_align -i parallel.txt -d -o -v
fast_align -i parallel.txt -d -o -v -r
atools -i forward.align -j reverse.align -c grow-diag-final-and

lmplz -o 3 --discount_fallback --memory 256M ... < train.e
build_binary target.arpa target.klm

perl train-model.perl
  --first-step 4 --last-step 9
  --alignment-file aligned --alignment grow-diag-final-and
  --reordering distance --max-phrase-length 7 --cores 1
  --lm 0:3:target.klm:8
```

`train.f` は使用した65対の原作側、`train.e` は改変側です。LMもこの `train.e` だけで作ります。dev/testの改変本文はLMへ流し込みません。Mosesのstep4から開始するため、必要なmodelディレクトリを先に作っています。

別途、公式 `extract --IncludeSentenceId` を同じ教師・alignmentへ実行します。抽出結果の1始まりの行番号から教師IDを引き、phrase provenanceを作ります。**このsentence-ID付き形式を通常のscoreへ渡してはいません。** 通常形式の第4欄をcountとして扱うscorerと混同すると、重みが壊れるためです。

### 8.2 候補生成時

`decode_inputs` は固定したモデル・依存・実装のハッシュを確認してから、Mosesを次の条件で起動します。

- 語順変更幅 `-distortion-limit 0`
- `-n-best-list ... 30 distinct`、最大30候補、1スレッド
- `-include-segmentation-in-n-best` と `-print-alignment-info-in-n-best`
- 重みはMosesの未調整の既定値

公式出力の5番目の欄にある `source=target` の区間表記を `parse_segmented` が読みます。one-bestの `|0-1|` 表記と取り違えません。全source/targetトークンの被覆、重複・欠落、不正なsentence ID、n-best上限も検査します。

各候補には原文・出力のUnicode範囲、Mosesのword alignment、使ったphraseの教師IDを記録します。教師の文書URL・位置は一つの `training_source_catalog` にまとめ、候補ごとに全メタデータを複製しない設計です。出典が引けない非コピーphraseは強制除外します。

KenLMの `query` でも候補を計算し、総log10確率、EOS込みのトークン数で割った値、OOV数／率を返します。これは局所的な語列の統計値で、意味・自然さ・文体の人間評価ではありません。S/Qは `null` のままです。

## 9. 出力スキーマと安全側の扱い

モデルのschemaはv1、モデル識別子は `moses-human-parallel-research-v1`、特徴・診断形式は `moses-kenlm-surface-diagnostics-v2`、表層処理は `surface-protected-v1` です。モデル識別子の名称にかかわらず、資料経路の状態は明示的に `documentary_parallel_unreviewed` と記録します。

### モデルディレクトリ

- `manifest.json`：状態、tokenizer版、実装・データ・モデル・依存ハッシュ、件数、設定
- `pairs.json`／`split-manifest.json`／`splits.json`：取込行、凍結分割
- `documentary-input-reference.json`：元manifestの位置・ハッシュとローカル用途
- `training-diagnostics.json`：学習へ提示した146件、使用65件、除外81件の理由
- `train.f/e`, 正逆alignment、対称化alignment、Moses phrase table、KenLM ARPA/binary
- `training-rows.json`／`phrase-provenance.json`：教師行とフレーズの対応

これらのうち本文やモデルを含むものは公開物に含めません。Moses設定には絶対パスが含まれるため、モデルディレクトリを別の場所へ移しただけで動く可搬形式ではありません。

### decodeのJSON

トップレベルは `model_manifest_sha256`, `model_status`, `feature_version`, `production_enabled=false`, `training_source_catalog`, `inputs[]` です。候補には次を含みます。

- `text`, `decoder_score`, `decoder_features`, `word_alignment`
- `trace[]`：source/targetトークン範囲、input/outputの文字範囲、教師pair ID、learned/copy等の由来
- `kenlm`：確率・長さ当たり値・OOV
- `diagnostics`, `status`, `verification_scope`, `S=null`, `Q=null`

消失・重複・順序変更した保護値、保護値の再挿入、数値・引用等の表層不一致、不明な出力トークン、出典のない非コピー等は `rejected_by_diagnostics` になります。否定・推量・条件の表層手掛かりの違いはreview診断です。検出できる範囲は限定的で、主体／対象、否定や推量の作用域、因果、時制、引用帰属等を一般的に保証しません。

**強制除外されなかった候補も `needs_human_review` です。** 閉じた登録規則の検証を通った `passed` としては扱いません。未知のphraseを「登録規則にない」というだけで全部禁止することもしません。

## 10. 同じ入力での基準版比較と、実装中に直した誤り

今回の比較では、[baseline.cjs](../research/statistical_generation/baseline.cjs) に凍結したmain `4d918a56` のチェックアウトを渡し、本来のエンジンと意味検証を読み込んで実行しました。アダプター自体は指定されたチェックアウトを使い、そのrevisionとハッシュを記録します。設定は `rewrite / faithful / blend / intensity=2 / series=all` です。内部プールが最終検証で削除される前に配列を保持し、表示候補と全候補を別に保存します。実行前後のエンジンファイルハッシュも比較します。

初回はアダプターが未対応の `invent` を指定しており、基準版が全件 `unsupported_generation_mode` を返していました。これは基準版の性能ではなく比較実装の不具合です。独立レビューで発見後、対応する `blend` へ修正し、事前のcapability確認と未対応返却の強制エラーを追加しました。同じ65ケースの比較・確認用ファイルを全て再生成しています。

また、全文が保護された引用のみの入力へ、引用の外側に語を付け加える候補がありました。編集可能部分が空白だけの場合の追加を強制除外する診断を加えています。これは**最初の保留結果を見た後の変更**です。197候補が追加除外されましたが、学習データ・候補文字列・順序・点数は変えていません。初回の比較記録はローカルに保存し、無効な基準0件の値は最終結果に使っていません。

[evaluation.py](../research/statistical_generation/evaluation.py) は、両方式の件数・入力文字列が凍結ケースと一致することを確認します。方式・点数を隠した `review.blank.json` と、由来を持つ別ファイルを出力します。回答は全て空欄です。後で人の回答を取り込む際も内容ハッシュ、回答者、各booleanを照合し、未回答を成功扱いしません。集計の分母へ入るのは全候補の回答が完了したケースだけです。成功を数える際も、研究側だけにある強制除外されていない文に対して、意味・文体・読みやすさの3項目すべてに人が肯定したことを要求します。

## 11. 最終結果をどう読むか

| 観測 | 結果 |
|---|---:|
| 保留ケース／異なる入力文字列 | 65／64 |
| 基準版で候補が出たケース | 36／65 |
| 基準版のプール／表示候補総数 | 47／47 |
| 統計生成の候補総数 | 1,480 |
| ケースごとの入力・基準版にない文字列の合計 | 1,454 |
| 新しい文字列があるケース | 64／65 |
| 強制除外に当たらない新候補があるケース | 42／65 |
| 強制除外／人手確認が必要な候補 | 201／1,279 |
| 人の意味・文体評定 | 0 |

1,454は全入力を横断したユニーク文数でも「良い変換数」でもありません。42/65も意味保持の合格率ではありません。

[短い実出力](../artifacts/statistical-documentary-20261006/short-examples.json)には、例えば次が記録されています。

- `と書いてありました。` → 統計生成1位 `と書いてＰＯＰしていた`。基準版は `と書いてありました`
- `犬がふうとうなって戻ってきました。` → 統計生成1位 `犬がふうとうなって戻って札していた`
- `WILDCAT HOUSE` → 両方式とも原文のまま

入力は[青空文庫の『注文の多い料理店』](https://www.aozora.gr.jp/cards/000081/files/43754_17659.html)の短い区間です。接続が崩れた文字列やコピーも含みます。ここから品質の勝率を作ったり、人手評価済みのラベルを与えたりしていません。

## 12. 再実行するためのコマンド

Node/Pythonの通常依存を固定環境で導入済みとします。`/private/...` はリポジトリ外の正当に取得済み資料・出力です。公開repoだけに全文データが入っている前提ではありません。

```sh
# 依存と契約テスト
JOBS=2 bash research/statistical_generation/build_dependencies.sh /external/tool-cache
.venv/bin/python -m unittest discover -t . -s research/statistical_generation -p 'test_statistical_*.py'

# 取得済みのdocumentary manifestを検証
.venv/bin/python -m research.statistical_generation documentary-audit \
  --manifest /private/source-manifest.json

# 必要なら大きな窓を細分化。これは関数入口であり、専用CLI名ではない
.venv/bin/python -c 'from research.statistical_generation.alignment import refine_manifest; refine_manifest("/private/source-manifest.json", "/private/paired-spans.json", "/private/alignment-report.json")'

# 分割は学習前に凍結し、結果を見てseedを選び直さない
.venv/bin/python -m research.statistical_generation documentary-split \
  --manifest /private/paired-spans.json --seed documentary-20261006-v1 \
  --out /private/frozen-split.json

# 真正なライブラリによる学習
.venv/bin/python -m research.statistical_generation train-documentary \
  --manifest /private/paired-spans.json --split /private/frozen-split.json \
  --tools /external/tool-cache/toolchain.json --out /private/model

# 単独入力の候補を保存
.venv/bin/python -m research.statistical_generation decode \
  --model /private/model --source '入力本文' --out /private/decoded.json

# 比較対象は別の固定checkoutでbuild:engine済みとする
.venv/bin/python -m research.statistical_generation --repo /frozen/baseline evaluate \
  --model /private/model --out /private/comparison
```

`train` は手作業の確認済み対訳用、`train-documentary` は今回の出典ベースの対訳用です。`smoke` は記号の置換だけを使う動作確認で、日本語の品質実験ではありません。各モードを名前だけ付け替えて混ぜないよう検証します。

具体的な今回のモデル・split・train.f/e・alignment・ARPA・KLM等のSHA-256は [reproducibility.json](../artifacts/statistical-documentary-20261006/reproducibility.json) に掲載します。主Python実装、upstreamバイナリ、補助スクリプト、資料ハッシュを変更した場合も、同じ実験として黙って再利用しない設計です。

## 13. 検証と、まだ実装していないこと

実行済みの検証は次の通りです。

- `npm test`：**310/310成功**、失敗・skip・取消0
- Python研究テスト：**84/84成功**。取込、改ざん、分割漏洩、可逆token、保護、比較件数、未対応モード拒否、確認結果等
- typecheck、engine/Web build、build:assets、diagnose、diff check成功
- 独立確認：17文書の再構築、220区間・親窓、分割、学習65対／除外81対、train限定LM
- ARPAとKenLM binaryの独立再構築が同一バイト
- 9,587フレーズと31,417候補区間の教師・位置・出典を照合
- 修正前後の1,480候補の文字列・順序・点数・trace・KenLM値が同一。増えたのは説明済みの診断

未実装・未達も明示します。

- LightGBMによる順位学習、KNPによる解析置換、Pyniniによる生成制御は追加していない
- 本番UI/APIへのMoses切替・常駐サービス接続は未実装
- 一般の意味同値性や、文体・自然さの自動認定は未実装
- 日常日本語全般での品質改善は未実証。保留資料は文学・コピペ領域
- 人の品質評価は未取得。S/Q、品質改善率は未学習／未測定のまま
- 保護値の表層照合は保守的で、誤拒否も見逃しもある
- 環境全般の速度・メモリ保証やnative Windows/macOS対応は未検証
- 以前の意味表現拡張B4は別チェックアウトで保存・停止したまま。この研究へ持ち込んでいない

次の投資先は、実在する対の対応粒度、事実を変える箇所の扱い、語句の接続や不要な付加の制御です。候補数が増えたことだけを根拠に、順位器を追加したり本番を切り替えたりはしていません。
