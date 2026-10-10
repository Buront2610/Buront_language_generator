import type { ConstructionDiagnostic, DocumentIR, GenerationRequest, OutputSpan, PlanNode, QuotePlan, RecognizedDiscourseRelation, RewriteEdit, Span, StructuralBinding, StructuralClause, StructuralProgram, StructuralSlot, Token } from '../contracts';
import type { Assets } from './assets';
import { hash, overlaps, slice } from './source';
import { planIntent, planNarrative } from './planning';
import { propositionScopes } from './grammar-scope';
import { createDiscourseRecognizer, discourseConstructionRegistry } from './discourse-constructions';
import { rewriteRuleById } from './rewrite-rules';
import { compareSourceEdits, renderEdits, validateRewrite } from './rewrite-validation';

export const structuralGrammarVersion = 'explicit-reason-slots-v1' as const;
const reasonFrame = discourseConstructionRegistry.find(item => item.id === 'explicit-reason')!;
const contains = (outer: Span, inner: Span) => outer.start <= inner.start && inner.end <= outer.end;
const unique = <T>(values: T[]) => [...new Set(values)];
const evidenceOf = (edits: { evidenceIds: string[] }[]) => unique(edits.flatMap(edit => edit.evidenceIds));
const sourceNodes = (ir: DocumentIR): PlanNode[] => planNarrative(ir, 'source_order').units.map((unit, index) => ({ id: `fact-node-${index}`, type: 'FactClause', text: slice(ir.source.raw, unit.sourceSpan), sourceSpan: unit.sourceSpan, factIds: unit.factIds, evidenceIds: [], mention: 'primary' }));

/** Tokens, their grammatical roles and entire predicate/auxiliary chains are
 * variables. No noun/verb whitelist, completed source strings or teacher pairs.
 * Gaps are first-class slots: even parser-ignored whitespace is projected once. */
export function bindStructuralClauses(ir: DocumentIR, nodes = sourceNodes(ir)): StructuralClause[] {
  return nodes.map(node => {
    const span = node.sourceSpan!, predicates = ir.facts.filter(fact => node.factIds.includes(fact.id));
    const tokens = ir.tokens.filter(token => contains(span, token.span));
    const slots: StructuralSlot[] = [];
    const add = (sourceSpan: Span, role: StructuralSlot['role'], tokenIds: number[]) => {
      if (sourceSpan.start === sourceSpan.end) return;
      slots.push({ id: `${node.id}:slot-${slots.length}`, role, sourceSpan: { ...sourceSpan }, tokenIds,
        factIds: predicates.filter(fact => overlaps(fact.sourceSpan, sourceSpan)).map(fact => fact.id),
        protectedValueIds: ir.source.protectedValues.filter(value => overlaps(value.span, sourceSpan)).map(value => value.id) });
    };
    let cursor = span.start;
    for (const token of tokens) {
      add({ start: cursor, end: token.span.start }, 'gap', []);
      const argument = predicates.flatMap(fact => fact.arguments).find(argument => contains(argument.span, token.span));
      const role: StructuralSlot['role'] = /^\s+$/u.test(token.text) ? 'gap'
        : predicates.some(fact => fact.predicateSpan.start === token.span.start && fact.predicateSpan.end === token.span.end) ? 'predicate'
        : argument ? argument.role : token.pos === 'PUNCT' ? 'punctuation' : token.dep === 'case' ? 'case'
        : token.pos === 'AUX' || ['aux', 'cop', 'mark', 'fixed'].includes(token.dep) ? 'operator' : 'adjunct';
      add(token.span, role, [token.id]); cursor = token.span.end;
    }
    add({ start: cursor, end: span.end }, 'gap', []);
    return { nodeId: node.id, sourceSpan: { ...span }, slots, predicates: structuredClone(predicates) };
  });
}

type Recognized = { id: string; claimNodeId: string; reasonNodeId: string; relation: RecognizedDiscourseRelation };
function recognize(ir: DocumentIR, nodes: PlanNode[]): Recognized[] {
  const recognizeNode = createDiscourseRecognizer(ir, propositionScopes(ir.source, ir), undefined, { morphologicalReasonMarker: true });
  return nodes.flatMap(node => recognizeNode(node).filter(relation => relation.kind === 'explicit-reason').flatMap(relation => {
    const claim = relation.clauses.find(clause => clause.role === 'claim')!;
    const claimNode = nodes.find(value => value.sourceSpan && contains(value.sourceSpan, claim.span));
    if (!claimNode || nodes.indexOf(claimNode) + 1 !== nodes.indexOf(node)) return [];
    return [{ id: `reason:${claimNode.id}:${node.id}`, claimNodeId: claimNode.id, reasonNodeId: node.id, relation }];
  }));
}

// Reordering is narrower than recognition. These expressions require discourse
// resolution not provided by this grammar; prefix realization remains possible.
const referenceLemmas = new Set(['それ', 'これ', 'あれ', 'どれ', 'その', 'この', 'あの', 'ここ', 'そこ', 'あそこ', 'こちら', 'そちら', 'あちら', '彼', '彼女', '同じ', '同様', '前者', '後者', '先ほど', 'さっき', '翌日', '翌朝', '当人', '本人', '同氏', '同人', '同社', '同店', '同国', '同所', '当該', '前述', '上述', '前出', '上記', '下記', '後述', 'それぞれ', '各々']);
const stablePersonalPronouns = new Set(['私', 'わたし', 'わたくし', '僕', '俺', '我々', 'われわれ', 'あなた', '君', 'お前']);
const relativeTimeLemma = /^(?:翌々?(?:日|朝|晩|週|月|年)|前(?:日|夜|週|月|年)|同(?:日|夜|時|週|月|年)|当日|後日|後刻|後ほど)$/u;
const connectiveHeads = new Set(['続いて', '一方', 'まず', '次', 'さらに', 'また', 'しかし', 'だから', 'そこで', 'ちなみに', '結局', 'すなわち']);
function discourseDependent(localTokens: Token[]): boolean {
  const tokens = localTokens.filter(token => !/^\s+$/u.test(token.text));
  // Whole parsed lexemes, never substrings: 彼岸花/またたく/事実は are
  // lexical payloads, not 彼/また/実は discourse references.
  if (tokens.some(token => referenceLemmas.has(token.lemma) || relativeTimeLemma.test(token.lemma) || token.pos === 'PRON' && !stablePersonalPronouns.has(token.lemma) || token.pos === 'CCONJ' && ['しかし', 'だから', 'そこで'].includes(token.lemma))) return true;
  if (tokens[0] && connectiveHeads.has(tokens[0].lemma)) return true;
  return [2, 3].some(length => ['実は', '要するに', 'その後'].includes(tokens.slice(0, length).map(token => token.text).join('')));
}
// Each proof builds its own indexes from the immutable source. No planner-owned
// cache crosses the independent verifier boundary. The suffix scan is linear,
// not pair × suffix × all-token scans near the 5,000-scalar input limit.
function createReorderBlocker(ir: DocumentIR, all: Recognized[], nodes: PlanNode[]) {
  const facts = new Map(ir.facts.map(fact => [`${fact.predicateSpan.start}:${fact.predicateSpan.end}`, fact]));
  const entries = nodes.map(node => {
    const tokens = ir.tokens.filter(token => contains(node.sourceSpan!, token.span));
    const root = tokens.find(token => token.dep === 'ROOT');
    return { node, text: slice(ir.source.raw, node.sourceSpan!), dependent: discourseDependent(tokens), fact: root ? facts.get(`${root.span.start}:${root.span.end}`) : undefined };
  });
  const byId = new Map(entries.map(entry => [entry.node.id, entry]));
  const uses = new Map<string, number>();
  for (const relation of all) for (const id of [relation.claimNodeId, relation.reasonNodeId]) uses.set(id, (uses.get(id) ?? 0) + 1);
  const suffixBlocker = new Map<string, string | undefined>();
  let suffix: string | undefined;
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]; suffixBlocker.set(entry.node.id, suffix);
    if (!entry.text.trim()) continue;
    if (entry.dependent) suffix = 'following_discourse_reference';
    else if (!entry.fact || !entry.fact.arguments.some(argument => argument.role === 'agent')) suffix = 'following_omitted_actor';
  }
  return (item: Recognized): string | undefined => {
    const claim = byId.get(item.claimNodeId)!, reason = byId.get(item.reasonNodeId)!;
    const marker = item.relation.evidenceTokens.find(token => token.role === 'marker')!, copula = item.relation.evidenceTokens.find(token => token.role === 'copula')!;
    if ((uses.get(item.claimNodeId) ?? 0) > 1 || (uses.get(item.reasonNodeId) ?? 0) > 1) return 'overlapping_reason_chain';
    if (claim.dependent || reason.dependent) return 'unresolved_discourse_reference';
    // A later zero-subject clause could inherit a different last-mentioned
    // actor. Weather/object subjects are not treated as safe referent resets.
    if (suffixBlocker.get(item.reasonNodeId)) return suffixBlocker.get(item.reasonNodeId);
    if (!/^。\s*$/u.test(slice(ir.source.raw, { start: copula.span.end, end: reason.node.sourceSpan!.end })) || !/。\s*$/u.test(claim.text)) return 'unsupported_sentence_boundary';
    if (marker.span.end !== copula.span.start) return 'nonadjacent_explanatory_copula';
    if (!claim.fact || !reason.fact) return 'root_predicate_missing';
    if (!claim.fact.arguments.some(argument => argument.role === 'agent') && reason.fact.arguments.some(argument => argument.role === 'agent')) return 'omitted_claim_actor_with_fronted_actor';
    if (item.relation.conditions.some(condition => condition.speculative || condition.conditional || condition.prospective || condition.reportedContent || condition.ambiguous || condition.nonDeclarative || condition.attribution.kind !== 'narrator')) return 'scope_movement_unsupported';
    if (ir.source.protectedValues.some(value => overlaps(value.span, { start: copula.span.start, end: reason.node.sourceSpan!.end }))) return 'protected_relation_boundary';
    return undefined;
  };
}

/** Canonical relation operators are grammar, not purported learned Buront text.
 * Only the independently attested 何故なら prefix carries corpus provenance. */
function grammarEdits(ir: DocumentIR, binding: StructuralBinding): RewriteEdit[] {
  const reason = binding.relation.clauses.find(clause => clause.role === 'reason')!.span;
  if (binding.realizationId === 'claim-reason') return [{ nodeId: binding.reasonNodeId, ruleId: 'structural:reason-prefix', sourceSpan: { start: reason.start, end: reason.start }, from: '', to: reasonFrame.surface, evidenceIds: binding.evidenceIds }];
  const copula = binding.relation.evidenceTokens.find(token => token.role === 'copula')!;
  // Keep the predicate's copula/negative/past operators. Only the outer
  // explanation copula and its adjacent full stop are replaced with a comma.
  const terminal = { start: copula.span.start, end: copula.span.end + 1 };
  return [{ nodeId: binding.reasonNodeId, ruleId: 'structural:causal-join', sourceSpan: terminal, from: slice(ir.source.raw, terminal), to: '、', evidenceIds: [] }];
}
function emissionOrder(sourceOrder: string[], bindings: StructuralBinding[]) {
  const order = [...sourceOrder];
  for (const binding of bindings) if (binding.realizationId === 'reason-claim') {
    const a = order.indexOf(binding.claimNodeId), b = order.indexOf(binding.reasonNodeId);
    [order[a], order[b]] = [order[b], order[a]];
  }
  return order;
}
const family = (bindings: StructuralBinding[]) => `structural-explicit-reason:${unique(bindings.map(binding => binding.realizationId)).sort().join('+')}`;
const compatibleLexical = (edit: RewriteEdit, grammar: RewriteEdit[], bindings: StructuralBinding[]) =>
  // The joined main clause already participates in an explicit causal scope.
  // Do not stack the optional explanatory/insistent ending onto that slot;
  // independent noun/pronoun/ordinary-register edits remain composable.
  !(bindings.some(binding => binding.realizationId === 'reason-claim' && edit.nodeId === binding.claimNodeId)
    && rewriteRuleById.get(edit.ruleId)?.kind === 'ending' && rewriteRuleById.get(edit.ruleId)?.mode === 'insistence')
  && !grammar.some(change => change.sourceSpan.start !== change.sourceSpan.end && overlaps(change.sourceSpan, edit.sourceSpan)
  || change.sourceSpan.start === change.sourceSpan.end && edit.sourceSpan.start < change.sourceSpan.start && change.sourceSpan.start < edit.sourceSpan.end);

export function makeStructuralPlans(ir: DocumentIR, request: GenerationRequest, assets: Assets, rewrites: QuotePlan[], diagnostics: ConstructionDiagnostic[] = []): QuotePlan[] {
  if (!request.experimentalStructural || request.task !== 'rewrite' || request.intensity < 2) return [];
  const nodes = sourceNodes(ir), relations = recognize(ir, nodes); if (!relations.length) return [];
  const reorderBlocker = createReorderBlocker(ir, relations, nodes);
  const clauses = bindStructuralClauses(ir, nodes), narrative = planNarrative(ir, 'source_order'), intentPlan = planIntent(ir);
  const available = new Map(assets.evidence.map(item => [item.id, item]));
  const proof = available.get(reasonFrame.evidenceId);
  const prefixAvailable = proof?.sourceType === 'original_post' && proof.text.includes(reasonFrame.needle) && (request.series === 'all' || (reasonFrame.series as readonly string[]).includes(request.series) && proof.series.includes(request.series));
  const report = (relation: Recognized, stage: ConstructionDiagnostic['stage'], reason: string) => diagnostics.push({ inputHash: ir.source.inputHash, nodeId: relation.reasonNodeId, constructionId: 'structural-explicit-reason', candidateId: null, planId: null, stage, reason, sourceSpan: relation.relation.clauses.find(clause => clause.role === 'reason')!.span });
  for (const relation of relations) { report(relation, 'recognized', 'typed_source_reason'); const blocker = reorderBlocker(relation); if (blocker) report(relation, 'scope_blocked', blocker); }
  const plans: QuotePlan[] = [], seen = new Set<string>();
  // Two deterministic patterns, not an exponential pair-by-pair product. Each
  // retained lexical variant is an original-input edit program. Pure projection
  // is also offered, even when no existing fixed lexical rewrite applies.
  for (const pattern of ['reason-claim', 'claim-reason'] as const) {
    const bindings: StructuralBinding[] = [], used = new Set<string>();
    for (const item of relations) {
      if ([item.claimNodeId, item.reasonNodeId].some(id => used.has(id))) continue;
      const realizationId = pattern === 'reason-claim' && !reorderBlocker(item) ? 'reason-claim' : 'claim-reason';
      if (realizationId === 'claim-reason' && !prefixAvailable) continue;
      bindings.push({ ...structuredClone(item), kind: 'explicit-reason', realizationId, evidenceIds: realizationId === 'claim-reason' ? [reasonFrame.evidenceId] : [] });
      used.add(item.claimNodeId); used.add(item.reasonNodeId);
    }
    if (!bindings.length) continue;
    const grammar = bindings.flatMap(binding => grammarEdits(ir, binding));
    for (const base of [...rewrites.slice(0, 6), undefined]) {
      const lexicalEdits = structuredClone(base?.rewrite?.edits ?? []).filter(edit => compatibleLexical(edit, grammar, bindings));
      const structural: StructuralProgram = { version: 1, grammarVersion: structuralGrammarVersion, authoring: 'handwritten-source-projection', seriesId: request.series, intensity: request.intensity, clauses, bindings, sourceOrder: nodes.map(node => node.id), emissionOrder: emissionOrder(nodes.map(node => node.id), bindings), lexicalEdits };
      const edits = [...grammar, ...lexicalEdits].sort(compareSourceEdits);
      const projected = structural.emissionOrder.map(id => { const node = structuredClone(nodes.find(node => node.id === id)!); const local = edits.filter(edit => edit.nodeId === id); node.text = renderEdits(ir.source.raw, node, local); node.evidenceIds = evidenceOf(local); return node; });
      const text = projected.map(node => node.text).join(''); if (seen.has(text)) continue;
      seen.add(text);
      const plan: QuotePlan = { id: '', intent: intentPlan.act, intentPlan, narrative, mainOperator: 'STRUCTURAL', auxiliaryOperators: [], family: family(bindings), mapping: { source: 'typed-original-clauses', target: 'explicit-reason-source-projection', relation: 'handwritten-causal-rearrangement' }, backTranslation: '原文で明示された主張と理由を型付きスロットへ束縛。述語と演算子を原形に戻さず射影し、理由提示または理由先行の文法で実現。語彙編集は元の座標へ一度だけ適用。学習された構文ではない。', forbiddenEffects: intentPlan.forbiddenEffects, evidenceIds: evidenceOf(edits), nodes: projected, structural, experimental: true };
      plan.id = hash(plan).slice(0, 24); plans.push(plan);
      for (const binding of bindings) diagnostics.push({ inputHash: ir.source.inputHash, nodeId: binding.reasonNodeId, constructionId: 'structural-explicit-reason', candidateId: null, planId: plan.id, stage: 'planned', reason: binding.realizationId });
    }
  }
  return plans;
}

/** Independent proof rebuilds source roles, relations, eligible movement and
 * lexical permissions. It never accepts program slots or stated order as proof. */
export function validateStructural(ir: DocumentIR, plan: QuotePlan, references?: Map<string, string>): boolean {
  try {
    const p = plan.structural;
    if (!p || p.version !== 1 || p.grammarVersion !== structuralGrammarVersion || p.authoring !== 'handwritten-source-projection' || ![2, 3].includes(p.intensity) || !p.bindings.length || plan.mainOperator !== 'STRUCTURAL' || plan.rewrite || plan.construction || plan.surface || plan.rhetoric || plan.rhetoricEdits?.length) return false;
    const nodes = sourceNodes(ir), narrative = planNarrative(ir, 'source_order'), intent = planIntent(ir), relations = recognize(ir, nodes);
    if (hash(plan.narrative) !== hash(narrative) || hash(plan.intentPlan) !== hash(intent) || plan.intent !== intent.act || hash(plan.forbiddenEffects) !== hash(intent.forbiddenEffects) || hash(p.clauses) !== hash(bindStructuralClauses(ir, nodes)) || hash(p.sourceOrder) !== hash(nodes.map(node => node.id)) || plan.family !== family(p.bindings)) return false;
    const used = new Set<string>(), reorderBlocker = createReorderBlocker(ir, relations, nodes);
    for (const binding of p.bindings) {
      const observed = relations.find(item => item.id === binding.id);
      if (!observed || binding.kind !== 'explicit-reason' || binding.claimNodeId !== observed.claimNodeId || binding.reasonNodeId !== observed.reasonNodeId || hash(binding.relation) !== hash(observed.relation) || [binding.claimNodeId, binding.reasonNodeId].some(id => used.has(id))) return false;
      used.add(binding.claimNodeId); used.add(binding.reasonNodeId);
      if (binding.realizationId === 'reason-claim') { if (reorderBlocker(observed) || binding.evidenceIds.length) return false; }
      else if (binding.realizationId === 'claim-reason') {
        if (hash(binding.evidenceIds) !== hash([reasonFrame.evidenceId]) || p.seriesId !== 'all' && !(reasonFrame.series as readonly string[]).includes(p.seriesId) || references && !references.get(reasonFrame.evidenceId)?.includes(reasonFrame.needle)) return false;
      } else return false;
    }
    const order = emissionOrder(p.sourceOrder, p.bindings), grammar = p.bindings.flatMap(binding => grammarEdits(ir, binding));
    if (hash(p.emissionOrder) !== hash(order) || hash(plan.nodes.map(node => node.id)) !== hash(order) || plan.nodes.length !== nodes.length || p.lexicalEdits.some(edit => !compatibleLexical(edit, grammar, p.bindings))) return false;
    const edits = [...grammar, ...p.lexicalEdits].sort(compareSourceEdits);
    for (const node of plan.nodes) {
      const original = nodes.find(value => value.id === node.id)!;
      if (!original || node.type !== 'FactClause' || node.mention !== 'primary' || hash(node.sourceSpan) !== hash(original.sourceSpan) || hash(node.factIds) !== hash(original.factIds)) return false;
      const local = edits.filter(edit => edit.nodeId === node.id);
      if (node.text !== renderEdits(ir.source.raw, original, local) || hash(node.evidenceIds) !== hash(evidenceOf(local))) return false;
    }
    if (hash(plan.evidenceIds) !== hash(evidenceOf(edits))) return false;
    if (p.lexicalEdits.length) {
      const lexical: QuotePlan = { ...plan, structural: undefined, mainOperator: 'REWRITE', rewrite: { version: 1, seriesId: p.seriesId, intensity: p.intensity, edits: p.lexicalEdits }, evidenceIds: evidenceOf(p.lexicalEdits), nodes: nodes.map(node => { const local = p.lexicalEdits.filter(edit => edit.nodeId === node.id); return { ...node, text: renderEdits(ir.source.raw, node, local), evidenceIds: evidenceOf(local) }; }) };
      if (!validateRewrite(ir, lexical, references)) return false;
    }
    return true;
  } catch { return false; }
}

/** Atom-level trace of unchanged variable slots and composed lexical edits.
 * Original source coordinates remain unchanged even when clause order changes. */
export function structuralFragments(ir: DocumentIR, plan: QuotePlan, node: PlanNode): { text: string; sourceSpan: Span; origin: OutputSpan['origin']; evidenceIds: string[] }[] {
  const p = plan.structural!, clause = p.clauses.find(clause => clause.nodeId === node.id);
  if (!clause || !node.sourceSpan) return [];
  const edits = [...p.bindings.flatMap(binding => grammarEdits(ir, binding)), ...p.lexicalEdits].filter(edit => edit.nodeId === node.id).sort(compareSourceEdits);
  const fragments: ReturnType<typeof structuralFragments> = [];
  const copy = (range: Span) => {
    for (const slot of clause.slots) {
      const sourceSpan = { start: Math.max(range.start, slot.sourceSpan.start), end: Math.min(range.end, slot.sourceSpan.end) };
      if (sourceSpan.start < sourceSpan.end) fragments.push({ text: slice(ir.source.raw, sourceSpan), sourceSpan, origin: 'source_fact', evidenceIds: [] });
    }
  };
  let cursor = node.sourceSpan.start;
  for (const edit of edits) {
    copy({ start: cursor, end: edit.sourceSpan.start });
    if (edit.to) fragments.push({ text: edit.to, sourceSpan: edit.sourceSpan, origin: 'paraphrase', evidenceIds: edit.evidenceIds });
    cursor = edit.sourceSpan.end;
  }
  copy({ start: cursor, end: node.sourceSpan.end });
  return fragments;
}
