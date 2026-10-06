import type { DocumentIR, RhetoricalBlock, RhetoricalIntent, RhetoricalPiece, Span } from '../contracts';
import type { Assets } from './assets';
import type { RhetoricalRelation } from './rhetorical-recognition';
import { carrierEvidenceOperator, realizeCarrierEvidencePieces } from './evidence-request-roles';
import { slice } from './source';
import { clauseInflection, embeddableClause } from './rhetorical-grammar';

/** Source examples motivate mechanisms, not permission to invent propositions.
 * Each operator cites multiple identified corpus records; those records may
 * share a thread/leakage group and do not constitute independent validation.
 * The text is not transplanted wholesale: only grammatical forms and
 * source-bound slots are realized. Speaker identity in the historical corpus
 * is not certified; a bounded adaptation is not a measured style judgment. */
export const rhetoricalOperatorRegistry = [
  carrierEvidenceOperator,
  { id: 'reason-explanation', kind: 'reason-claim', level: 2, mechanisms: ['clause-recomposition', 'explanatory-stance'],
    permittedChange: 'Explicit causal proposition is presented as assertion followed by its existing explanation; no new causal edge or confidence.',
    constraints: ['explicit-source-cause', 'same-scope', 'asserted-clauses', 'no-new-participants', 'one-use-per-proposition'],
    examples: [
      { id: 'post_01041_a61029816407677b_3227', series: ["roto"], needle: 'かというと' },
      { id: 'post_02278_620a09e0e0aee5cd_8838', series: ["nega"], needle: '何故かと言うと' },
      { id: 'post_02421_ef97fdc26a351d5a_9490', series: ["gg"], needle: '何故なら' },
      { id: 'post_02331_21fb0e747871e8fb_9047', series: ["katuru"], needle: 'なぜならば' },
    ] },
  { id: 'reason-nominalized-conclusion', kind: 'reason-claim', level: 2, mechanisms: ['clause-recomposition', 'nominalized-conclusion', 'syntax-blending'],
    permittedChange: 'Existing reason is fronted and its assertion is closed as a nominalized conclusion; preserves original assertion and reason direction.',
    constraints: ['explicit-source-cause', 'same-scope', 'asserted-clauses', 'no-new-certainty', 'one-use-per-proposition'],
    examples: [
      { id: 'post_02026_4dc2474bff1f1aaa_7525', series: ["katuru"], needle: 'なので文句を言わないという事' },
      { id: 'post_02223_d646bc4708a3c5e0_8497', series: ["katuru"], needle: 'だからもててるのだという事実' },
      { id: 'post_02107_8608932d4f4ac31d_7882', series: ["sonota"], needle: 'という事実' },
    ] },
  { id: 'modesty-achievement-focus', kind: 'modest-achievement', level: 2, mechanisms: ['clause-recomposition', 'modesty-achievement-contrast'],
    permittedChange: 'Recompose an explicitly supplied completed event before or into its supplied modest self-evaluation; no praise, superior rank or extra deed.',
    constraints: ['explicit-source-modesty', 'completed-source-deed', 'retain-limitation', 'retain-omitted-agent', 'no-invented-praise'],
    examples: [
      { id: 'post_01092_7d511557129472bf_3433', series: ["yorusama"], needle: 'それほどでもないが' },
      { id: 'post_01309_8c6dc8c23e4f2d30_4103', series: ["yorusama"], needle: '自慢野郎じゃないからそれほどでもない' },
      { id: 'post_01690_01eabacc0c5882f8_5672', series: ["night"], needle: 'それほどでもない' },
    ] },
  { id: 'targeted-evidence-question', kind: 'evidence-request', level: 3, mechanisms: ['clause-recomposition', 'question-syntax-blending'],
    permittedChange: 'Re-express an already requested proof of a mentioned proposition as a pointed evidentiary question; target remains mentioned, never asserted or denied.',
    constraints: ['source-explicit-evidence-question', 'no-invented-adversary', 'same-mentioned-target', 'no-invented-rebuttal', 'no-assertion-promotion'],
    examples: [
      { id: 'post_00050_7911117f148beb34_76', series: ["roto"], needle: 'どうやって偽者だって証拠' },
      { id: 'post_00074_5e7996bff1eb05b0_110', series: ["roto"], needle: 'っていうどういう証拠' },
      { id: 'post_01607_a816269c46e1a468_5331', series: ["night"], needle: 'どうやってそれが反省してないという証拠' },
      { id: 'post_01608_9d1a10cf7bd2b13e_5336', series: ["night"], needle: 'という証拠はあるのかよ' },
    ] },
] as const;
export type RhetoricalOperator = typeof rhetoricalOperatorRegistry[number];
export const rhetoricalOperatorById = new Map<string, RhetoricalOperator>(rhetoricalOperatorRegistry.map(item => [item.id, item]));
export function operatorEvidence(operator: RhetoricalOperator, series: string, assets: Pick<Assets, 'evidence'>): string[] {
  const evidence = new Map(assets.evidence.map(item => [item.id, item]));
  const permitted = operator.examples.filter(example => {
    const item = evidence.get(example.id);
    return item?.sourceType === 'original_post' && item.text.includes(example.needle) && (series === 'all' || (example.series as readonly string[]).includes(series) && item.series.includes(series));
  });
  // A selected series never silently borrows evidence from another series.
  return permitted.length >= 2 && (operator.id !== 'carrier-evidence-request' || permitted.length === operator.examples.length) ? permitted.map(example => example.id) : [];
}
const inside = (inner: Span, outer: Span) => outer.start <= inner.start && inner.end <= outer.end;

/** Deterministic grammar recipes. Invoked afresh by the independent verifier,
 * with relations re-recognized from immutable source, not serialized proof. */
export function realizeRhetoricalBlock(ir: DocumentIR, relation: RhetoricalRelation, operatorId: string, realizationId: string, evidenceIds: string[]): RhetoricalBlock | undefined {
  const operator = rhetoricalOperatorById.get(operatorId);
  if (!operator || operator.kind !== relation.kind || evidenceIds.length < 2) return;
  const pieces: RhetoricalPiece[] = [], anchor = relation.sourceSpan.start;
  const form = (id: string, text: string, sourceSpan?: Span) => pieces.push({ kind: 'form', formId: id, text, anchor: sourceSpan?.start ?? anchor, ...(sourceSpan ? { sourceSpan } : {}), evidenceIds: [...evidenceIds] });
  const slot = (role: string) => relation.slots.find(item => item.role === role);
  const clause = (role: string, nominalCopula = false): boolean => {
    const item = slot(role); if (!item) return false;
    if (relation.conditions.some(condition => condition.preservation === 'literal-copy' && item.factIds.includes(condition.factId))) {
      pieces.push({ kind: 'source', role, sourceSpan: { ...item.span } }); return true;
    }
    const inflection = clauseInflection(ir, item.span);
    if (inflection && inside(inflection.sourceSpan, item.span)) {
      if (inflection.sourceSpan.start > item.span.start) pieces.push({ kind: 'source', role, sourceSpan: { start: item.span.start, end: inflection.sourceSpan.start } });
      form(`grammar:${inflection.kind}`, inflection.text, inflection.sourceSpan);
    } else pieces.push({ kind: 'source', role, sourceSpan: { ...item.span } });
    let text = inflection ? slice(ir.source.raw, { start: item.span.start, end: inflection.sourceSpan.start }) + inflection.text : slice(ir.source.raw, item.span);
    if (nominalCopula) { form('grammar:declarative-copula', 'だ'); text += 'だ'; }
    return embeddableClause(text);
  };
  const reason = () => clause('reason', relation.markers.some(item => item.role === 'cause-link-copula'));
  if (operatorId === 'carrier-evidence-request') {
    const carrierPieces = realizeCarrierEvidencePieces(ir, relation, realizationId, evidenceIds); if (!carrierPieces) return;
    pieces.push(...carrierPieces);
  } else if (operatorId === 'reason-explanation') {
    if (realizationId === 'explanation-then-bounded-claim' && ['trailing-reason', 'trailing-tame'].includes(relation.sourceForm)) {
      if (!reason()) return;
      form('source-cause-link', 'から、'); if (!clause('claim')) return; form('sentence-boundary', '。');
    } else {
    if (realizationId !== 'assertion-then-explanation' || !['causal-clause', 'causal-tame'].includes(relation.sourceForm)) return;
    if (!clause('claim')) return;
    form('sentence-boundary', '。'); form('explanatory-turn', '何故かというと');
    if (!reason()) return;
    form('source-cause-close', 'からだ。');
    }
  } else if (operatorId === 'reason-nominalized-conclusion') {
    if (!['premise-then-nominalized-conclusion', 'premise-then-fact-conclusion'].includes(realizationId)) return;
    // Source order must actually change for a trailing explanation. For an
    // already cause-first clause, nominalization alone is a separate mechanism,
    // never reported as a document-order improvement.
    if (!reason()) return;
    form('source-cause-link', 'から'); if (!clause('claim')) return;
    form('nominalized-conclusion', realizationId === 'premise-then-fact-conclusion' ? 'という事実。' : 'ということ。');
  } else if (operatorId === 'modesty-achievement-focus') {
    const modesty = slot('modesty'); if (!modesty) return;
    // Denying boasting is not interchangeable with denying the scale of a deed.
    const preserveAssessment = relation.selfEvaluation !== 'scale-minimizing';
    if (realizationId === 'assessment-then-event-split' && relation.sourceForm === 'concessive-assessment') {
      // Contrast splitting is an ordinary grammar primitive serving the
      // attested self-assessment/event operation, not a claimed corpus phrase.
      if (!clause('modesty')) return;
      const link = relation.markers.find(marker => marker.role === 'assessment-concession'); if (!link) return;
      form('grammar:split-concession', '。とはいえ、', link.span);
      if (!clause('achievement')) return; form('sentence-boundary', '。');
    } else if (realizationId === 'assessment-event-fusion' && relation.sourceForm === 'concessive-sentences') {
      if (!clause('modesty')) return;
      form('grammar:fuse-assessment-concession', 'が、');
      const link = relation.markers.find(marker => marker.role === 'assessment-sentence-contrast'); if (!link) return;
      pieces.push({ kind: 'source', role: link.role, sourceSpan: { ...link.span } });
      if (!clause('achievement')) return; form('sentence-boundary', '。');
    } else if (realizationId === 'deed-then-modesty') {
      if (!clause('achievement')) return;
      form(relation.sourceForm === 'concessive-assessment' ? 'retained-assessment-contrast' : 'sentence-boundary', relation.sourceForm === 'concessive-assessment' ? 'が、' : '。');
      if (preserveAssessment) { if (!clause('modesty')) return; }
      else form('supplied-modest-evaluation', 'それほどでもない', modesty.span);
      form('sentence-boundary', '。');
    } else if (realizationId === 'modesty-with-deed') {
      if (preserveAssessment) { if (!clause('modesty')) return; }
      else form('supplied-modest-evaluation', 'それほどでもない', modesty.span);
      form('modesty-deed-juxtaposition', 'が、');
      if (!clause('achievement')) return;
      form('sentence-boundary', '。');
    } else return;
  } else if (operatorId === 'targeted-evidence-question') {
    const context = slot('context');
    if (context) pieces.push({ kind: 'source', role: 'context', sourceSpan: { ...context.span } });
    const contrast = relation.markers.find(item => item.role === 'contrast-prefix');
    if (contrast) pieces.push({ kind: 'source', role: 'contrast-prefix', sourceSpan: { ...contrast.span } });
    const request = slot('request'); if (!request) return;
    const head = relation.markers.find(item => item.role === 'evidence-head');
    const noun = head ? slice(ir.source.raw, head.span) : /根拠/u.test(slice(ir.source.raw, request.span)) ? '根拠' : '証拠';
    const nominal = relation.targetMode === 'nominal', target = slot('target');
    // Relative-clause targets ask for evidence about their full judgment/event,
    // not proof that the embedded proposition is true. Keep the full adnominal
    // relation and request object, rather than flattening it into a statement.
    const mentionedTarget = () => nominal && target ? (pieces.push({ kind: 'source', role: 'target', sourceSpan: { ...target.span } }), true) : clause('target');
    const nominalLink = () => {
      if (!nominal || relation.targetLink !== 'genitive') return true;
      const link = relation.markers.find(item => target && item.span.start === target.span.end && head && item.span.end === head.span.start && slice(ir.source.raw, item.span) === 'の');
      if (!link) return false;
      pieces.push({ kind: 'source', role: link.role, sourceSpan: { ...link.span } }); return true;
    };
    if (realizationId === 'target-then-mixed-question') {
      if (!mentionedTarget() || !nominalLink()) return;
      form('mentioned-target-mixed-question', nominal ? `${noun}っていうのはどういう${noun}なんだ？` : `っていうどういう${noun}があるのかよ？`, request.span);
    } else if (realizationId === 'question-then-target') {
      form('evidence-question-front', `どういう${noun}があるのかよ、`, request.span);
      if (!mentionedTarget() || !nominalLink()) return;
      form('mentioned-target-tail', nominal ? `${noun}って。` : 'って。');
    } else return;
  } else return;
  const intent: RhetoricalIntent = relation.kind === 'reason-claim' ? { act: 'justify-assertion', stance: 'assertive', targetFactIds: slot('claim')!.factIds, premiseFactIds: slot('reason')!.factIds } : relation.kind === 'modest-achievement' ? { act: 'modest-self-presentation', stance: 'self-limiting', targetFactIds: slot('achievement')!.factIds, premiseFactIds: slot('modesty')!.factIds } : { act: 'request-evidence', stance: 'questioning', targetFactIds: slot('target')?.factIds ?? ir.facts.filter(fact => relation.evidenceRequest && inside(fact.predicateSpan, relation.evidenceRequest.targetSpan)).map(fact => fact.id), premiseFactIds: slot('request')!.factIds };
  return { intent: structuredClone(intent), nodeId: `rhetorical-node-${relation.sourceSpan.start}-${relation.sourceSpan.end}`, sourceSpan: { ...relation.sourceSpan }, relation: structuredClone(relation), operatorId, realizationId, pieces, evidenceIds: [...evidenceIds] };
}

export function relationRealizations(relation: RhetoricalRelation, intensity: number): { operatorId: string; realizationId: string }[] {
  if (intensity < 2) return [];
  if (relation.kind === 'reason-claim') {
    const modality = relation.conditions.some(condition => condition.preservation !== 'asserted' || condition.realization !== 'actual');
    return [
      ...(['causal-clause', 'causal-tame'].includes(relation.sourceForm) ? [{ operatorId: 'reason-explanation', realizationId: 'assertion-then-explanation' }] : [{ operatorId: 'reason-explanation', realizationId: 'explanation-then-bounded-claim' }]),
      ...(!modality ? [{ operatorId: 'reason-nominalized-conclusion', realizationId: 'premise-then-nominalized-conclusion' },
        ...(intensity === 3 ? [{ operatorId: 'reason-nominalized-conclusion', realizationId: 'premise-then-fact-conclusion' }] : [])] : []),
    ];
  }
  if (relation.kind === 'modest-achievement') return (relation.sourceForm === 'concessive-assessment' ? ['assessment-then-event-split'] : relation.sourceForm === 'concessive-sentences' ? ['assessment-event-fusion'] : ['deed-then-modesty', 'modesty-with-deed']).map(realizationId => ({ operatorId: 'modesty-achievement-focus', realizationId }));
  if (relation.sourceForm === 'carrier-evidence-request' && intensity === 3) return [{ operatorId: 'carrier-evidence-request', realizationId: 'request-then-carrier' }];
  if (relation.kind === 'evidence-request' && intensity === 3) return ['target-then-mixed-question', 'question-then-target'].map(realizationId => ({ operatorId: 'targeted-evidence-question', realizationId }));
  return [];
}
