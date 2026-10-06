# Buront_language_generator / ブロント語変換機

通常の日本語を、実ログに出典を持つ有限変換と登録済み構文でブロント語へ変換するローカルWebアプリです。入力の解析、候補生成、内容保持の検証を行い、通過した候補を最大3件表示します。通常の生成で外部LLMへ入力を送信しません。

リポジトリ: https://github.com/Buront2610/Buront_language_generator

## 現在の対応範囲

- 本文変換・原文寄り・既知構文の応用に対応
- 怒りの頂点、強い悲しみ、既に時間切れの3系統は、形態素・係り受けと原文スロットから構文を生成
- 明示された理由（`〜からだ`）、文頭の逆接（`しかし`、濃いめのみ）、冒頭の謙遜と直後の限定された完了行為にも対応。前後の原文を再照合し、原因・称賛・出来事は創作しません
- 例: `私の怒りが頂点に達しました。` → `俺の怒りが有頂天になった`
- 人物、数値、引用、否定、推量、条件などを保持。不確かな構文は無理に変換しません
- 既存規則で普通体へ変えられる語尾は、1～2文で打ち切らず変換する案を作ります。未対応の活用は残ります。元の語尾を残す案も用意し、強調の「からな」だけは標準1回／濃いめ2回を上限にします
- 新作生成、名言を作るモード、自由な展開は未対応です。画面では選択不可、APIでは `unsupported_generation_mode` を返します
- S/Qは人手評価モデルを学習するまで `null`。検証通過は、自然さ・面白さ・文体品質の保証ではありません
- 特定系列を選んだときは、その系列に確認できる出典だけを使用します。出典不足時に他系列を黙って補いません

詳しい修正範囲と残件は [複数文の語尾計画](docs/coherent-ending-plans-20261006.md)、[一般文・長文の追加改善](docs/grounded-discourse-20261002.md)、[最初の構文実装記録](docs/construction-repair-20261002.md) を参照してください。

## セットアップと起動

Node.js **24系**、Python **3.11系**とGiNZAの固定依存が必要です。初回導入はネットワーク接続が必要ですが、導入後の通常起動・変換はローカルで動作します。

WindowsではNode.js 24とuvを用意して、リポジトリのルートで次を実行します。

```powershell
.\setup.ps1
npm start
```

セットアップ後は `start.bat` からも起動できます。URLは `http://127.0.0.1:4173` です。

macOS/Linuxでの手動セットアップ:

```sh
npm ci
uv venv --python 3.11.15 .venv
uv pip install --python .venv/bin/python --require-hashes -r services/japanese-analysis/requirements.lock.txt
npm run build
npm run build:assets
npm run diagnose
npm start
```

既存のPython環境を使う場合は `BURONT_PYTHON` にその実行ファイルを指定できます。`index.html` の直接起動は現行アプリの起動方法ではありません。

## 検証

```sh
npm test
npm run typecheck
npm run diagnose
```

`npm test` はエンジンとWeb画面をビルドしてから、旧方式の回帰テストと現行方式のAPI・GiNZA・意味保持・改ざん検査を実行します。実際のGiNZA解析を保存したfixtureによる回帰テストも含みます。

## コーパスの再構築

```sh
npm run build:corpus
npm run build:quotes
npm run build:assets
```

`build:quotes` は元サイトのShift_JIS HTMLを取得し、見出し、強調範囲、完全な行、対応投稿を分けて保存します。取得時刻・URL・原バイトのSHA-256も記録します。別の手元ログは `node scripts/prepare-corpora.js "path/to/burontlog.txt"` で指定できます。原文の権利確認は別途必要です。

## 現行の主要ファイル

- `apps/web/src/main.tsx`: React画面
- `apps/server/index.ts`: Fastify APIと静的配信
- `packages/core/grammar-scope.ts`: 命題ごとの形態・否定・推量・引用・条件の範囲
- `packages/core/constructions.ts`: 登録構文の束縛、生成、独立再照合
- `packages/core/discourse-constructions.ts`: 原文の理由・逆接・謙遜と周辺文脈の再束縛
- `packages/core/bounded-search.ts`: 固定版MiniSearchと同じ順位・スコアを保つ省メモリ検索
- `packages/core/rewrite.ts` / `rewrite-validation.ts`: 既存の有限編集と検証
- `packages/core/engine.ts` / `evaluation.ts`: 候補プールと多様性選択
- `packages/core/semantic.ts`: 全候補の最終検証と再選択
- `packages/contracts/`: TypeScript型とJSON Schema
- `services/japanese-analysis/`: ローカルGiNZAサービス
- `data/`: 実ログ、語録、系列情報
- `test/`: 回帰・API・改ざん・出典・再現性テスト

`lib/`、ルートの `app.js` と `index.html` は旧方式の比較・回帰用です。過去の資料は `docs/` に保存していますが、当時のテスト件数や対応範囲を現行版の実績として扱わないでください。
