import type { ConstructionBinding, ConstructionEdit, DocumentIR, Fact, GenerationRequest, PlanNode, QuotePlan, RewriteEdit, Span, Token } from '../contracts';
import type { Assets } from './assets';
import { hash, overlaps, slice } from './source';
import { planIntent, planNarrative } from './planning';
import { renderEdits, validateRewrite } from './rewrite-validation';
import { insideEnclosure, permitsAssertiveScope, propositionScopes, type PropositionScope } from './grammar-scope';

// Registered semantic transformations, not general paraphrase or invented quotes.
// Slot binding, grammatical scope and every preserved feature are recomputed from
// the source. An attested phrase is provenance, not proof of arbitrary meaning.
export const constructionRegistry = [
  { id: 'anger-peak', version: 1, series: ['night'], family: 'anger-maximum', level: 2, evidenceId: 'post_01635_41e56849e981c8e0_5432', needle: '怒りが有頂天になった',
    slots: ['emotion', 'marker', 'degree', 'predicate', 'experiencer'], semanticDelta: 'maximum anger -> attested inverted peak expression', preserves: ['experiencer', 'tense', 'polarity', 'attribution', 'realization'] },
  { id: 'deep-sadness', version: 1, series: ['katuru'], family: 'sadness-high', level: 2, evidenceId: 'post_01958_a99dd6788275096d_7231', needle: '深い悲しみに包まれた',
    slots: ['degree', 'emotion', 'predicate', 'experiencer'], semanticDelta: 'explicit high sadness -> enveloping sadness state', preserves: ['experiencer', 'tense', 'polarity', 'attribution', 'realization'] },
  { id: 'time-expired', version: 1, series: ['gg'], family: 'already-expired', level: 2, evidenceId: 'post_01944_f7cb32dab8e25e5a_7155', needle: '時既に時間切れ',
    slots: ['time', 'state', 'predicate'], semanticDelta: 'explicit already-expired state -> attested temporal doubling', preserves: ['tense', 'polarity', 'attribution', 'realization', 'arguments'] },
] as const;
const registry = new Map<string, typeof constructionRegistry[number]>(constructionRegistry.map(item => [item.id, item]));
export const constructionFamily = (edits: ConstructionEdit[]) => [...new Set(edits.map(edit => registry.get(edit.constructionId)?.family ?? 'unknown'))].join('+');
const uniqueEvidence = (edits: { evidenceIds: string[] }[]) => [...new Set(edits.flatMap(edit => edit.evidenceIds))];
const binding = (slot: ConstructionBinding['slot'], span: Span, ir: DocumentIR): ConstructionBinding => ({ slot, span: { ...span }, text: slice(ir.source.raw, span), tokenIds: ir.tokens.filter(token => span.start <= token.span.start && token.span.end <= span.end).map(token => token.id) });
const personReference = (token: Token) => token.pos === 'PRON' && ['私', 'わたし', 'わたくし', '僕', '俺', '彼', '彼女', '自分', 'あなた', '君'].includes(token.lemma) || token.pos === 'PROPN' && /固有名詞-人名/u.test(token.tag);
const features = (fact: Fact): ConstructionEdit['features'] => ({ polarity: fact.polarity, tense: fact.tense, realization: fact.realization, completion: fact.completion, attribution: { ...fact.attribution }, voice: fact.voice });

function assertivePredicate(ir: DocumentIR, fact: Fact, node: PlanNode, scopes: PropositionScope[]): Token | undefined {
  const predicate = ir.tokens.find(token => hash(token.span) === hash(fact.predicateSpan));
  if (!predicate || !node.sourceSpan || ir.topicOnly || predicate.dep !== 'ROOT' || fact.polarity !== 'positive' || fact.realization !== 'actual' || fact.attribution.kind !== 'narrator' || fact.voice !== 'active' || fact.tense === 'unknown') return;
  const scope = scopes.find(scope => scope.predicate.id === predicate.id);
  if (!scope || !permitsAssertiveScope(scope) || scope.negative || scope.prospective) return;
  if (insideEnclosure(ir.source.raw, predicate.span.start) || ir.source.opaqueSpans.some(span => overlaps(span, fact.sourceSpan))) return;
  return predicate;
}

function bindForNode(ir: DocumentIR, node: PlanNode, intensity: number, scopes: PropositionScope[]): ConstructionEdit[] {
  if (!node.sourceSpan || intensity < 2) return [];
  const result: ConstructionEdit[] = [];
  for (const fact of ir.facts.filter(fact => node.factIds.includes(fact.id))) {
    const predicate = assertivePredicate(ir, fact, node, scopes); if (!predicate) continue;
    const children = ir.tokens.filter(token => token.head === predicate.id && token.id !== predicate.id);
    const auxiliary = children.filter(token => ['aux', 'cop'].includes(token.dep));
    const end = Math.max(predicate.span.end, ...auxiliary.map(token => token.span.end));
    const after = slice(ir.source.raw, { start: end, end: node.sourceSpan.end });
    // This first registry supports complete assertions only; negatives, embedded
    // clauses, speculation and requests are left unchanged instead of guessed.
    if (!/^[。！!]?\s*$/u.test(after)) continue;
    let id: string | undefined, span: Span | undefined, to = '', bindings: ConstructionBinding[] = [];
    if (predicate.lemma === '達する') {
      const emotion = children.find(token => token.dep === 'nsubj' && token.lemma === '怒り');
      const peak = children.find(token => token.dep === 'obl' && token.lemma === '頂点');
      const marker = emotion && ir.tokens.find(token => token.head === emotion.id && token.dep === 'case' && ['が', 'は'].includes(token.text));
      const goal = peak && ir.tokens.find(token => token.head === peak.id && token.dep === 'case' && token.text === 'に');
      if (!emotion || !peak || !marker || !goal) continue;
      span = { start: emotion.span.start, end };
      if (!/^怒り[がは]頂点に達(?:した|しました|する|します)$/u.test(slice(ir.source.raw, span))) continue;
      id = 'anger-peak'; to = `怒り${marker.text}有頂天に${fact.tense === 'past' ? 'なった' : 'なる'}`;
      bindings = [binding('emotion', emotion.span, ir), binding('marker', marker.span, ir), binding('degree', peak.span, ir), binding('predicate', predicate.span, ir)];
      const owner = ir.tokens.find(token => token.head === emotion.id && token.dep === 'nmod' && personReference(token) && ir.tokens.filter(child => child.head === token.id && child.dep === 'case').map(child => child.text).join('') === 'の');
      if (owner) bindings.push(binding('experiencer', owner.span, ir));
    } else if (predicate.lemma === '悲しい') {
      // Japanese nsubj can denote the stimulus (この知らせが悲しい), not
      // the experiencer. Only an unambiguous personal subject may be rephrased
      // as being enveloped in sadness; a competing topic must also abstain.
      const subjects = children.filter(token => token.dep === 'nsubj');
      if (children.some(token => ['dislocated', 'obl', 'obj', 'iobj'].includes(token.dep)) || subjects.length > 1 || subjects.some(token => !personReference(token))) continue;
      const degree = children.find(token => token.dep === 'advmod' && ['とても', '大変'].includes(token.lemma));
      if (!degree) continue;
      span = { start: degree.span.start, end };
      if (!/^(?:とても|大変)悲し(?:い(?:です)?|かった(?:です)?)$/u.test(slice(ir.source.raw, span))) continue;
      id = 'deep-sadness'; to = `深い悲しみに包まれ${fact.tense === 'past' ? 'た' : 'ている'}`;
      bindings = [binding('degree', degree.span, ir), binding('emotion', predicate.span, ir), binding('predicate', predicate.span, ir)];
      const experiencer = children.find(token => token.dep === 'nsubj');
      if (experiencer) bindings.push(binding('experiencer', experiencer.span, ir));
    } else if (predicate.lemma === '時間切れ') {
      const time = children.find(token => token.dep === 'advmod' && ['すでに', '既に', 'もう'].includes(token.text));
      if (!time) continue;
      span = { start: time.span.start, end };
      const match = /^(?:すでに|既に|もう)時間切れ(です|だ|でした|だった)?$/u.exec(slice(ir.source.raw, span));
      if (!match) continue;
      id = 'time-expired'; to = `時既に時間切れ${match[1] === 'です' ? 'だ' : match[1] === 'でした' ? 'だった' : match[1] ?? ''}`;
      bindings = [binding('time', time.span, ir), binding('state', predicate.span, ir), binding('predicate', predicate.span, ir)];
    }
    if (!id || !span || span.start < node.sourceSpan.start || span.end > node.sourceSpan.end || insideEnclosure(ir.source.raw, span.start) || [...ir.source.opaqueSpans, ...ir.source.protectedValues.map(value => value.span)].some(value => overlaps(value, span))) continue;
    const item = registry.get(id)!;
    result.push({ nodeId: node.id, constructionId: id, constructionVersion: item.version, realizationId: `${id}:${fact.tense}:${id === 'anger-peak' ? bindings.find(bound => bound.slot === 'marker')!.text : id === 'time-expired' ? /(?:だった|でした)$/u.test(to) ? 'past-copula' : /だ$/u.test(to) ? 'copula' : 'bare' : 'state'}`, factId: fact.id, sourceSpan: span, from: slice(ir.source.raw, span), to, bindings, features: features(fact), evidenceIds: [item.evidenceId] });
  }
  return result;
}

function renderNode(ir: DocumentIR, node: PlanNode, edits: (ConstructionEdit | RewriteEdit)[]): string {
  return renderEdits(ir.source.raw, node, edits.map(edit => ({ ...edit, ruleId: 'ruleId' in edit ? edit.ruleId : edit.constructionId })));
}
const allEdits = (plan: QuotePlan) => [...plan.construction!.lexicalEdits, ...plan.construction!.edits].sort((a, b) => a.sourceSpan.start - b.sourceSpan.start);

export function makeConstructionPlans(ir: DocumentIR, request: GenerationRequest, assets: Assets, rewritePlans: QuotePlan[]): QuotePlan[] {
  if (request.task !== 'rewrite' || request.intensity < 2) return [];
  const narrative = planNarrative(ir, 'source_order'), intentPlan = planIntent(ir);
  const empty: QuotePlan = { id: '', intent: intentPlan.act, intentPlan, narrative, mainOperator: 'CONSTRUCTION', auxiliaryOperators: [], family: '', mapping: { source: 'adopted-source', target: 'registered-semantic-constructions', relation: 'bounded-construction' }, backTranslation: '', evidenceIds: [], forbiddenEffects: intentPlan.forbiddenEffects,
    nodes: narrative.units.map((unit, i) => ({ id: `fact-node-${i}`, type: 'FactClause', text: slice(ir.source.raw, unit.sourceSpan), sourceSpan: unit.sourceSpan, factIds: unit.factIds, evidenceIds: [], mention: 'primary' })), experimental: true };
  const evidence = new Map(assets.evidence.map(item => [item.id, item]));
  const scopes = propositionScopes(ir.source, ir);
  const edits = empty.nodes.flatMap(node => bindForNode(ir, node, request.intensity, scopes)).filter(edit => {
    const item = registry.get(edit.constructionId)!, source = evidence.get(item.evidenceId);
    return source?.sourceType === 'original_post' && source.text.includes(item.needle) && (request.series === 'all' || (item.series as readonly string[]).includes(request.series) && source.series.includes(request.series));
  });
  if (!edits.length) return [];
  const plans: QuotePlan[] = [], seen = new Set<string>();
  for (const base of rewritePlans.length ? rewritePlans : [empty]) {
    const plan = structuredClone(empty), lexicalEdits = structuredClone(base.rewrite?.edits ?? []).filter(edit => !edits.some(construction => overlaps(edit.sourceSpan, construction.sourceSpan)));
    plan.construction = { version: 1, seriesId: request.series, intensity: request.intensity, edits: structuredClone(edits), lexicalEdits };
    const combined = allEdits(plan);
    for (const node of plan.nodes) {
      const changes = combined.filter(edit => edit.nodeId === node.id);
      node.text = renderNode(ir, node, changes); node.evidenceIds = uniqueEvidence(changes);
    }
    const text = plan.nodes.map(node => node.text).join(''); if (seen.has(text)) continue;
    seen.add(text); plan.family = constructionFamily(edits);
    plan.evidenceIds = uniqueEvidence(combined);
    plan.backTranslation = '原文の感情・明示された強度・期限状態をスロットへ束縛し、登録済み構文に実現。主体・否定・時制・引用・予定を補わず、不確かな節は変換しない。';
    plan.id = hash(plan).slice(0, 24); plans.push(plan);
  }
  return plans;
}

// Independent proof: recompute all permitted bindings from the original IR and
// validate lexical edits separately, then reconstruct every output scalar.
export function validateConstruction(ir: DocumentIR, plan: QuotePlan, references?: Map<string, string>): boolean {
  const program = plan.construction;
  if (!program || program.version !== 1 || ![2, 3].includes(program.intensity) || !program.edits.length || plan.mainOperator !== 'CONSTRUCTION' || plan.rewrite || plan.surface || plan.rhetoric || plan.rhetoricEdits?.length || plan.nodes.some(node => node.type !== 'FactClause' || !node.sourceSpan)) return false;
  if (program.edits.some(edit => !plan.nodes.some(node => node.id === edit.nodeId))) return false;
  const narrative = planNarrative(ir, 'source_order'), intent = planIntent(ir);
  if (!plan.narrative || !plan.intentPlan) return false;
  if (hash(plan.narrative) !== hash(narrative) || hash(plan.intentPlan) !== hash(intent) || plan.intent !== intent.act || plan.nodes.length !== narrative.units.length || plan.family !== constructionFamily(program.edits)) return false;
  if (plan.nodes.some((node, index) => {
    const unit = narrative.units[index];
    return node.id !== `fact-node-${index}` || node.mention !== 'primary' || hash(node.sourceSpan) !== hash(unit.sourceSpan) || hash(node.factIds) !== hash(unit.factIds);
  })) return false;
  const combined = allEdits(plan), scopes = propositionScopes(ir.source, ir);
  if (combined.some((edit, i) => i > 0 && overlaps(edit.sourceSpan, combined[i - 1].sourceSpan))) return false;
  for (const node of plan.nodes) {
    const changes = combined.filter(edit => edit.nodeId === node.id), expected = bindForNode(ir, node, program.intensity, scopes);
    for (const edit of program.edits.filter(edit => edit.nodeId === node.id)) {
      const item = registry.get(edit.constructionId);
      if (!item || program.seriesId !== 'all' && !(item.series as readonly string[]).includes(program.seriesId) || !expected.some(value => hash(value) === hash(edit)) || references && !references.get(item.evidenceId)?.includes(item.needle)) return false;
    }
    if (node.text !== renderNode(ir, node, changes) || hash(node.evidenceIds) !== hash(uniqueEvidence(changes))) return false;
  }
  if (hash(plan.evidenceIds) !== hash(uniqueEvidence(combined))) return false;
  if (program.lexicalEdits.length) {
    const lexicalPlan: QuotePlan = { ...plan, construction: undefined, mainOperator: 'REWRITE', rewrite: { version: 1, seriesId: program.seriesId, intensity: program.intensity, edits: program.lexicalEdits }, evidenceIds: uniqueEvidence(program.lexicalEdits), nodes: plan.nodes.map(node => {
      const edits = program.lexicalEdits.filter(edit => edit.nodeId === node.id);
      return { ...node, text: renderEdits(ir.source.raw, node, edits), evidenceIds: uniqueEvidence(edits) };
    }) };
    if (!validateRewrite(ir, lexicalPlan, references)) return false;
  }
  return true;
}
