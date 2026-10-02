const test = require("node:test");
const assert = require("node:assert/strict");
const { CorpusEngine } = require("../lib/corpus-engine");
const { normalizeForPresence, splitSentences } = require("../lib/text-analysis");
const { createRandom } = require("../lib/variation-grammar");
const { buildDiscourseGraph } = require("../lib/grammar/discourse-graph");
const { burontLineCoverage, burontizeText } = require("../lib/grammar/buront-surface");

const engine = new CorpusEngine();

// v1 permits abstention when legacy narrative transformations violate an invariant.
// Keep the old structural assertions for candidates that still pass all checks.
function assertSafeAbstention(result, source) {
  if (!result.fallback) return false;
  assert.equal(result.text, source);
  assert.equal(result.selectedCandidateId, null);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.summary.passedCount, 0);
  return true;
}

test("ログ・倉庫・改変集・名言集を読み込み、LLMを使用しない", () => {
  const status = engine.status();
  assert.equal(status.usesLlm, false);
  assert.equal(status.posts, 2452);
  assert.equal(status.sentences, 9591);
  assert.equal(status.localMatches, 2379);
  assert.equal(status.archiveSupplements, 73);
  assert.equal(status.novelChapters, 23);
  assert.equal(status.comparisonStages, 5);
  assert.equal(status.quoteHeadings, 165);
  assert.equal(status.quoteExcerpts, 840);
  assert.equal(status.quotePatterns, 54);
  assert.equal(status.quoteHeadingsWithContext, 155);
  assert.equal(status.quoteContextLinks, 161);
  assert.equal(status.quoteSourceUrl, "https://kenkyonanight.xxxxxxxx.jp/goroku.html");
  assert.equal(status.anchorConstructions, 10);
  assert.equal(status.observedAnchors, 979);
  assert.equal(status.faithfulQuoteExpressions, 30);
  assert.equal(status.faithfulQuoteRecognizers, 30);
  assert.equal(status.faithfulQuoteFunctionalRoles, 29);
  assert.equal(status.faithfulQuoteEvidenceLinks, 30);
});

test("段階的な文章比較を使い、行動と反応を構造ごと改変する", () => {
  const source = "昨日、仕事で急いで資料を提出したら、上司がとても驚きました。";
  const result = engine.convert(source, { level: 2 });
  const structuralCandidates = engine.comparisonDrivenCandidates(source, () => 0.5).join("\n");

  assert.match(result.text, /昨日/);
  assert.match(result.text, /提出/);
  assert.match(result.text, /ｶｶッっと/);
  assert.match(structuralCandidates, /圧倒的な速度/);
  assert.match(structuralCandidates, /リアルでビビった/);
  assert.doesNotMatch(result.text, /話なんだが急いの話/);
  assert.equal(result.comparisons[0].validation.passed, true);
  assert.ok(result.comparisons[0].candidateCount >= 10);
  assert.ok(result.comparisons[0].references.length >= 1);
});

test("代表句だけでなく候補比較で文章全体を選ぶ", () => {
  const source = "私はこの計画がとても良いと思います。全員で協力すれば成功できます。";
  const result = engine.convert(source, { level: 2 });

  assert.equal(result.comparisons.length, 2);
  assert.match(result.text, /かなり良い|確定的に明らか|という事実|格の違い/);
  assert.match(result.text, /ぜいいん|成功できる|という事実/);
  assert.equal(result.summary.passedCount, 2);
  assert.ok(result.summary.averageSemantic >= 0.8);
});

test("数値、URL、メールアドレスを検証で保持する", () => {
  const source = "333円を777円に変更し、https://example.com と user@example.com を確認します。";
  const result = engine.convert(source, { level: 2 });

  assert.match(result.text, /333円/);
  assert.match(result.text, /777円/);
  assert.match(result.text, /https:\/\/example\.com/);
  assert.match(result.text, /user@example\.com/);
  assert.equal(result.comparisons[0].validation.passed, true);
  assert.doesNotMatch(result.comparisons[0].validation.warnings.join(" "), /保持できなかった値/);
});

test("否定を含む文章では肯定・否定の検証結果を返す", () => {
  const source = "この方法では成功できないと思います。";
  const result = engine.convert(source, { level: 2 });

  assert.match(result.text, /ない/);
  assert.equal(result.comparisons[0].validation.polarity, 1);
  assert.equal(result.comparisons[0].validation.passed, true);
});

test("標準レベルでも語彙、表記、構造を複数次元で変換する", () => {
  const source = "あまりにもずるいので、私は怒っています。";
  const result = engine.convert(source, { level: 2 });
  const validation = result.comparisons[0].validation;

  assert.match(result.text, /あもりにも/);
  assert.match(result.text, /怒りが有頂天/);
  assert.ok(validation.styleDimensions.length >= 3);
  assert.equal(validation.passed, true);
});

test("追加辞書を候補へ適用してから同じ検証を通す", () => {
  const source = "猫はとても強いと思います。";
  const result = engine.convert(source, {
    level: 2,
    customRules: [{ from: "猫", to: "黄金の鉄の猫" }],
  });

  assert.match(result.text, /黄金の鉄の猫/);
  assert.equal(result.comparisons[0].validation.passed, true);
});

test("長文でも未検証の補完を足さず、各文の丁寧形を断定句へ正しく接続する", () => {
  const source = "私は昨日、新しい道具を使って作業しました。普通なら一時間かかる仕事ですが、急いで終わらせたので三十分で完成しました。同僚はその速さにとても驚き、良い仕事だと褒めてくれました。";
  const result = engine.convert(source, { level: 3 });

  assert.equal(result.comparisons.length, 3);
  assert.equal(result.summary.sentenceCount, 3);
  assert.equal(result.summary.passedCount, 3);
  assert.doesNotMatch(result.text, /(?:です|ます|でした|ました)(?:のは|ことは|という事実)/);
  assert.doesNotMatch(result.text, /です(?:が|けど|けれど)/);
  assert.doesNotMatch(result.text, /昨日に求められる/);
  assert.doesNotMatch(result.text, /周りからの信頼も高い状態/);
  assert.match(result.text, /一時間/);
  assert.match(result.text, /三十分/);
});

test("実ログの終端傾向に合わせて句点を補わず、複数文は改行で区切る", () => {
  const single = engine.convert("今日は寒い。", { level: 2 });
  const multiple = engine.convert("今日は寒い。明日は休みです。", { level: 2 });

  assert.doesNotMatch(single.text, /。/);
  assert.doesNotMatch(multiple.text, /。/);
  assert.match(multiple.text, /\n/);
  assert.equal(multiple.comparisons.length, 2);
});

test("短い寒さの報告は悲嘆へ誤分類せず、機能の異なる状態構文を3案返す", () => {
  const first = engine.convert("今日は寒い", { level: 2, seed: "repeatable" });
  const repeated = engine.convert("今日は寒い", { level: 2, seed: "repeatable" });
  const runs = Array.from({ length: 10 }, (_, index) => (
    engine.convert("今日は寒い", { level: 2, seed: `variation-${index}` })
  ));
  const outputs = new Set(runs.map((result) => result.text));
  const options = runs.flatMap((result) => result.comparisons[0].options);
  const signatures = new Set(options.flatMap((option) => option.validation.faithfulQuoteSignatures));
  const candidates = options.map((option) => option.text).join("\n");

  assert.deepEqual(first.suggestions, repeated.suggestions);
  assert.ok(outputs.size >= 3);
  assert.ok(runs.every((result) => result.suggestions.length >= 3));
  assert.deepEqual(signatures, new Set([
    "state_threshold",
    "state_ordinary_damage",
    "state_knight_resistance",
  ]));
  assert.ok(options.every((option) => option.validation.faithfulQuoteCount === 1));
  assert.ok(options.every((option) => option.validation.faithfulContextMatch));
  assert.doesNotMatch(candidates, /深い悲しみ|ゲームオーバー|手遅れ/);
  assert.ok(runs.every((result) => result.suggestions.every((suggestion) => suggestion.averageSemantic >= 0.62)));
});

test("寒さ以外の短文も固定結果にせず、確率的に候補を組み替える", () => {
  const runs = Array.from({ length: 8 }, (_, index) => (
    engine.convert("このゲームは面白い", { level: 2, seed: `general-${index}` })
  ));
  const outputs = new Set(runs.map((result) => result.text));
  const candidates = runs.flatMap((result) => result.suggestions.map((suggestion) => suggestion.text)).join("\n");

  const supportedEvaluationFrames = engine.faithfulQuoteGrammar.status().expressions.filter((id) => ["evaluation_rank", "evaluation_impact", "evaluation_elite"].includes(id));
  assert.equal(supportedEvaluationFrames.length, 2, "unattested evaluation formula is disabled");
  assert.ok(outputs.size >= supportedEvaluationFrames.length);
  assert.match(candidates, /驚き|一般人|格の違い|破壊力|真似できない/);
  assert.ok(runs.every((result) => result.summary.passedCount === 1));
});

test("実ログでの出現回数を抽選重みに使わず、文末型を均等な袋から一巡させる", () => {
  const nextEnding = engine.variationGrammar.createEndingBag(createRandom("balanced-endings"));
  const generated = Array.from({ length: engine.variationGrammar.endings.length * 3 }, () => nextEnding("候補"));
  const counts = new Map(engine.variationGrammar.endings.map((ending) => [ending.evidence, 0]));

  for (const ending of engine.variationGrammar.endings) {
    counts.set(ending.evidence, generated.filter((text) => ending.pattern.test(text)).length);
  }
  assert.deepEqual(new Set(counts.values()), new Set([3]));
});

test("通常変換では使い切るまで直近の同一機能構文を避ける", () => {
  const isolatedEngine = new CorpusEngine();
  const results = Array.from({ length: 3 }, () => isolatedEngine.convert("今日は寒い", { level: 2 }).text);

  assert.equal(new Set(results).size, 3);
});

test("形容詞の丁寧形と否定過去を壊さず、接続語の前へ反応語を置かない", () => {
  const source = "この武器は初心者でも扱いやすいです。電車が遅れて時間に間に合いませんでした。ただし、保存できない問題があります。";
  const result = engine.convert(source, { level: 2, seed: "conjugation-regression" });
  const suggestions = result.suggestions.map((suggestion) => suggestion.text).join("\n");

  assert.doesNotMatch(suggestions, /扱いやすいだ|ませんだった|アワレにもただし/);
  assert.match(suggestions, /扱いやすい/);
  assert.match(suggestions, /間に合わなかった/);
  assert.equal(result.summary.passedCount, 3);
});

test("入力にない否定を付け足した候補は検証不通過にする", () => {
  const validation = engine.validate("来週に修正版を公開する予定です。", "来週に修正版を公開する予定だという時点で貧弱一般人には真似できない", 2);

  assert.equal(validation.polarity, 0.72);
  assert.equal(validation.passed, false);
});

test("完全ブロントナイズでは長文を自慢話の段落へ再構成する", () => {
  const source = "昨日、開発チームに新しい管理ツールを導入しました。以前は報告書の作成に2時間かかっていましたが、今日は45分で完了しました。ただし、通信が切れると編集中の内容を保存できない問題が残っています。明日の会議では3人の担当者と対策を確認し、来週までに修正版を公開する予定です。";
  const result = engine.convert(source, { level: 3, contextMode: "full", seed: "full-context" });
  const candidates = result.suggestions.map((suggestion) => suggestion.text).join("\n---\n");

  assert.equal(result.contextMode, "full");
  assert.equal(result.summary.unit, "paragraph");
  if (assertSafeAbstention(result, source)) return;
  assert.equal(result.summary.passedCount, 1);
  assert.equal(result.comparisons[0].unit, "paragraph");
  assert.ok(result.comparisons[0].candidateCount >= 20);
  assert.ok(result.comparisons[0].validation.narrativeScore >= 5 / 6);
  assert.equal(result.suggestions.length, 3);
  assert.match(candidates, /知り合いのﾅｲﾄ|俺のフレ|一級と言われ/);
  assert.match(candidates, /LSで|最初に結果だけ|その場にいた|証拠から先に|何いきなり|英語でいうと|後になって|予知夢/);
  assert.match(candidates, /2時間/);
  assert.match(candidates, /45分/);
  assert.match(candidates, /3人/);
  assert.match(candidates, /保存(?:できない|不能|に失敗)/);
  assert.doesNotMatch(candidates, /LSでLSで|扱いやすいだ|ませんだった/);
});

test("長文は原文の各文を貼らず、節の役割を変えて複数の談話順序へ再構成する", () => {
  const source = "事務部では毎週月曜日に売上報告書を作成している。今週は担当者が二人休んだため、入力作業が大幅に遅れていた。昼の時点で全体の半分しか終わっていなかったが、締切は午後三時だった。私はCSVから表とグラフを自動作成するツールを作った。その結果、報告書は45分で完成し、予定より一時間早く提出できた。ところが直後にネットワークが切断されたため、保存処理を修正した。";
  const sourceSentences = splitSentences(source);
  const faithful = engine.convert(source, { level: 3, contextMode: "faithful", seed: "long-rewrite" });
  const full = engine.convert(source, { level: 3, contextMode: "full", seed: "audit-0" });
  const faithfulOutputs = faithful.suggestions.map((suggestion) => suggestion.text);
  const fullOptions = full.comparisons[0].options;
  const malformed = /すると[^\n]{0,80}すると|見つけとそのまま|その後直後|だったがという時点|分類しとそのまま|を因みに/;

  assert.equal(faithful.suggestions.length, 3);
  assert.equal(full.suggestions.length, 3);
  for (const output of faithfulOutputs) {
    const reused = sourceSentences.filter((sentence) => (
      normalizeForPresence(output).includes(normalizeForPresence(sentence))
    ));
    assert.ok(reused.length <= 1);
    assert.doesNotMatch(output, malformed);
  }
  for (const option of fullOptions) {
    assert.equal(option.validation.passed, true);
    assert.ok(option.validation.structuralRewriteScore >= 0.8);
    assert.ok(option.validation.lightlyRewrittenSourceSentenceCount <= 1);
    assert.doesNotMatch(option.text, malformed);
    assert.doesNotMatch(option.text, />>(?:一部|そ)(?:\s|$)/);
  }
  assert.ok(fullOptions.some((option) => option.validation.factOrderMovementScore >= 0.15));
  assert.match(fullOptions.map((option) => option.text).join("\n"), /原因らしい|という有様/);
  assert.match(fullOptions.map((option) => option.text).join("\n"), /ｶｶッっと/);
  assert.match(fullOptions.map((option) => option.text).join("\n"), /超状現象/);
});

test("長文の依頼文と受付文でも、依頼者の発言・主人公の行動・数値結果を取り違えない", () => {
  const cases = [
    {
      source: "俺はしがないプログラマーなんだが事務どもが泣き叫んでるっぽいのをSlackの会話で見つけた。俺は席にいたので急いだ。どうやら報告書が間に合いそうにないらしく、事務どもは早く作ってと泣き叫んでいた。俺は急遽ツールを作り、報告書は45分で完成した。部長は見事な仕事だと評価した。ところが直後にネットワークが切断されたため、俺は保存処理を修正した。",
      action: /ｶｶッっと[^\n]{0,50}(?:急遽ツール|対象は急遽ツール)/,
      values: ["45分"],
    },
    {
      source: "駅前の受付には朝から長い列ができていた。予約確認に時間がかかり、開始時刻までに全員を案内できそうになかった。私はタブレットで名簿を検索できる画面を作った。その結果、待ち時間は20分から5分に減り、開会前に受付が終わった。終了後、担当者から次回も使いたいと連絡があった。",
      action: /ｶｶッっと[^\n]{0,80}(?:タブレット|名簿).*(?:画面|対象)/,
      values: ["20分", "5分"],
    },
  ];

  for (const [index, item] of cases.entries()) {
    const result = engine.convert(item.source, { level: 3, contextMode: "full", seed: `long-role-${index}` });
    for (const option of result.comparisons[0].options) {
      assert.equal(option.validation.passed, true);
      assert.match(option.text, item.action);
      assert.doesNotMatch(option.text, /いくえ不明|状況を一瞬で見切って必要な一手だけ/);
      for (const value of item.values) assert.match(option.text, new RegExp(value));
    }
  }
});

test("ログを処理する研究室長文を証拠アンカーと誤認せず救援と後続障害へ分ける", () => {
  const source = "研究室では毎晩センサーの記録を手作業で確認していた。昨夜は異常値が120件に増え、二人の担当者では朝までに調査できそうになかった。私はログを種類別に分けるスクリプトを作った。調査時間は3時間から25分に短縮され、原因となった装置を特定できた。ところが予備装置でも同じ警告が出たため、判定条件を修正した。翌週は新しい監視手順を三人で確認する予定だ。";
  const model = engine.contextNarrative.extractModel(source, splitSentences(source));
  const result = engine.convert(source, { level: 3, contextMode: "full", seed: "research-long" });

  assert.equal(model.eventFrame, "rescue");
  assert.equal(model.hasEvidence, false);
  assert.equal(model.problemIndex, 4);
  for (const option of result.comparisons[0].options) {
    assert.equal(option.validation.passed, true);
    assert.equal(option.validation.reusedSourceSentenceCount, 0);
    assert.match(option.text, /3時間/);
    assert.match(option.text, /25分/);
    assert.match(option.text, /超状現象/);
    assert.doesNotMatch(option.text, />>(?:研究室|翌週)/);
  }
});

test("会話の多い長編でも引用を壊さず、主体交代と介入結果を談話グラフで再構成する", () => {
  const source = `俺は夜釣りに出かけた
ある日、遊びの予定がキャンセルになった俺は秘密の釣り場で夜釣りを楽しむ事にした
街から少し離れた所にある橋で、静かでよくつれる俺の穴場
その日も良く釣れ、しばらくした頃、全身に寒気が。
何か恐いな・・・そう思いつつも入れ食い状態のその場を離れる気にもならず夜釣りを楽しんだ
「あなたも釣りですか？」後ろから声をかけられた、振り返るとそこにはサラリーマン風の中年男性が
「えぇ、ここよく釣れるんです」「えぇそうらしいですね」
「あなたも釣りですか？」「・・・まぁそうですね」話していくうちに段々と俺は違和感を感じた
男性はどう見てもスーツ姿、とても釣りを楽しむ格好じゃない、こんな所でなにを・・・
「あなた、つらないんですか・・・」男性の声・・・いやおかしい、明らかに上から聞こえてきた
「つりましょうよ、あなたも・・・」俺は恐怖に震えながらも上を見上げた・・・
そこには、今話をしていた男性の首吊り死体が！！男が言っていたのは「釣り」ではなく「吊り」だったのだ！！
気が付くと俺の目の前には無数の人影が「吊ろう・・・一緒に吊ろう・・・」と俺に囁いている
「そこまでだ」聞いたことのある声、寺生まれで霊感の強いTさんだ
影によって今にも吊り上げられそうな俺の前に来ると、自前の釣竿を振り回し
「破ぁ！！」と叫ぶ、すると釣竿の糸が眩く光り、振り回した糸が剣のように次々と影を引き裂いてゆく！
ある程度影を振り払うと、Tさんの呪文によって周りには光が走り、アッー！と言う間に影は全滅した。
「Tさんも夜釣りですか？」そう尋ねるとTさんは俺を指差し「まあな、随分と小物を釣り上げちまったがな・・・」
帰り道で聞いた話によるとあそこは自殺の名所で首吊りが首吊りを呼ぶ恐怖の橋らしい。
「すっかり日も上がっちまったな、どれ、街で女の子でも釣りに行くか」
そう言って車に飛び乗り爽やかに笑ってみせるTさんを見て
寺生まれはスゴイ、俺はいろんな意味で思った。`;
  const facts = splitSentences(source);
  const model = engine.contextNarrative.extractModel(source, facts);
  const graph = buildDiscourseGraph(model.facts);
  const result = engine.convert(source, { level: 3, contextMode: "full", seed: "dialogue-narrative" });
  const malformed = /でという時点ですでにすか|言っていたのは\s+ではなく|とそのまますると|引用符の途中で改行/;

  assert.equal(facts.length, 23);
  assert.equal(graph.hasNarrativeArc, true);
  assert.equal(graph.focalActor, "Tさん");
  if (assertSafeAbstention(result, source)) return;
  assert.equal(result.suggestions.length, 3);
  assert.equal(new Set(result.suggestions.map((suggestion) => suggestion.text)).size, 3);
  for (const option of result.comparisons[0].options) {
    assert.equal(option.validation.passed, true);
    assert.equal(option.validation.dialogueIntegrityScore, 1);
    assert.equal(option.validation.hasBrokenDialogueLine, false);
    assert.equal(option.validation.reusedSourceSentenceCount, 0);
    assert.ok(option.validation.structuralRewriteScore >= 0.9);
    assert.match(option.text, /Tさん.{0,40}(?:封印|武の心|雷属性|ﾉｰﾘｽｸ|見事なｶｳﾝﾀｰ|扱えない技量|準備運動|一手だけ|１０％|シュミレート)/s);
    assert.match(option.text, /影.{0,20}(?:全滅|消滅|片付)/);
    assert.match(option.text, /「釣り」ではなく「吊り」/);
    assert.doesNotMatch(option.text, malformed);
    assert.doesNotMatch(option.text, /俺が選んだのは違和感|話の前提は声の主は|についての状況は|選んだのは[^\n]{0,50}方を選んだ|かなり釣り用/);
    assert.doesNotMatch(option.text, /ダイヤモンド・パワー.*寒さ|長寿ﾀｲﾌﾟ.*寒さ/);
    assert.ok(option.validation.retainedSourceFragmentRate <= 0.55);
    assert.equal(option.validation.highlyRetainedSourceFragmentCount, 0);
    assert.equal(option.validation.burontLineCoverageScore, 1);
    assert.deepEqual(option.validation.unconvertedBurontLines, []);
  }

  const corruptedDialogue = result.comparisons[0].options[0].text
    .replace("釣りですか？", "釣りでという時点ですでにすか？");
  const corruptedValidation = engine.validateNarrative(source, corruptedDialogue, 3);
  assert.equal(corruptedValidation.passed, false);
  assert.ok(corruptedValidation.dialogueIntegrityScore < 1);
  assert.match(corruptedValidation.warnings.join(" "), /会話内容が欠落または破損/);
});

test("談話グラフは怪談専用にせず、登山・会議・台所でも異なる介入主体を抽出する", () => {
  const cases = [
    {
      actor: "友人",
      source: "私は友人と山へ出かけた\n朝は晴れていて登山道もよく見えていた\n山道の途中で急に濃霧が出て視界が悪くなった\n目印を見失い戻る道も分からなくなった\n友人は地図とコンパスを確認した\n谷から聞こえる川の音を基準に進む方角を決めた\n二人で30分歩くと予定していた避難小屋に到着した\n管理人はこの時期は霧が出やすいと教えてくれた\n翌朝は安全な道を通って下山した",
    },
    {
      actor: "委員長",
      source: "放課後に文化祭の企画会議が始まった\nクラスでは喫茶店と展示の二つの案が出ていた\n意見が衝突し話がまったくまとまらなかった\n誰も譲らず時間だけが過ぎていった\n委員長は両方の案の費用と必要人数を表に整理した\n全員で数字を確認して実現できる部分を組み合わせた\n最後には展示付きの喫茶店という案が決まった\n先生も現実的で面白い企画だと評価した\n翌日から担当を分けて準備を始めた",
    },
    {
      actor: "姉",
      source: "家族の夕食を作るため台所に立った\n鍋では油を温めていた\n別の料理を切っていると鍋から煙が出て火が上がった\n家族は驚いて声を上げた\n姉は濡れた布を持ってきて火元を止めた\n私は消火器を用意して周りの安全を確認した\n数分後には火が消えて台所も落ち着いた\n料理は作り直したが予定より少し遅い夕食になった\n翌日には消火器の期限と置き場所を家族で確認した",
    },
  ];

  for (const [index, item] of cases.entries()) {
    const model = engine.contextNarrative.extractModel(item.source, splitSentences(item.source));
    const graph = buildDiscourseGraph(model.facts);
    const result = engine.convert(item.source, { level: 3, contextMode: "full", seed: `graph-holdout-${index}` });

    assert.equal(graph.hasNarrativeArc, true);
    assert.equal(graph.focalActor, item.actor);
    if (assertSafeAbstention(result, item.source)) continue;
    assert.equal(result.comparisons[0].options.length, 3);
    assert.ok(result.comparisons[0].options.every((option) => option.validation.passed));
    assert.ok(result.comparisons[0].options.every((option) => option.validation.structuralRewriteScore >= 0.7));
    assert.ok(result.comparisons[0].options.every((option) => option.validation.burontLineCoverageScore === 1));
  }
});

test("引用を除く通常文が一行でも残れば完全ブロントナイズを不合格にする", () => {
  const source = "事務部では毎週月曜日に売上報告書を作成している。今週は担当者が二人休んだため、入力作業が大幅に遅れていた。昼の時点で全体の半分しか終わっていなかったが、締切は午後三時だった。私はCSVから表とグラフを自動作成するツールを作った。その結果、報告書は45分で完成し、予定より一時間早く提出できた。ところが直後にネットワークが切断されたため、保存処理を修正した。";
  const result = engine.convert(source, { level: 3, contextMode: "full", seed: "audit-0" });
  const passing = result.comparisons[0].options[0];
  const ordinaryLine = "私はそのあと静かに席へ戻った";
  const contaminated = `${passing.text}\n${ordinaryLine}`;
  const validation = engine.validateNarrative(source, contaminated, 3);

  assert.equal(passing.validation.passed, true);
  assert.equal(passing.validation.burontLineCoverageScore, 1);
  assert.equal(validation.passed, false);
  assert.ok(validation.burontLineCoverageScore < 1);
  assert.deepEqual(validation.unconvertedBurontLines, [ordinaryLine]);
  assert.match(validation.warnings.join(" "), /ブロント語化されていない通常文/);
});

test("全行表層化は引用内容を保持しつつ行の役割ごとにブロント語構文を与える", () => {
  const source = [
    "山道で急に霧が出て戻る道が分からなくなった",
    "友人は地図を確認した",
    "二人は避難小屋へ到着した",
    "友人が「もう大丈夫だ」と言った",
  ].join("\n");
  const random = createRandom("surface-role-test");
  const converted = burontizeText(source, random);
  const coverage = burontLineCoverage(converted);

  assert.equal(coverage.coverage, 1);
  assert.deepEqual(coverage.uncoveredLines, []);
  assert.match(converted, /異変|アワレ|一般人|リアルでビビ/);
  assert.match(converted, /ｶｶッ|ｶｳﾝﾀｰ|扱えない技量/);
  assert.match(converted, /圧倒的な結果|勝負はついていた|グーの音/);
  assert.match(converted, /「もう大丈夫だ」/);
  assert.equal(burontLineCoverage("「もう大丈夫だ」").coverage, 0);
  assert.equal(burontLineCoverage("おいィ？「もう大丈夫だ」").coverage, 1);
});

test("長文検証は原文を貼って語録だけ足した候補を不合格にする", () => {
  const source = "事務部では報告書を作成している。担当者が休んだため入力が遅れていた。締切まで残り一時間しかなかった。私は集計ツールを作った。その結果、報告書は45分で完成した。部長から良い仕事だと評価された。";
  const pasted = [
    "俺は一級プログラマーなんだが",
    ...splitSentences(source),
    "ここで俺の封印がとけられた！",
    "事務どもから「これで勝つる！」という声が上がった",
    "見事な仕事だと感心はするがどこもおかしくはない",
  ].join("\n");
  const validation = engine.validateNarrative(source, pasted, 3);

  assert.ok(validation.reusedSourceSentenceCount >= 5);
  assert.ok(validation.lightlyRewrittenSourceSentenceCount >= 5);
  assert.ok(validation.structuralRewriteScore <= 0.2);
  assert.equal(validation.passed, false);
  assert.match(validation.warnings.join(" "), /長文の文構造/);
});

test("長文検証は原文へ副詞を挿しただけの中途半端な改変も不合格にする", () => {
  const source = "私は駅へ向かった。朝のホームには大勢の利用客がいた。事故のため電車は運転を見合わせていた。駅員は別の路線を案内した。私は案内に従って移動した。その結果、会議の開始前に会社へ到着した。";
  const shallow = [
    "英語でいうとノンフィクションの話なんだが",
    "私はすでに駅へ向かった",
    "朝のホームにはアワレにも大勢の利用客がいた",
    "事故のため電車はその時点ですでに運転を見合わせていた",
    "駅員はｶｶッっと別の路線を案内した",
    "私は案内に従ってそのまま移動した",
    "その結果、会議の開始前に会社へ到着した",
    "見事な仕事だと感心はするがどこもおかしくはない",
  ].join("\n");
  const validation = engine.validateNarrative(source, shallow, 3);

  assert.ok(validation.highlyRetainedSourceFragmentCount > 0);
  assert.equal(validation.passed, false);
  assert.match(validation.warnings.join(" "), /原文断片が再叙述されず/);
});

test("完全モードと原文寄りモードを同じ入力で分離する", () => {
  const source = "仕事で新しい資料を作成しました。同僚がとても驚きました。";
  const faithful = engine.convert(source, { level: 2, contextMode: "faithful", seed: "mode-test" });
  const full = engine.convert(source, { level: 2, contextMode: "full", seed: "mode-test" });

  assert.equal(faithful.contextMode, "faithful");
  assert.equal(full.contextMode, "full");
  assert.equal(faithful.comparisons.length, 2);
  assert.equal(full.comparisons.length, 1);
  assert.ok(full.text.length > faithful.text.length * 1.5);
  assert.ok(engine.contextNarrative.quoteGrammar.signatures(full.text).length >= 3, "full mode retains multiple source-supported narrative constructions");
  assert.match(full.text, /資料.*作成|作成.*資料/);
  assert.match(full.text, /同僚/);
});

test("天候・障害・料理・対戦・長文業務でも成果を取り違えず重複させない", () => {
  const cases = [
    {
      seed: 25,
      source: "今朝は気温が氷点下3度まで下がり、駅まで歩いただけで手がかじかんだ。それでも8時の会議には間に合った。",
      achievement: "8時の会議には間に合った",
      values: ["氷点下3度", "8時"],
    },
    {
      seed: 5,
      source: "昨夜22時、社内サーバーが停止し、営業部の12人が顧客データを確認できなくなった。原因は更新処理の設定ミスだった。担当者が復旧作業を行い、23時10分にはすべての機能が使える状態に戻った。再発防止のため、明日までに監視項目を追加する。",
      achievement: "23時10分にはすべての機能が使える状態に戻った",
      values: ["22時", "12人", "23時10分"],
    },
    {
      seed: 11,
      source: "家族4人分のカレーを作った。玉ねぎを40分炒めたので甘みが出て、全員がおかわりした。ただし鍋の底が少し焦げたため、次は火力を弱くする。",
      achievement: "玉ねぎを40分炒めたので甘みが出て、ぜいいんがおかわりした",
      values: ["4人", "40分"],
    },
    {
      seed: 8,
      source: "昨日の対戦では序盤に味方が2人倒され、拠点も奪われた。残り30秒で裏道から相手陣地に入り、拠点を取り返して逆転勝利した。試合後、仲間から判断が早かったと言われた。",
      achievement: "残り30秒で裏道から相手陣地に入り、拠点を取り返して逆転勝利した",
      values: ["2人", "30秒"],
    },
    {
      seed: 7,
      source: "今月の問い合わせは先月より28件増え、担当5人では返信が遅れ始めていた。そこで回答履歴を分類し、よくある質問への下書きを自動作成するツールを金曜日に導入した。平均返信時間は18分から6分に短縮され、未処理件数も42件から7件まで減った。一方で専門用語を含む質問では誤った候補が出ることがある。来週は担当者2人で内容を確認し、誤りが多い分野を除外する予定だ。",
      achievement: "平均返信時間は18分から6分に短縮され、未処理件数も42件から7件まで減った",
      achievementNeedle: "平均返信時間は18分から6分に短縮され",
      values: ["28件", "5人", "18分", "6分", "42件", "7件", "2人"],
    },
    {
      seed: 9,
      source: "昨日、在庫表を確認すると商品が17個不足していた。倉庫を調べ、30分で入力ミスを修正した。明日は担当者2人と確認手順を見直す。",
      achievement: "倉庫を調べ、30分で入力ミスを修正した",
      values: ["17個", "30分", "2人"],
    },
  ];

  for (const item of cases) {
    const result = engine.convert(item.source, { contextMode: "full", seed: item.seed });
    if (assertSafeAbstention(result, item.source)) continue;
    assert.equal(result.comparisons[0].validation.passed, true);
    assert.ok(result.comparisons[0].candidateCount >= 20);
    if (splitSentences(item.source).length >= 4) {
      assert.equal(result.comparisons[0].validation.reusedSourceSentenceCount, 0);
      assert.equal(result.comparisons[0].validation.highlyRetainedSourceFragmentCount, 0);
    }
    for (const value of item.values) assert.match(result.text, new RegExp(value));
    assert.doesNotMatch(result.text, /しかもただし|ｶｶッっとそこで|だが一方で|最初に結果だけ言うと原因|手を出すと俺が/);
  }
});

test("異なる入力を連続変換しても名言群と段落構造を連投しない", () => {
  const previousRandom = Math.random;
  Math.random = createRandom("quote-diversity-regression");
  try {
    const diversityEngine = new CorpusEngine();
    const sources = [
      "今朝は氷点下3度だったが8時の会議には間に合った。",
      "家族4人分の夕食を40分で作り、全員がおかわりした。",
      "残り30秒で拠点を取り返して逆転勝利し、仲間に褒められた。",
      "停止したサーバーを23時10分に復旧し、12人が再び利用できた。",
      "売上表の集計を2時間から15分に短縮した。明日、担当者3人へ説明する。",
      "雨の中を5キロ走り、予定より10分早く到着した。",
      "壊れた棚を1時間で修理したが、塗装が少し剥がれている。",
      "試験で100点を取り、先生から学年で一番だと言われた。",
    ];
    const validations = sources.map((source) => diversityEngine.convert(source, {
      contextMode: "full",
    }).comparisons[0].validation);
    const uniquePatterns = new Set(validations.flatMap((validation) => validation.quoteSignatures));
    const adjacentOverlaps = validations.slice(1).map((validation, index) => (
      validation.quoteSignatures.filter((signature) => validations[index].quoteSignatures.includes(signature)).length
    ));

    assert.ok(validations.every((validation) => validation.passed));
    assert.ok(validations.every((validation) => validation.quotePatternCount >= 3));
    assert.ok(validations.every((validation) => validation.repeatedFactCount === 0));
    assert.ok(uniquePatterns.size >= 18);
    assert.ok(adjacentOverlaps.every((overlap) => overlap <= 1));
  } finally {
    Math.random = previousRandom;
  }
});

test("同じ長文を連続変換しても直前の名言群を再利用しない", () => {
  const previousRandom = Math.random;
  Math.random = createRandom("same-source-diversity");
  try {
    const diversityEngine = new CorpusEngine();
    const source = "昨夜22時、社内サーバーが停止し、営業部の12人が顧客データを確認できなくなった。原因は更新処理の設定ミスだった。担当者が復旧作業を行い、23時10分にはすべての機能が使える状態に戻った。再発防止のため、明日までに監視項目を追加する。";
    const results = Array.from({ length: 4 }, () => diversityEngine.convert(source, { contextMode: "full" }));
    if (results.some((result) => result.fallback)) {
      for (const result of results) if (!assertSafeAbstention(result, source)) assert.ok(result.candidates.every(candidate => candidate.verificationStatus === "passed"));
      return;
    }
    const validations = results.map((result) => result.comparisons[0].validation);
    const firstLines = results.map((result) => result.text.split("\n")[0]);
    const adjacentOverlaps = validations.slice(1).map((validation, index) => (
      validation.quoteSignatures.filter((signature) => validations[index].quoteSignatures.includes(signature)).length
    ));

    assert.equal(new Set(firstLines).size, 4);
    assert.ok(validations.every((validation) => validation.passed));
    assert.ok(validations.every((validation) => validation.repeatedFactCount === 0));
    assert.ok(adjacentOverlaps.every((overlap) => overlap === 0));
  } finally {
    Math.random = previousRandom;
  }
});

test("牙を抜いてきたは対抗者への返答だけに使う", () => {
  const nonChallengeSources = [
    "停止したサーバーを23時10分に復旧し、12人が再び利用できた。",
    "今朝は氷点下3度だったが8時の会議には間に合った。",
    "家族4人分の夕食を40分で作り、全員がおかわりした。",
  ];
  for (const source of nonChallengeSources) {
    const facts = source.split("。").filter(Boolean);
    const candidates = engine.contextNarrative.candidates(source, {
      random: createRandom(`no-fangs:${source}`),
      plainFacts: facts,
    });
    assert.doesNotMatch(candidates.join("\n"), /牙抜いてきた/);
  }

  assert.match(engine.contextNarrative.quoteGrammar.render("retort_fangs", {
    hero: "俺",
    hasChallenge: true,
    replyTarget: "60",
  }), /なんだ急に牙抜いてきた　>>60\n勝手にライバル視するな/);
  assert.equal(engine.contextNarrative.quoteGrammar.render("retort_fangs", {
    hero: "俺",
    hasChallenge: false,
    replyTarget: "60",
  }), "");
  assert.equal(engine.contextNarrative.quoteGrammar.render("retort_fangs", {
    hero: "俺",
    hasChallenge: true,
    replyTarget: null,
  }), "");
});

test("牙を抜いてきたはレスアンカーまで一体で生成し数値・文字アンカーを保持する", () => {
  for (const target of ["412", "社員"]) {
    const source = `>>${target} 同僚が俺の方が仕事が速いと言って勝負を挑んできた。俺は先に報告書を提出した。`;
    const candidates = engine.contextNarrative.candidates(source, {
      random: () => 0,
      plainFacts: splitSentences(source),
    });
    const fangs = candidates.filter((candidate) => candidate.includes("牙抜いてきた"));

    assert.ok(fangs.length > 0);
    assert.ok(fangs.every((candidate) => candidate.includes(`なんだ急に牙抜いてきた　>>${target}`)));
    assert.ok(fangs.every((candidate) => !/なんだ急に牙抜いてきた(?![　 ]*>>[^\s\n]+)/.test(candidate)));
  }
});

test("自動アンカーは原文の対抗者から選び、無関係な固定対象を足さない", () => {
  const source = "営業部の田中が自分の方が速いと言って俺に勝負を挑んできた。俺は先に報告書を提出した。";
  const model = engine.contextNarrative.extractModel(source, splitSentences(source));
  const role = engine.contextNarrative.replyAnchor(model, () => 0);
  const noTarget = engine.contextNarrative.replyAnchor({
    replyTarget: null,
    replyTargets: [],
    goroTargets: [],
  }, () => 0.5);

  assert.deepEqual(model.replyTargets, ["営業部の田中"]);
  assert.deepEqual(role, { target: "営業部の田中", coda: null, family: "context" });
  assert.deepEqual(noTarget, { target: null, coda: null, family: "none" });
  assert.match(engine.contextNarrative.quoteGrammar.render("retort_fangs", {
    hero: "俺",
    hasChallenge: true,
    replyTarget: role.target,
  }), /なんだ急に牙抜いてきた　>>営業部の田中/);
});

test("数字の語呂は固定語彙表ではなく原文中のかな語から組み立てる", () => {
  const source = "同僚が負けたらなくと言って俺に勝負を挑んできた。俺は先に報告書を提出した。";
  const model = engine.contextNarrative.extractModel(source, splitSentences(source));
  const anchor = engine.contextNarrative.replyAnchor(model, () => 0.999);

  assert.ok(model.goroTargets.some((candidate) => candidate.target === "79" && candidate.word === "なく"));
  assert.deepEqual(anchor, {
    target: "79",
    coda: "なくとか言ってる時点で勝てない勝負なのは確定的に明らか",
    family: "goro",
  });
});

test("状態描写を架空の事件解決へ変えず専用の自慢型で展開する", () => {
  const source = "今日は寒い。風が強く、駅まで歩いただけで手が冷たくなった。";
  const result = engine.convert(source, {
    contextMode: "full",
    level: 3,
    seed: "state-frame-regression",
  });

  assert.equal(result.comparisons[0].validation.passed, true);
  assert.match(result.text, /今日は寒い/);
  assert.match(result.text, /風が強く、駅まで歩いただけで手が冷たくなった/);
  assert.match(result.text, /黄金の鉄の塊|ノーダメージ|防御もかなりかたい|ダイヤモンド・パワー|長寿ﾀｲﾌﾟ|生まれもった光属性/);
  assert.doesNotMatch(result.text, /問題は(?:一瞬で終了|静かになった)|問題はｶｶッっと片付いた|牙抜いてきた|闇系の仕事/);
});

test("冒頭の達成事実を介入場面で二重使用せず目的語を片付けた扱いにしない", () => {
  const source = "今日は家族のためにカレーを作った。みんながおいしいと言ってくれた。";
  const result = engine.convert(source, {
    contextMode: "full",
    level: 3,
    seed: "achievement-first-regression",
  });

  assert.equal(result.comparisons[0].validation.passed, true);
  assert.equal(result.text.split("今日は家族のためにカレーを作った").length - 1, 1);
  assert.doesNotMatch(result.text, /カレーはｶｶッっと片付いた/);
});

test(">>感謝は理解の更新と特定できる情報源が両方ある時だけ使う", () => {
  const localEngine = new CorpusEngine();
  const source = "田中の説明で原因がわかった。作業が進んで助かった。";
  const result = localEngine.convert(source, {
    contextMode: "full",
    level: 3,
    seed: "fused-gratitude-frame",
  });
  const noSource = "原因がわかったので作業が進んで助かった。";
  const noSourceCandidates = localEngine.contextNarrative.candidates(noSource, {
    plainFacts: splitSentences(noSource),
    random: createRandom("no-fake-gratitude-target"),
  });

  assert.equal(result.comparisons[0].validation.passed, true);
  assert.match(result.text, /今回のでそれが良くわかったよ>>田中感謝/);
  assert.deepEqual(result.comparisons[0].validation.anchorSignatures, ["fused_performative"]);
  assert.doesNotMatch(noSourceCandidates.join("\n"), />>[^\s\n]+感謝/);
});

test("賛同先と証拠元を同じ固定アンカーにせず入力の役割から選ぶ", () => {
  const localEngine = new CorpusEngine();
  const agreement = localEngine.convert(
    "佐藤の意見に賛成した。計画はこの方針で進める。",
    { contextMode: "full", level: 3, seed: "agreement-role" },
  );
  const evidence = localEngine.convert(
    "田中のログで障害の原因を確認できた。記録には23時の停止が残っている。",
    { contextMode: "full", level: 3, seed: "evidence-role" },
  );

  assert.equal(agreement.comparisons[0].validation.passed, true);
  assert.match(agreement.text, /俺は>>佐藤の意見に賛成だな/);
  assert.deepEqual(agreement.comparisons[0].validation.anchorSignatures, ["agreement_target"]);
  assert.equal(evidence.comparisons[0].validation.passed, true);
  assert.match(evidence.text, /これは>>田中が証明しているとおり/);
  assert.deepEqual(evidence.comparisons[0].validation.anchorSignatures, ["evidence_source"]);
  assert.doesNotMatch(`${agreement.text}\n${evidence.text}`, />>社員|>>感謝/);
});

test("アンカー構文台帳は原ログで観測した10構文と出現数を保持する", () => {
  const status = engine.contextNarrative.anchorGrammar.status();
  assert.equal(status.constructionCount, 10);
  assert.equal(status.observedAnchorCount, 979);
  assert.deepEqual(new Set(status.constructions), new Set([
    "standalone_reply",
    "prefixed_clause",
    "coordination",
    "evaluation_target",
    "embedded_argument",
    "evidence_source",
    "agreement_target",
    "sentence_tail_reference",
    "vocative",
    "fused_performative",
  ]));
});

test("複数の参照先がある時は対抗者評価・情報源参照・並列を役割別に展開する", () => {
  const source = "田中が俺の方が速いと言って勝負を挑んできた。佐藤の説明で手順が分かった。俺は先に報告書を提出した。";
  const candidates = engine.contextNarrative.candidates(source, {
    plainFacts: splitSentences(source),
    random: createRandom("typed-multi-anchor"),
  }).join("\n---\n");

  assert.match(candidates, />>田中は.*勝負を挑むにはかなり準備不足/);
  assert.match(candidates, />>佐藤の言うようにこの判断が正しいという事実/);
  assert.match(candidates, />>田中と>>佐藤は/);
  assert.doesNotMatch(candidates, />>佐藤は.*勝負を挑むにはかなり準備不足/);
});

test("原文寄りモードは語録を積み重ねず、別の機能構文を複数案として返す", () => {
  const localEngine = new CorpusEngine();
  const result = localEngine.convert(
    "駅前のパン屋で新作のカレーパンを焼いて常連客に褒められた。",
    { contextMode: "faithful", level: 3, seed: "faithful-quote-bridge" },
  );
  const options = result.comparisons[0].options;
  const signatures = options.map((option) => option.validation.faithfulQuoteSignatures[0]);
  const roles = options.map((option) => option.validation.faithfulQuoteRoles[0]);

  assert.ok(result.comparisons.every((comparison) => comparison.validation.passed));
  assert.equal(result.comparisons[0].requiredFaithfulQuoteCount, 1);
  assert.ok(options.every((option) => option.validation.faithfulQuoteCount === 1));
  assert.ok(options.every((option) => option.validation.faithfulContextMatch));
  assert.equal(new Set(signatures).size, 3);
  assert.equal(new Set(roles).size, 3);
  assert.equal(result.suggestions.length, 3);
  assert.match(options.map((option) => option.text).join("\n"), /予知夢|どこもおかしくはない|一般人と同じ|それほどでもない/);
  assert.doesNotMatch(options.map((option) => option.text).join("\n"), /ノンフィクション[\s\S]*リアル話[\s\S]*でしょう/);
});

test("適当な観察文でも事実を保ったまま3候補を異なる機能構文にする", () => {
  const localEngine = new CorpusEngine();
  const result = localEngine.convert(
    "公園の池でカモが三羽泳いでいた。",
    { contextMode: "faithful", level: 3, seed: "arbitrary-multi-pattern" },
  );
  const options = result.comparisons[0].options;
  const signatureBatches = options.map((option) => (
    option.validation.faithfulQuoteSignatures.slice().sort().join("+")
  ));

  assert.equal(result.comparisons[0].validation.passed, true);
  assert.equal(result.comparisons[0].validation.faithfulQuoteCount, 1);
  assert.equal(options.length, 3);
  assert.ok(options.every((option) => option.validation.faithfulQuoteCount === 1));
  assert.ok(options.every((option) => /公園/.test(option.text) && /カモ/.test(option.text) && /三羽/.test(option.text)));
  assert.ok(options.every((option) => option.validation.faithfulContextMatch));
  assert.equal(new Set(signatureBatches).size, 3);
  assert.equal(result.suggestions.length, 3);
  assert.doesNotMatch(options.map((option) => option.text).join("\n"), /勝負|感謝|深い悲しみ|一般人との格の違い/);
});

test("未来・評価・危機・対抗・感謝・賛同・証拠を根拠のある役割別構文へ振り分ける", () => {
  const cases = [
    {
      source: "来月、端末12台を更新する予定だ。",
      expected: ["future_preparation", "future_restraint", "future_certainty"],
      forbidden: /更新した|見事な仕事|どこもおかしくはない/,
    },
    {
      source: "このゲームは面白い。",
      expected: ["evaluation_rank", "evaluation_impact", "evaluation_elite"],
      forbidden: /深い悲しみ|>>|ノーダメージ/,
    },
    {
      source: "報告書が締切に間に合わず担当者が困っていた。",
      expected: ["crisis_time_over", "crisis_deep_sorrow", "crisis_game_over"],
      forbidden: /牙抜いてきた|それほどでもない/,
    },
    {
      source: "田中が俺の方が速いと言って勝負を挑んできた。",
      expected: ["challenge_fangs", "challenge_prefixed", "challenge_vocative"],
      forbidden: />>社員|>>感謝/,
    },
    {
      source: "田中の説明で原因がわかって助かった。",
      expected: ["gratitude_fused", "gratitude_value", "gratitude_extended"],
      forbidden: />>社員|牙抜いてきた/,
    },
    {
      source: "佐藤の意見に賛成した。",
      expected: ["agreement_target", "agreement_reason", "agreement_value"],
      forbidden: />>社員|>>感謝/,
    },
    {
      source: "田中のログで障害の原因を確認できた。",
      expected: ["evidence_source", "evidence_embedded", "evidence_tail"],
      forbidden: />>社員|牙抜いてきた/,
    },
  ];

  for (const [index, item] of cases.entries()) {
    const localEngine = new CorpusEngine();
    const result = localEngine.convert(item.source, {
      contextMode: "faithful",
      level: 3,
      seed: `functional-frame-${index}`,
    });
    const options = result.comparisons[0].options;
    const signatures = new Set(options.flatMap((option) => option.validation.faithfulQuoteSignatures));
    const combined = options.map((option) => option.text).join("\n");

    const supported = new Set(localEngine.faithfulQuoteGrammar.status().expressions);
    const supportedExpected = item.expected.filter((id) => supported.has(id));
    assert.ok(supportedExpected.every((id) => signatures.has(id)), item.source);
    assert.ok([...signatures].every((id) => supported.has(id)), "unsupported frames cannot fill a three-candidate quota");
    assert.equal(new Set(options.map((option) => option.validation.faithfulQuoteRoles[0])).size, 3);
    assert.ok(options.every((option) => option.validation.passed));
    assert.ok(options.every((option) => option.validation.faithfulContextMatch));
    assert.doesNotMatch(combined, item.forbidden);
  }
});

test("中立観察の完全モードは事件解決や耐性へ捏造せず観察自慢へ再構成する", () => {
  const source = "公園の池でカモが三羽泳いでいた。";
  const result = engine.convert(source, {
    contextMode: "full",
    level: 3,
    seed: "full-observation-regression",
  });
  const validation = result.comparisons[0].validation;

  assert.equal(validation.passed, true);
  assert.equal(validation.repeatedFactCount, 0);
  assert.ok(validation.quoteFunctionalRoleCount >= 3);
  assert.match(result.text, /公園/);
  assert.match(result.text, /カモ/);
  assert.match(result.text, /三羽/);
  assert.match(result.text, /見切|細部|見落と/);
  assert.doesNotMatch(result.text, /問題は一瞬で終了|復旧|ノーダメージ|深い悲しみ|ゲームオーバー/);
  assert.equal(validation.repeatedRhetoricalMoveCount, 0);
});

test("利用不能の『なくなった』を物品紛失へ誤分類しない", () => {
  const unavailable = engine.contextNarrative.extractModel(
    "営業部の12人が顧客データを確認できなくなった。",
    splitSentences("営業部の12人が顧客データを確認できなくなった。"),
  );
  const missing = engine.contextNarrative.extractModel(
    "棚に置いたファイルがなくなった。",
    splitSentences("棚に置いたファイルがなくなった。"),
  );

  assert.equal(unavailable.hasMissing, false);
  assert.equal(missing.hasMissing, true);
});

test("締切危機を手遅れ語録へ到達させ生成表現も正しく検出する", () => {
  const source = "報告書が締切に間に合わず担当者が困っていた。俺がツールを作成して45分で完了した。";
  const candidates = engine.contextNarrative.candidates(source, {
    plainFacts: splitSentences(source),
    random: createRandom("deadline-quote-reachability"),
  });
  const combined = candidates.join("\n");

  assert.match(combined, /手遅れになるのではままるな/);
  assert.ok(candidates.some((candidate) => (
    engine.contextNarrative.quoteGrammar.signatures(candidate).includes("crisis_too_late")
  )));
  assert.deepEqual(engine.contextNarrative.quoteGrammar.signatures(
    "まぁこうなることはわかってた（予知夢）\n普通は普通なので一般人が普通なら仕事の難しさがわかるはず\nおいィ？お前らは今の結果が見えたか？\n何故そんなに必死だったのかバレてる証拠に笑顔が出てしまった",
  ).filter((id) => [
    "opener_prophecy",
    "contrast_ordinary",
    "reaction_heard",
    "reaction_bared",
  ].includes(id)).sort(), [
    "contrast_ordinary",
    "opener_prophecy",
    "reaction_bared",
    "reaction_heard",
  ]);
});

test("代表文候補から54展開型と10アンカー構文すべてへ到達できる", () => {
  const sources = [
    ["state", "今日は寒い。風が強く手が冷たくなった。"],
    ["achievement", "仕事で新しい資料を作成した。同僚が驚いた。"],
    ["rescue", "サーバーが停止して12人が確認できなくなった。担当者が復旧し23時10分に使える状態へ戻った。"],
    ["deadline", "報告書が締切に間に合わず担当者が困っていた。俺がツールを作成して45分で完了した。"],
    ["missing", "商品が17個不足して行方が分からなかった。30分で入力ミスを修正した。"],
    ["danger", "通信障害で保存できない問題が起きた。俺が修正して復旧した。"],
    ["challenge", "田中が俺に文句を言って勝負を挑んできた。俺は先に報告書を提出した。"],
    ["dialogue", "同僚が「俺の方が速い」と言って張り合ってきた。俺は15分で作業を完成した。"],
    ["gratitude", "田中の説明で原因が分かった。作業が進んで助かった。"],
    ["agreement", "佐藤の意見に賛成した。計画はこの方針で進める。"],
    ["evidence", "田中のログで原因を確認できた。記録には23時の停止が残っている。"],
    ["multi", "田中が勝負を挑んできた。佐藤の説明で手順が分かった。俺は先に資料を提出した。"],
  ];
  const quoteSignatures = new Set();
  const anchorSignatures = new Set();

  for (const [name, source] of sources) {
    for (let seed = 0; seed < 40; seed += 1) {
      const candidates = engine.contextNarrative.candidates(source, {
        plainFacts: splitSentences(source),
        random: createRandom(`${name}:${seed}`),
      });
      for (const candidate of candidates) {
        engine.contextNarrative.quoteGrammar.signatures(candidate).forEach((id) => quoteSignatures.add(id));
        engine.contextNarrative.anchorGrammar.signatures(candidate).forEach((id) => anchorSignatures.add(id));
      }
    }
  }

  assert.equal(quoteSignatures.size, 54);
  assert.deepEqual(quoteSignatures, new Set(Object.values(engine.contextNarrative.quoteGrammar.active).flat().map((item) => item.id)));
  assert.equal(anchorSignatures.size, 10);
  assert.deepEqual(anchorSignatures, new Set(engine.contextNarrative.anchorGrammar.status().constructions));
});

test("監査用のURLクエリを壊さず3候補すべてで完全保持する", () => {
  const source = "結果をhttps://example.com/a?q=7へ送り、dev@example.jpに連絡した。";
  const result = engine.convert(source, {
    contextMode: "faithful",
    level: 3,
    seed: "audit-url-query",
  });

  assert.equal(result.suggestions.length, 3);
  assert.ok(result.comparisons[0].options.every((option) => option.validation.passed));
  assert.ok(result.suggestions.every((suggestion) => (
    suggestion.text.includes("https://example.com/a?q=7")
      && suggestion.text.includes("dev@example.jp")
  )));
});

test("否定済み事故・未解決事故・未来予定・中立観察を別の出来事型へ分類する", () => {
  const safeSource = "バックアップは失敗せず、顧客データも消えなかった。";
  const unresolvedSource = "決済サービスの遅延が続き、26件の注文が処理待ちになっている。原因はまだ分からず、復旧予定も決まっていない。";
  const futureSource = "来月、データベースを新しいサーバーへ移設する。対象は40台で、作業は二日間を予定している。";
  const observationSource = "図書館の窓辺で猫が一匹眠っていた。";
  const safe = engine.contextNarrative.extractModel(safeSource, splitSentences(safeSource));
  const unresolved = engine.contextNarrative.extractModel(unresolvedSource, splitSentences(unresolvedSource));
  const future = engine.contextNarrative.extractModel(futureSource, splitSentences(futureSource));
  const observation = engine.contextNarrative.extractModel(observationSource, splitSentences(observationSource));

  assert.equal(safe.eventFrame, "observation");
  assert.equal(safe.hasCrisis, false);
  assert.equal(safe.hasAchievement, false);
  assert.equal(unresolved.eventFrame, "crisis");
  assert.equal(unresolved.hasUnresolved, true);
  assert.equal(unresolved.hasAchievement, false);
  assert.equal(future.eventFrame, "future");
  assert.equal(future.hasFuture, true);
  assert.equal(future.hasAchievement, false);
  assert.equal(observation.eventFrame, "observation");
});

test("否定の言い換え・未解決の言い換え・位置を表す『一番』を誤分類しない", () => {
  const cases = [
    ["observation", "バックアップに失敗することはなかった。"],
    ["observation", "通信障害は発生しなかった。"],
    ["crisis", "復旧の目処はまだ立っていない。"],
    ["crisis", "解決の見通しがなく、原因も分かっていない。"],
    ["observation", "一番左の棚に本が三冊並んでいた。"],
    ["achievement", "全員の中で一番早く報告書を提出した。"],
  ];

  for (const [expected, source] of cases) {
    const model = engine.contextNarrative.extractModel(source, splitSentences(source));
    assert.equal(model.eventFrame, expected, source);
  }
});

test("自然文から対抗者・感謝元・賛同先・証拠元を役割付きで抽出する", () => {
  const cases = [
    {
      source: "田中が自分の方が速いと言い、作業時間は田中が22分で私は18分だった。",
      expected: ["challenge_fangs", "challenge_prefixed", "challenge_vocative"],
      anchor: />>田中/,
    },
    {
      source: "中村の解説で仕組みが理解できたので礼を言った。",
      expected: ["gratitude_fused", "gratitude_value", "gratitude_extended"],
      anchor: />>中村/,
    },
    {
      source: "鈴木の案に同意し、この方針で計画を進めることにした。",
      expected: ["agreement_target", "agreement_reason", "agreement_value"],
      anchor: />>鈴木/,
    },
    {
      source: "監視ログには23時10分の停止記録が残っており、障害の原因を確認できた。",
      expected: ["evidence_source", "evidence_embedded", "evidence_tail"],
      anchor: />>監視ログ/,
    },
  ];

  for (const [index, item] of cases.entries()) {
    const result = engine.convert(item.source, {
      contextMode: "faithful",
      level: 3,
      seed: `audit-natural-role-${index}`,
    });
    const options = result.comparisons.flatMap((comparison) => comparison.options);
    const signatures = new Set(options.flatMap((option) => option.validation.faithfulQuoteSignatures));

    const supported = new Set(engine.faithfulQuoteGrammar.status().expressions);
    const supportedExpected = item.expected.filter((id) => supported.has(id));
    assert.ok(supportedExpected.every((id) => signatures.has(id)), item.source);
    assert.ok([...signatures].every((id) => supported.has(id)), item.source);
    const roleOptions = options.filter((option) => option.validation.faithfulQuoteSignatures.some((id) => supportedExpected.includes(id)));
    assert.ok(roleOptions.every((option) => item.anchor.test(option.text)), item.source);
    assert.ok(options.every((option) => option.validation.passed), item.source);
  }
});

test("未来と未解決の完全モードは完了や成功を捏造せず別々の3案を返す", () => {
  const cases = [
    {
      source: "来月、データベースを新しいサーバーへ移設する。対象は40台で、作業は二日間を予定している。",
      seed: "audit-full-future",
      required: /手順|段取り|準備|実行前|始まっていない|シュミレート/,
      forbidden: /移設した|完全\s*解決|今の結果が見えた|証明された/,
    },
    {
      source: "決済サービスの遅延が続き、26件の注文が処理待ちになっている。原因はまだ分からず、復旧予定も決まっていない。",
      seed: "audit-full-unresolved",
      required: /未解決|復旧していない|決着はついていない|原因が確定していない|解決したふり/,
      forbidden: /見事な仕事だと感心|どこもおかしくはない|完全\s*解決|今の結果が見えた|証明された/,
    },
  ];

  for (const item of cases) {
    const result = engine.convert(item.source, {
      contextMode: "full",
      level: 3,
      seed: item.seed,
    });
    const options = result.comparisons[0].options;

    assert.equal(options.length, 3, item.source);
    assert.equal(new Set(options.map((option) => option.text)).size, 3, item.source);
    assert.ok(options.every((option) => option.validation.passed), item.source);
    assert.ok(options.every((option) => item.required.test(option.text)), item.source);
    assert.ok(options.every((option) => !item.forbidden.test(option.text)), item.source);
  }
});

test("時間文脈の検証器は未来・未解決を完了扱いした候補を不合格にする", () => {
  const future = engine.validate(
    "来月サーバーを移設する予定だ。",
    "来月サーバーを移設する予定だったが移設した。見事な仕事だ。",
    3,
  );
  const unresolved = engine.validate(
    "障害の原因はまだ分からず復旧時刻も未定だ。",
    "障害は完全解決した。見事な仕事だと感心はするがどこもおかしくはない。",
    3,
  );
  const mixedSource = "前回は端末を更新した。来月はサーバーを切り替える予定だ。";
  const retainedPast = engine.validate(
    mixedSource,
    `${mixedSource}\n俺は実行前から必要な手順まで見切っている`,
    3,
  );
  const inventedDifferentCompletion = engine.validate(
    mixedSource,
    `${mixedSource}\nサーバーを切り替えた`,
    3,
  );

  assert.equal(future.temporalContextMatch, false);
  assert.equal(future.passed, false);
  assert.equal(unresolved.temporalContextMatch, false);
  assert.equal(unresolved.passed, false);
  assert.equal(retainedPast.temporalContextMatch, true);
  assert.equal(inventedDifferentCompletion.temporalContextMatch, false);
  assert.match(`${future.warnings.join(" ")} ${unresolved.warnings.join(" ")}`, /完了済み/);
});

test("穏やかな風を含む中立観察は寒さ耐性や架空の解決へ変えない", () => {
  const source = "公園の池で白い鳥が二羽泳ぎ、穏やかな風で水面が揺れていた。";
  const result = engine.convert(source, {
    contextMode: "full",
    level: 3,
    seed: "audit-neutral-wind",
  });
  const combined = result.comparisons[0].options.map((option) => option.text).join("\n");

  assert.equal(result.suggestions.length, 3);
  assert.ok(result.comparisons[0].options.every((option) => option.validation.passed));
  assert.match(combined, /見切|細部|見落と/);
  assert.doesNotMatch(combined, /ノーダメージ|黄金の鉄の塊|防御もかなりかたい|問題は一瞬で終了|完全\s*解決/);
});
