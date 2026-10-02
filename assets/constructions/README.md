# 構文台帳

現在の本番経路は `packages/core/rewrite.ts` の有限語彙・句読点変換と、`packages/core/constructions.ts` の登録済み意味構文です。

- `anger-peak` v1: 明示された最大程度の怒り
- `deep-sadness` v1: 明示された高程度の悲しさ
- `time-expired` v1: 明示された「すでに時間切れ」の状態

各レコードに原ログ文ID、系列、意味スロット、適用条件、意味効果を持ちます。生成計画には構文バージョン、実現形ID、原文位置・token ID、意味特徴と出典を記録し、検証時には原文から再束縛します。詳細と制限は [登録済み意味構文](../../docs/registered-constructions-v2.md) を参照してください。

`packages/core/creation.ts` と `packages/core/rhetoric.ts` の旧OP-01〜10および関連引用の作成機能は、実験比較用の低水準部品として残っています。現在の `generate()` はこれらの比喩・引用追加経路を呼びません。新作生成、一句の創作、文脈の創作的な展開は未対応として明示します。

出典に存在するのは構文の根拠です。入力に合わせて生成した文全体が実際の語録である、という意味ではありません。
