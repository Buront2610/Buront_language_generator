import type { Candidate, Novelty, DocumentIR, QuotePlan } from '../contracts';
import { Assets, Retrieval } from './assets';
import { hash } from './source';
import { frameRhetoric } from './series';
import { validateRewrite } from './rewrite-validation';
import { validateRhetoric } from './rhetoric-validation';
import { constructionRegistry, validateConstruction } from './constructions';
import { validateStructural } from './structural';
import { outputFeatures, featureVersion } from './output-features';
export { featureVersion, outputFeatures } from './output-features';
export type HistoryEntry = { text: string; rhetoric: string; family: string; mapping: string; task: string; series: string; mode: string };
export const grams = (text: string, n = 3) => { const chars = [...text.normalize('NFKC').replace(/[\s。、！？!?「」『』]/gu, '')]; return new Set(chars.slice(0, Math.max(1, chars.length - n + 1)).map((_, i) => chars.slice(i, i + n).join(''))); };
export function similarity(a: string, b: string) { const left = grams(a), right = grams(b); return 2 * [...left].filter(item => right.has(item)).length / Math.max(1, left.size + right.size); }
export const structure = (text: string) => text.normalize('NFKC').replace(/[+\-]?\d+(?:\.\d+)?/gu, '<NUM>').replace(/[\p{Script=Han}\p{Script=Katakana}ー]+/gu, '<TERM>').replace(/<TERM>(?:<TERM>)+/gu, '<TERM>');
export function rhetoricalCore(candidate: Pick<Candidate, 'plan'>): string {
  if (candidate.plan.rewrite || candidate.plan.construction || candidate.plan.structural) return candidate.plan.nodes.map(node => node.text).join('');
  const surface = candidate.plan.surface, main = candidate.plan.nodes.find(node => node.id === 'main-quote');
  try { if (surface && main?.text === frameRhetoric(surface.coreText, surface.constructionId)) return surface.coreText; } catch { /* Unknown frames cannot supply a trusted novelty core. */ }
  return candidate.plan.nodes.filter(node => node.type === 'RhetoricalClause').map(node => node.text).join('').replace(/^たとえるなら[、,]/u, '');
}
export function evaluateNovelty(candidate: Candidate, assets: Assets, retrieval: Retrieval, history: HistoryEntry[]): Novelty {
  const rhetoric = rhetoricalCore(candidate);
  const near = retrieval.search(rhetoric, 'all', 'novelty', 30);
  const records = [...near.map(item => ({ id: item.id, text: item.text })), ...history.map((item, i) => ({ id: `history-${i}`, text: item.rhetoric }))];
  const comparisons = records.map(item => ({ ...item, textScore: similarity(rhetoric, item.text), structureScore: similarity(structure(rhetoric), structure(item.text)) }));
  const maxText = Math.max(0, ...comparisons.map(item => item.textScore));
  const maxStructure = Math.max(0, ...comparisons.map(item => item.structureScore));
  const concept = history.length ? history.some(item => item.family === candidate.plan.family && item.mapping === hash(candidate.plan.mapping)) ? 1 : 0 : null;
  const exact = records.some(item => item.text.normalize('NFKC').replace(/\s/gu, '') === rhetoric.normalize('NFKC').replace(/\s/gu, ''));
  return { classification: candidate.plan.rewrite || candidate.plan.construction || candidate.plan.structural ? 'adaptation' : !rhetoric ? 'undetermined' : exact || maxText > 0.95 ? 'known_quote' : maxText > 0.72 || maxStructure > 0.86 || concept === 1 ? 'adaptation' : 'candidate_novel',
    text: 1 - maxText, structure: 1 - maxStructure, concept: concept === null ? null : 1 - concept,
    nearestIds: comparisons.sort((a, b) => Math.max(b.textScore, b.structureScore) - Math.max(a.textScore, a.structureScore)).slice(0, 3).map(item => item.id),
    datasetId: assets.datasetId, historySnapshot: hash(history), window: `${candidate.plan.structural ? '原文節の射影と手書き因果文法。出典は合成した語句・接頭辞の用例に限り、句順変更自体の学習や出典を示さない。入力語の違いを新作性の根拠にはしない。' : candidate.plan.rewrite || candidate.plan.construction ? '出典付き構文の応用。入力語の違いを新作性の根拠にはしない。' : ''}原ログ・語録の近傍30件と保存履歴${history.length}件。概念比較は保存履歴内のみ（原ログの概念注釈は未整備）。世界全体の新規性ではない。` };
}
export const features = (candidate: { text: string }): Record<string, number> => outputFeatures(candidate.text);
export type Evaluator = { schemaVersion: 1; featureVersion: string; dimension: 'S' | 'Q'; coefficients: Record<string, number>; intercept: number; trainingManifest: Record<string, unknown>; personal: boolean };
export function score(candidate: Candidate, evaluator?: Evaluator) {
  if (!evaluator) return null;
  if (evaluator.featureVersion !== featureVersion) throw new Error('EVALUATOR_FEATURE_INCOMPATIBLE');
  const values = features(candidate);
  return Object.entries(evaluator.coefficients).reduce((sum, [name, coefficient]) => sum + (values[name] || 0) * coefficient, evaluator.intercept);
}
export function ruleQuality(ir: DocumentIR, plan: QuotePlan): { C: number | null; R: number } {
  if (plan.structural) {
    const valid = validateStructural(ir, plan), length = [...plan.nodes.map(node => node.text).join('')].length;
    return { C: valid ? 1 : 0, R: valid && length <= Math.max(100, ir.source.scalarToUtf16.length * 2) ? 1 : 0 };
  }
  if (plan.construction) {
    const valid = !plan.rewrite && validateConstruction(ir, plan), length = [...plan.nodes.map(node => node.text).join('')].length;
    return { C: valid ? 1 : 0, R: valid && length <= Math.max(100, ir.source.scalarToUtf16.length * 2) ? 1 : 0 };
  }
  if (plan.rewrite) {
    const valid = validateRewrite(ir, plan), length = [...plan.nodes.map(node => node.text).join('')].length;
    return { C: valid ? 1 : 0, R: valid && length <= Math.max(100, ir.source.scalarToUtf16.length * 2) ? 1 : 0 };
  }
  if (plan.mainOperator === 'QUOTE') return { C: null, R: 1 }; // Related quotation is not proven contextual fit.
  const meaning = validateRhetoric(ir, plan), text = plan.surface?.coreText ?? '';
  const clauses = text.split(/[、。]/u).filter(Boolean);
  // Recoverability and connection are checked by the inverse relation grammar;
  // fluency limits apply to new rhetoric only, not repetitions in source facts.
  const readable = meaning.valid && clauses.length >= 2 && clauses.length <= 9 && clauses.every(clause => [...clause].length <= 100) && !/(.{3,12})\1\1/u.test(text);
  return { C: !meaning.valid ? 0 : meaning.dictionary === 'unknown' ? null : 1, R: readable ? 1 : 0 };
}
// Diversity compares the actual changed language first. Unchanged background
// can be arbitrarily long and must not erase distinct local constructions.
export const diversityText = (text: string) => text.normalize('NFKC')
  .replace(/(?:わたし|ぼく|おれ|私|僕|俺)(?=(?:は|が|を|に|の|と|も|で|から|たち|達|ら|[\p{P}\p{Z}\s]|$))/gu, '<SELF>')
  .replace(/(?:あなた|おまえ|お前|きみ|君)(?=(?:は|が|を|に|の|と|も|で|から|たち|達|ら|[\p{P}\p{Z}\s]|$))/gu, '<YOU>')
  .replace(/[\p{P}\p{Z}\s]/gu, '');
const constructionFamilies = new Map<string, string>(constructionRegistry.map(item => [item.id, item.family]));
const cosmeticRule = (id: string) => /^(?:punctuation-|narrator-)/u.test(id);
export function diversityProfile(candidate: Candidate) {
  const plan = candidate.plan;
  if (plan.structural) {
    const lexical = plan.structural.lexicalEdits.filter(edit => !cosmeticRule(edit.ruleId) && diversityText(edit.from) !== diversityText(edit.to));
    return { family: plan.family, operators: ['STRUCTURAL', ...(lexical.some(edit => !edit.ruleId.startsWith('ending-')) ? ['BODY_REWRITE'] : [])].join('+'),
      changed: [...plan.structural.bindings.map(binding => `${binding.kind}:${binding.realizationId}:source[${binding.claimNodeId},${binding.reasonNodeId}]:emit[${(binding.realizationId === 'reason-claim' ? [binding.reasonNodeId, binding.claimNodeId] : [binding.claimNodeId, binding.reasonNodeId]).join(',')}]`), ...lexical.map(edit => `${edit.ruleId}:${diversityText(edit.to)}`)].sort().join('|'),
      whole: diversityText(candidate.text) };
  }

  const edits = plan.construction?.edits ?? plan.rewrite?.edits;
  const lexical = plan.construction?.lexicalEdits ?? [];
  const substantive = [...(edits ?? []), ...lexical].filter(edit => diversityText(edit.from) !== diversityText(edit.to));
  const rewriteFamily = plan.rewrite?.edits.filter(edit => !cosmeticRule(edit.ruleId) && !edit.ruleId.startsWith('ending-')).map(edit => edit.ruleId);
  const family = plan.construction
    ? [...new Set(plan.construction.edits.map(edit => constructionFamilies.get(edit.constructionId) ?? edit.constructionId))].sort().join('+')
    : plan.rewrite ? rewriteFamily?.length ? [...new Set(rewriteFamily)].sort().join('+') : plan.rewrite.edits.some(edit => edit.ruleId.startsWith('ending-')) ? 'declarative-ending' : 'surface-only'
    : plan.family;
  const changed = substantive.length ? substantive.map(edit => diversityText(edit.to)).join('|')
    : edits ? lexical.filter(edit => !cosmeticRule(edit.ruleId)).map(edit => diversityText(edit.to)).join('|')
    : diversityText(rhetoricalCore(candidate) || candidate.text);
  const operators = [plan.mainOperator, ...plan.auxiliaryOperators];
  if (plan.construction && lexical.some(edit => !cosmeticRule(edit.ruleId) && !edit.ruleId.startsWith('ending-') && diversityText(edit.from) !== diversityText(edit.to))) operators.push('BODY_REWRITE');
  return { family, operators: [...new Set(operators)].sort().join('+'), changed, whole: diversityText(candidate.text) };
}
export function select(candidates: Candidate[], noveltyMode: string, seed = ''): Candidate[] {
  const eligible = candidates.filter(candidate => candidate.verificationStatus === 'passed' && (candidate.plan.mainOperator === 'QUOTE' || (candidate.scores.C ?? 0) >= 1) && (candidate.scores.R ?? 0) >= 0.5 && (noveltyMode !== 'invent' || candidate.novelty.classification === 'candidate_novel'));
  const bestReadability = Math.max(0, ...eligible.map(candidate => candidate.scores.R ?? 0));
  const usable = eligible.filter(candidate => (candidate.scores.R ?? 0) >= bestReadability - 0.15);
  const dominates = (a: Candidate, b: Candidate) => {
    const dimensions = (['S', 'Q'] as const).filter(d => a.scores[d] !== null && b.scores[d] !== null);
    return dimensions.length > 0 && dimensions.every(d => a.scores[d]! >= b.scores[d]!) && dimensions.some(d => a.scores[d]! > b.scores[d]!);
  };
  // Separate learned dimensions; no fabricated style score when S/Q are null.
  const front = new Map<Candidate, number>(); let remaining = [...usable], level = 0;
  while (remaining.length) {
    const current = remaining.filter(candidate => !remaining.some(other => dominates(other, candidate)));
    for (const candidate of current) front.set(candidate, level);
    remaining = remaining.filter(candidate => !current.includes(candidate)); level++;
  }
  // This is an explicit presentation preference, not an assertion of quality.
  // In experimental structural ties, show the movement+lexical composition
  // when available; this is a Boolean operation-coverage choice, not an edit
  // count reward or a learned style/fluency score.
  const transformation = (candidate: Candidate) => candidate.plan.structural?.bindings.some(binding => binding.realizationId === 'reason-claim') ? candidate.plan.structural.lexicalEdits.some(edit => !cosmeticRule(edit.ruleId) && !edit.ruleId.startsWith('ending-') && diversityText(edit.from) !== diversityText(edit.to)) ? 4 : 3 : candidate.plan.construction || candidate.plan.structural ? 2 : candidate.plan.rewrite?.edits.some(edit => !edit.ruleId.startsWith('ending-') && !cosmeticRule(edit.ruleId)) ? 1 : 0;
  const profiles = new Map(usable.map(candidate => [candidate, diversityProfile(candidate)]));
  const selected: Candidate[] = [];
  const distance = (value: string, previous: string[]) => previous.length ? 1 - Math.max(...previous.map(other => similarity(value, other))) : 1;
  while (selected.length < 3) {
    const previous = selected.map(candidate => profiles.get(candidate)!);
    const choices = usable.filter(candidate => {
      if (selected.includes(candidate)) return false;
      const profile = profiles.get(candidate)!;
      return !previous.some(other => other.whole === profile.whole || (other.family === profile.family && other.operators === profile.operators && other.changed === profile.changed));
    });
    if (!choices.length) break;
    const diversity = (candidate: Candidate) => {
      const profile = profiles.get(candidate)!;
      return [Number(!previous.some(other => other.family === profile.family)), Number(!previous.some(other => other.operators === profile.operators)), distance(profile.changed, previous.map(other => other.changed)), distance(profile.whole, previous.map(other => other.whole))];
    };
    choices.sort((a, b) => {
      const quality = front.get(a)! - front.get(b)! || (b.scores.R ?? 0) - (a.scores.R ?? 0);
      if (quality) return quality;
      const left = diversity(a), right = diversity(b);
      for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return right[i] - left[i];
      const novelty = (b.novelty.structure ?? 0) - (a.novelty.structure ?? 0);
      // A seed can only resolve equivalent eligible alternatives after every
      // validation, preference and diversity criterion. It cannot promote risk.
      return transformation(b) - transformation(a) || novelty || hash([seed, a.id]).localeCompare(hash([seed, b.id])) || a.id.localeCompare(b.id);
    });
    selected.push(choices[0]);
  }
  return selected;
}
