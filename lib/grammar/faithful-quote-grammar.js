"use strict";

const { shuffle } = require("./random-utils");
const quoteCorpus = require("../../data/quote-corpus.json");

function stripEnding(value) {
  return String(value ?? "").trim().replace(/[。！？!?]+$/g, "");
}

function topicEffect(model) {
  if (model.topic === "寒さ") return "手足の感覚が消えて寿命がﾏｯﾊになる";
  if (model.topic === "暑さ") return "体力を持っていかれて致命的な致命傷になる";
  if (model.topic === "雨") return "装備がずぶ濡れになって動けなくなる";
  if (model.topic === "風") return "まともに前へ進めなくなる";
  if (model.topic === "疲労") return "その場で動けなくなる";
  if (model.topic === "眠気") return "判断力が下がって時既に時間切れ";
  return "かなりのダメージを受ける";
}

const frameDefinitions = Object.freeze([
  {
    id: "account_hearsay",
    role: "report",
    marker: /という話を聞いたんだが[？?]?$/,
    render: ({ fact }) => `${fact}という話を聞いたんだが？`,
  },
  {
    id: "account_nonfiction",
    role: "report",
    marker: /^英語でいうとノンフィクションの話なんだが/,
    render: ({ fact }) => `英語でいうとノンフィクションの話なんだが\n${fact}`,
  },
  {
    id: "fact_assertion",
    role: "assertion",
    marker: /という事実は確定的に明らか$/,
    render: ({ fact }) => `${fact}という事実は確定的に明らか`,
  },
  {
    id: "observation_real",
    role: "attestation",
    marker: /[（(]リアル話[）)]$/,
    render: ({ fact }) => `${fact}（リアル話）`,
  },
  {
    id: "state_threshold",
    role: "state-scale",
    priority: 3,
    marker: /普通の.+の域を超えているでしょう[？?]?$/,
    when: ({ model }) => model.eventFrame === "state" && model.topic !== "その程度の状況",
    render: ({ fact, model }) => `${fact}\nこの${model.topic}は普通の${model.topic}の域を超えているでしょう？`,
  },
  {
    id: "state_ordinary_damage",
    role: "ordinary-person-counterfactual",
    priority: 3,
    marker: /貧弱一般人なら.+(?:寿命がマッハ|致命的な致命傷|動けなく|進めなく|時間切れ)/,
    when: ({ model }) => model.eventFrame === "state" && model.topic !== "その程度の状況",
    render: ({ fact, model }) => `${fact}\n貧弱一般人なら${topicEffect(model)}`,
  },
  {
    id: "state_knight_resistance",
    role: "self-resistance",
    priority: 3,
    marker: /黄金の鉄の塊なので.+程度ではノーダメージ/,
    when: ({ model }) => model.eventFrame === "state" && model.topic !== "その程度の状況",
    render: ({ fact, model }) => `${fact}\nだが俺は黄金の鉄の塊なので${model.topic}程度ではノーダメージ`,
  },
  {
    id: "future_preparation",
    role: "prospective-readiness",
    priority: 3,
    marker: /実行前から(?:必要な)?手順まで見切っている/,
    when: ({ model }) => model.eventFrame === "future",
    render: ({ fact }) => `${fact}\n俺は実行前から必要な手順まで見切っている`,
  },
  {
    id: "future_restraint",
    role: "temporal-restraint",
    priority: 3,
    marker: /実行前から勝利扱いするのは三流/,
    when: ({ model }) => model.eventFrame === "future",
    render: ({ fact }) => `${fact}\nだが実行前から勝利扱いするのは三流`,
  },
  {
    id: "future_certainty",
    role: "preparation-certainty",
    priority: 3,
    marker: /準備の段階で格の違いが出るのは確定的に明らか/,
    when: ({ model }) => model.eventFrame === "future",
    render: ({ fact }) => `${fact}\n準備の段階で格の違いが出るのは確定的に明らか`,
  },
  {
    id: "achievement_normality",
    role: "boast-as-normality",
    priority: 3,
    marker: /見事な仕事だと感心はするがどこもおかしくはない/,
    when: ({ model }) => model.hasAchievement,
    render: ({ fact }) => `${fact}\n見事な仕事だと感心はするがどこもおかしくはない`,
  },
  {
    id: "achievement_prophecy",
    role: "result-first-prophecy",
    priority: 3,
    marker: /^まぁこうなる事はわかってた[（(]予知夢[）)]/,
    when: ({ model }) => model.hasAchievement,
    render: ({ fact }) => `まぁこうなる事はわかってた（予知夢）\n${fact}`,
  },
  {
    id: "achievement_rank",
    role: "rank-comparison",
    priority: 3,
    marker: /一般人と同じようにやってこの結果は出ない/,
    when: ({ model }) => model.hasAchievement,
    render: ({ fact }) => `${fact}\n一般人と同じようにやってこの結果は出ない`,
  },
  {
    id: "achievement_humility",
    role: "praise-denial",
    priority: 3,
    marker: /それほどでもない$/,
    when: ({ model }) => model.hasAchievement && model.hasPraise,
    render: ({ fact }) => `${fact}\nそれほどでもない`,
  },
  {
    id: "crisis_not_joke",
    role: "danger-warning",
    priority: 3,
    marker: /^ちょとｓＹレならんしょこれは・・[？?]/,
    when: ({ model }) => ["crisis", "rescue"].includes(model.eventFrame) && model.hasDanger,
    render: ({ fact }) => `ちょとｓＹレならんしょこれは・・？\n${fact}`,
  },
  {
    id: "crisis_time_over",
    role: "deadline-warning",
    priority: 3,
    marker: /手遅れになるのではままるな$/,
    when: ({ model }) => ["crisis", "rescue"].includes(model.eventFrame) && model.hasDeadline,
    render: ({ fact }) => `${fact}\n手遅れになるのではままるな`,
  },
  {
    id: "crisis_deep_sorrow",
    role: "crisis-lament",
    priority: 3,
    marker: /深い悲しみに包まれていた/,
    when: ({ model }) => ["crisis", "rescue"].includes(model.eventFrame) && model.hasCrisis,
    render: ({ fact, model }) => `${model.audience}は深い悲しみに包まれていた\n${fact}`,
  },
  {
    id: "crisis_game_over",
    role: "crisis-consequence",
    priority: 3,
    marker: /仕事がゲームオーバーになる/,
    when: ({ model }) => ["crisis", "rescue"].includes(model.eventFrame) && (model.hasDanger || model.hasDeadline),
    render: ({ fact, model }) => `${fact}\nこのままでは${model.audience}の仕事がゲームオーバーになる`,
  },
  {
    id: "challenge_fangs",
    role: "challenge-retort",
    priority: 4,
    marker: /^なんだ急に牙抜いてきた[　 ]*>>[^\s\n]+/,
    when: ({ model, opponent }) => model.hasChallenge && Boolean(opponent),
    render: ({ fact, opponent }) => `なんだ急に牙抜いてきた　>>${opponent}\n${fact}`,
  },
  {
    id: "challenge_prefixed",
    role: "challenge-warning",
    priority: 4,
    marker: /^>>[^\s\n]+は口だけで勝てると思ってるのか[？?]/,
    when: ({ model, opponent }) => model.hasChallenge && Boolean(opponent),
    render: ({ fact, opponent }) => `>>${opponent}は口だけで勝てると思ってるのか？\n${fact}`,
  },
  {
    id: "challenge_vocative",
    role: "challenge-vocative",
    priority: 4,
    marker: /^>>[^\s\n]+よ、勝手にライバル視するな/,
    when: ({ model, opponent }) => model.hasChallenge && Boolean(opponent),
    render: ({ fact, opponent }) => `>>${opponent}よ、勝手にライバル視するな\n${fact}`,
  },
  {
    id: "gratitude_fused",
    role: "recognition-gratitude",
    priority: 4,
    marker: /今回のでそれが良くわかったよ>>[^\s\n]+感謝/,
    when: ({ model, sourceTarget }) => model.eventFrame === "gratitude" && Boolean(sourceTarget),
    render: ({ fact, sourceTarget }) => `${fact}\n今回のでそれが良くわかったよ>>${sourceTarget}感謝`,
  },
  {
    id: "gratitude_value",
    role: "source-praise",
    priority: 4,
    marker: />>[^\s\n]+はかなりののう力者だろうな/,
    when: ({ model, sourceTarget }) => model.eventFrame === "gratitude" && Boolean(sourceTarget),
    render: ({ fact, sourceTarget }) => `${fact}\n>>${sourceTarget}はかなりののう力者だろうな`,
  },
  {
    id: "gratitude_extended",
    role: "source-evaluation",
    priority: 4,
    marker: /この説明ができる時点で頼りにされるのは確定的に明らか/,
    when: ({ model, sourceTarget }) => model.eventFrame === "gratitude" && Boolean(sourceTarget),
    render: ({ fact, sourceTarget }) => `${fact}\n>>${sourceTarget}はこの説明ができる時点で頼りにされるのは確定的に明らか`,
  },
  {
    id: "agreement_target",
    role: "agreement-declaration",
    priority: 4,
    marker: /俺は>>[^\s\n]+の意見に賛成だな/,
    when: ({ model, supporter }) => model.eventFrame === "agreement" && Boolean(supporter),
    render: ({ fact, supporter }) => `${fact}\n俺は>>${supporter}の意見に賛成だな`,
  },
  {
    id: "agreement_reason",
    role: "agreement-justification",
    priority: 4,
    marker: />>[^\s\n]+の意見が正しいのは確定的に明らか/,
    when: ({ model, supporter }) => model.eventFrame === "agreement" && Boolean(supporter),
    render: ({ fact, supporter }) => `${fact}\n>>${supporter}の意見が正しいのは確定的に明らか`,
  },
  {
    id: "agreement_value",
    role: "supporter-evaluation",
    priority: 4,
    marker: />>[^\s\n]+は話がわかる奴/,
    when: ({ model, supporter }) => model.eventFrame === "agreement" && Boolean(supporter),
    render: ({ fact, supporter }) => `${fact}\n>>${supporter}は話がわかる奴`,
  },
  {
    id: "evidence_source",
    role: "evidence-attribution",
    priority: 4,
    marker: /これは>>[^\s\n]+が証明しているとおり/,
    when: ({ model, sourceTarget }) => model.eventFrame === "evidence" && Boolean(sourceTarget),
    render: ({ fact, sourceTarget }) => `${fact}\nこれは>>${sourceTarget}が証明しているとおり`,
  },
  {
    id: "evidence_embedded",
    role: "evidence-preface",
    priority: 4,
    marker: /これは>>[^\s\n]+の記録どおり/,
    when: ({ model, sourceTarget }) => model.eventFrame === "evidence" && Boolean(sourceTarget),
    render: ({ fact, sourceTarget }) => `これは>>${sourceTarget}の記録どおり\n${fact}`,
  },
  {
    id: "evidence_tail",
    role: "evidence-coda",
    priority: 4,
    marker: /この結果がすべて>>[^\s\n]+$/,
    when: ({ model, sourceTarget }) => model.eventFrame === "evidence" && Boolean(sourceTarget),
    render: ({ fact, sourceTarget }) => `${fact}\nこの結果がすべて>>${sourceTarget}`,
  },
  {
    id: "evaluation_rank",
    role: "quality-comparison",
    priority: 3,
    marker: /からして他とは格の違いを見せつけている/,
    when: ({ model }) => model.eventFrame === "evaluation" && model.evaluationPolarity === "positive",
    render: ({ fact, model }) => `${fact}\nこの${model.evaluationNoun}からして他とは格の違いを見せつけている`,
  },
  {
    id: "evaluation_impact",
    role: "quality-amplification",
    priority: 3,
    marker: /は破壊力ばつ牛ン$/,
    when: ({ model }) => model.eventFrame === "evaluation" && model.evaluationPolarity === "positive",
    render: ({ fact, model }) => `${fact}\nこの${model.evaluationNoun}は破壊力ばつ牛ﾝ`,
  },
  {
    id: "evaluation_elite",
    role: "quality-certainty",
    priority: 3,
    marker: /は一級品なのは確定的に明らか$/,
    when: ({ model }) => model.eventFrame === "evaluation" && model.evaluationPolarity === "positive",
    render: ({ fact, model }) => `${fact}\nこの${model.evaluationNoun}は一級品なのは確定的に明らか`,
  },
  {
    id: "evaluation_poor",
    role: "negative-evaluation",
    priority: 3,
    marker: /この貧弱さでは話にならない$/,
    when: ({ model }) => model.eventFrame === "evaluation" && model.evaluationPolarity === "negative",
    render: ({ fact }) => `${fact}\nこの貧弱さでは話にならない`,
  },
  {
    id: "evaluation_outclassed",
    role: "negative-comparison",
    priority: 3,
    marker: /一級品とは呼べないのは確定的に明らか$/,
    when: ({ model }) => model.eventFrame === "evaluation" && model.evaluationPolarity === "negative",
    render: ({ fact }) => `${fact}\nこれでは一級品とは呼べないのは確定的に明らか`,
  },
  {
    id: "evaluation_rejection",
    role: "negative-verdict",
    priority: 3,
    marker: /貧弱すぐて勝負にならない$/,
    when: ({ model }) => model.eventFrame === "evaluation" && model.evaluationPolarity === "negative",
    render: ({ fact }) => `${fact}\n内容が貧弱すぐて勝負にならない`,
  },
]);

const evidenceLexemes = Object.freeze({
  account_hearsay: ["話"],
  account_nonfiction: ["ノンフィクション"],
  fact_assertion: ["確定的に明らか"],
  observation_real: ["リアル話"],
  state_threshold: ["でしょう"],
  state_ordinary_damage: ["寿命"],
  state_knight_resistance: ["黄金の鉄の塊"],
  future_preparation: ["見切"],
  future_restraint: ["勝利"],
  future_certainty: ["確定的に明らか"],
  achievement_normality: ["どこもおかしくはない"],
  achievement_prophecy: ["予知夢"],
  achievement_rank: ["一般人"],
  achievement_humility: ["それほどでもない"],
  crisis_not_joke: ["ｓＹレならん"],
  crisis_time_over: ["手遅れになるのではままるな"],
  crisis_deep_sorrow: ["深い悲しみ"],
  crisis_game_over: ["ゲームオーバー"],
  challenge_fangs: ["牙抜いてきた"],
  challenge_prefixed: ["口だけ"],
  challenge_vocative: ["ライバル視"],
  gratitude_fused: ["今回のでそれが良くわかったよ"],
  gratitude_value: ["のう力者"],
  gratitude_extended: ["頼りにされる"],
  agreement_target: ["賛成"],
  agreement_reason: ["確定的に明らか"],
  agreement_value: ["話"],
  evidence_source: ["証明"],
  evidence_embedded: ["記録"],
  evidence_tail: ["結果"],
  evaluation_rank: ["格の違い"],
  evaluation_impact: ["ばつ牛ン"],
  evaluation_elite: ["一級品"],
  evaluation_poor: ["話にならない"],
  evaluation_outclassed: ["一級品"],
  evaluation_rejection: ["貧弱"],
});

function normalizeEvidence(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase();
}

class FaithfulQuoteGrammar {
  constructor(posts, contextNarrative, sourceCorpus = quoteCorpus) {
    this.contextNarrative = contextNarrative;
    // Only actual text records count as evidence. Serializing the entire corpus
    // used to mistake the page's red/bold legend for an attested original quote.
    const records = [
      ...(posts || []).map((post, index) => ({ id: post.id || `original_post_${index}`, supportUnit: post.id || `original_post_${index}`, text: post.content || "", sourceType: "original_post", url: post.postUrl })),
      ...(sourceCorpus.headings || []).map((item) => ({ id: item.id, supportUnit: item.sourcePostIds?.[0] || item.variantGroupId || item.id, text: item.text, sourceType: "quote_heading", url: sourceCorpus.source?.url })),
      ...(sourceCorpus.excerpts || []).map((item) => ({ id: item.id, supportUnit: item.sourcePostIds?.[0] || item.variantGroupId || item.id, text: item.text, sourceType: "quote_excerpt", url: sourceCorpus.source?.url })),
    ].filter((item) => item.text && !/^(?:赤字|太字|黒字)\s*[・.：:]/u.test(item.text))
      .map((item) => ({ ...item, normalized: normalizeEvidence(item.text) }));
    // These renderers used an exact formula whose only previous "evidence" was
    // the excluded legend. Other lexical cues cannot justify that extra formula.
    const exactFormulaFrames = new Set(["fact_assertion", "future_certainty", "gratitude_extended", "agreement_reason", "evaluation_elite", "evaluation_outclassed"]);
    this.evidenceLedger = frameDefinitions.map((frame) => {
      const lexemes = evidenceLexemes[frame.id] || [];
      const required = [...new Set([...lexemes, ...(exactFormulaFrames.has(frame.id) ? ["確定的に明らか"] : [])])];
      const evidence = required.map((lexeme) => {
        const matches = records.filter((item) => item.normalized.includes(normalizeEvidence(lexeme)));
        const units = [...new Map(matches.map((item) => [item.supportUnit, item])).values()];
        return { lexeme, sourceCount: units.length, sources: units.slice(0, 8).map(({ id, sourceType, url }) => ({ id, sourceType, url })) };
      });
      const observed = evidence.filter((entry) => entry.sources.length).map((entry) => entry.lexeme);
      const missing = required.filter((lexeme) => !observed.includes(lexeme));
      return { frame: frame.id, lexemes, required, observed, missing, evidence, linked: missing.length === 0 && required.length > 0,
        status: missing.length ? "disabled_missing_evidence" : "supported_lexical_cues" };
    });
    // Missing support is an abstention, never a fabricated positive or negative.
    const supported = new Set(this.evidenceLedger.filter((entry) => entry.linked).map((entry) => entry.frame));
    this.active = frameDefinitions.filter((frame) => supported.has(frame.id));
  }

  createContext(source, fact, model, random = Math.random) {
    const select = (role) => this.contextNarrative?.anchorGrammar
      .selectTarget(model, role, random, { allowAny: false, allowGoro: false }).target || null;
    return {
      source: String(source ?? ""),
      fact: stripEnding(fact),
      model,
      opponent: select("opponent"),
      sourceTarget: select("source"),
      supporter: select("supporter"),
    };
  }

  candidates(source, fact, model, random = Math.random) {
    const context = this.createContext(source, fact, model, random);
    return shuffle(random, this.active)
      .filter((frame) => !frame.when || frame.when(context))
      .map((frame) => frame.render(context))
      .filter(Boolean);
  }

  applicableSignatures(source, model) {
    const context = this.createContext(source, source, model, () => 0);
    return this.active
      .filter((frame) => !frame.when || frame.when(context))
      .map((frame) => frame.id);
  }

  signatures(text) {
    const value = String(text ?? "").normalize("NFKC");
    // 時代構文は原文寄り構文の前後に独立した行を置く。開始・終端を使う
    // recognizer が外枠のせいで消えないよう、全文と各行の両方を照合する。
    const scopes = [value, ...value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)];
    return this.active
      .filter((frame) => scopes.some((scope) => frame.marker.test(scope)))
      .map((frame) => frame.id);
  }

  priority(text) {
    const signatures = new Set(this.signatures(text));
    return this.active.reduce((maximum, frame) => (
      signatures.has(frame.id) ? Math.max(maximum, frame.priority || 1) : maximum
    ), 0);
  }

  roles(text) {
    const signatures = new Set(this.signatures(text));
    return this.active
      .filter((frame) => signatures.has(frame.id))
      .map((frame) => frame.role);
  }

  evidence(text) {
    const signatures = new Set(this.signatures(text));
    return this.evidenceLedger.filter((entry) => signatures.has(entry.frame));
  }

  status() {
    return {
      activeExpressions: this.active.length,
      disabledExpressions: this.evidenceLedger.filter((entry) => !entry.linked).map((entry) => ({ frame: entry.frame, reason: "missing_evidence", missing: entry.missing })),
      recognizedExpressions: this.active.length,
      expressions: this.active.map((frame) => frame.id),
      functionalRoles: new Set(this.active.map((frame) => frame.role)).size,
      evidenceLinkedExpressions: this.evidenceLedger.filter((entry) => entry.linked).length,
    };
  }
}

module.exports = { FaithfulQuoteGrammar, frameDefinitions };
