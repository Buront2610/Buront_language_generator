import type { DocumentIR, PlanNode, QuotePlan, RhetoricalBlock, RewriteEdit, Span, StructuralProgram } from '../contracts';
import { propositionScopes } from './grammar-scope';
import { hash, outputProtectedValues, overlaps, slice } from './source';
import { planIntent, planNarrative } from './planning';
import { recognizeRhetoricalRelations, literalRhetoricalContextSpans } from './rhetorical-recognition';
import { realizeRhetoricalBlock, relationRealizations, rhetoricalOperatorById } from './rhetorical-operators';
import { structuralEvidenceHashes, structuralEvidenceSeries } from './rhetorical-evidence';
import { blockAlignsWithUnits, contained, originalStructuralNodes, renderStructural, structuralEvidence, structuralFamily, uniqueIds } from './structural-realization';
import { compareSourceEdits, renderEdits, validateRewrite } from './rewrite-validation';
import { rewriteRuleById } from './rewrite-rules';

// This verifier intentionally does not import or invoke the structural planner.
// The submitted relation, text, node labels and program hash are not authority:
// all relations and recipes are rebound to the immutable original-source IR.
const seriesIds = new Set(['all', 'roto', 'yorusama', 'saiko', 'night', 'puronohito', 'nega', 'katuru', 'gg', 'sonota']);
const searchContract = { policy: 'bounded-relation-composition-v3', maxBlocks: 8, maxPlans: 12 };
const same = (left: unknown, right: unknown): boolean => hash(left) === hash(right);
const keys = (value: unknown, expected: string[]): boolean => !!value && typeof value === 'object' && !Array.isArray(value)
  && same(Object.keys(value).sort(), [...expected].sort());
const validSpan = (span: Span, length: number): boolean => keys(span, ['start', 'end'])
  && Number.isSafeInteger(span.start) && Number.isSafeInteger(span.end) && 0 <= span.start && span.start < span.end && span.end <= length;
const validReference = (id: string, references?: Map<string, string>): boolean => !references
  || typeof references.get(id) === 'string' && hash(references.get(id)!) === structuralEvidenceHashes[id];

function validProgram(program: StructuralProgram | undefined): program is StructuralProgram {
  return !!program && keys(program, ['version', 'seriesId', 'intensity', 'blocks', 'localEdits', 'search'])
    && program.version === 3 && [2, 3].includes(program.intensity) && seriesIds.has(program.seriesId)
    && same(program.search, searchContract) && Array.isArray(program.blocks) && program.blocks.length > 0
    && program.blocks.length <= searchContract.maxBlocks && Array.isArray(program.localEdits);
}

/** Every source-role character is emitted exactly once, either copied or via a
 * registered, independently regenerated inflection/shell replacement. Markers
 * may change the surface linkage, but may not swallow another premise. */
function slotsCovered(ir: DocumentIR, block: RhetoricalBlock): boolean {
  const slots = block.relation.slots;
  if (new Set(slots.map(slot => slot.role)).size !== slots.length || slots.some((slot, index) => slots.slice(index + 1).some(other => overlaps(slot.span, other.span)))) return false;
  for (const piece of block.pieces) {
    if (!piece.sourceSpan) continue;
    const slot = slots.find(slot => contained(piece.sourceSpan!, slot.span));
    if (!slot) {
      // A source contrast prefix belongs to the recognized relation, rather
      // than either proposition. Only an exact registered marker copy is legal.
      if (!block.relation.markers.some(marker => (piece.kind === 'form' || marker.role === piece.role) && same(marker.span, piece.sourceSpan))
        || block.pieces.filter(other => other.sourceSpan && same(other.sourceSpan, piece.sourceSpan)).length !== 1) return false;
    } else if (piece.kind === 'source' && piece.role !== slot.role) return false;
  }
  for (const slot of slots) {
    const pieces = block.pieces.filter(piece => piece.sourceSpan && contained(piece.sourceSpan, slot.span));
    let cursor = slot.span.start;
    // Check emitted order as well as coverage: inner source roles never reverse.
    for (const piece of pieces) {
      if (piece.sourceSpan!.start !== cursor || piece.sourceSpan!.end <= cursor) return false;
      cursor = piece.sourceSpan!.end;
    }
    if (cursor !== slot.span.end) return false;
  }
  if (block.relation.markers.some(marker => marker.role === 'boundary' && !/^[\s。、,！!？?]*$/u.test(slice(ir.source.raw, marker.span)))) return false;
  // A quantity/URL/name cannot disappear inside a discarded causal separator.
  return ir.source.protectedValues.filter(value => overlaps(value.span, block.sourceSpan))
    .every(value => slots.some(slot => contained(value.span, slot.span))
      || block.pieces.some(piece => piece.kind === 'source' && contained(value.span, piece.sourceSpan)));
}

/** Broader recognition is permission to retain a source limitation, never to
 * silently resolve it. Literal context remains byte-for-byte source text;
 * future/potential claims cannot enter a fact-nominalization recipe. */
function preservationPermitted(ir: DocumentIR, block: RhetoricalBlock, localEdits: RewriteEdit[]): boolean {
  const relation = block.relation;
  if (relation.version !== 3) return false;
  if (relation.kind === 'modest-achievement' && (!['scale-minimizing', 'nonboast', 'limited-competence'].includes(relation.selfEvaluation ?? '')
    || !['completed-event', 'past-ability', 'perfective-event', 'past-event-modality-unresolved'].includes(relation.achievementKind ?? '')
    || !['explicit-first-person', 'source-omitted'].includes(relation.agentResolution ?? ''))) return false;
  if (relation.kind === 'evidence-request' && (!['proposition', 'nominal'].includes(relation.targetMode ?? '')
    || !['quotative', 'genitive', 'adnominal'].includes(relation.targetLink ?? ''))) return false;
  const owningSlot = (predicateTokenId: number) => {
    const token = ir.tokens.find(token => token.id === predicateTokenId);
    return token && relation.slots.find(slot => contained(token.span, slot.span));
  };
  const literal = new Set(relation.slots.filter(slot => slot.role === 'context'));
  for (const condition of relation.conditions) {
    if (!['asserted', 'modality-preserved', 'literal-copy', 'embedded-scope'].includes(condition.preservation)) return false;
    const owned = owningSlot(condition.predicateTokenId);
    if (owned?.role === 'context' && (!(condition.illocution === 'literal-context' || relation.sourceForm === 'carrier-evidence-request' && condition.sourceRole === 'mentioned-target' && condition.illocution === 'mentioned-proposition') || condition.preservation !== 'literal-copy')) return false;
    if (owned?.role === 'target' && (condition.illocution !== 'mentioned-proposition'
      || relation.targetMode === 'nominal' && condition.preservation !== 'literal-copy')) return false;
    if (condition.preservation === 'asserted' && (condition.realization !== 'actual' || condition.conditional || condition.speculative
      || condition.prospective || condition.ambiguous || condition.attribution.kind !== 'narrator' || condition.attribution.speaker !== null
      || condition.polarity === 'unknown' || condition.tense === 'unknown' || condition.voice === 'unknown')) return false;
    if (condition.preservation === 'embedded-scope') {
      if (condition.sourceRole !== 'embedded-description' || condition.illocution !== 'mentioned-proposition') return false;
      const scope = propositionScopes(ir.source, ir).find(scope => scope.predicate.id === condition.predicateTokenId);
      if (!scope || localEdits.some(edit => scope.tokens.some(token => overlaps(token.span, edit.sourceSpan)))
        || block.pieces.some(piece => piece.kind === 'form' && piece.sourceSpan && scope.tokens.some(token => overlaps(token.span, piece.sourceSpan!)))) return false;
    }
    if (condition.preservation === 'literal-copy') {
      const slot = owned; if (!slot) return false;
      literal.add(slot);
    }
  }
  for (const slot of literal) {
    const pieces = block.pieces.filter(piece => piece.sourceSpan && overlaps(piece.sourceSpan, slot.span));
    if (pieces.length !== 1 || pieces[0].kind !== 'source' || pieces[0].role !== slot.role || !same(pieces[0].sourceSpan, slot.span)
      || localEdits.some(edit => overlaps(edit.sourceSpan, slot.span))) return false;
    if (slot.role === 'context' && (block.pieces[0] !== pieces[0] || slot.span.start !== relation.sourceSpan.start)) return false;
  }
  if (relation.kind === 'reason-claim' && relation.conditions.some(condition => condition.preservation === 'modality-preserved')
    && block.operatorId !== 'reason-explanation') return false;
  if (relation.kind === 'modest-achievement' && relation.selfEvaluation !== 'scale-minimizing'
    && block.pieces.some(piece => piece.kind === 'form' && piece.formId === 'supplied-modest-evaluation')) return false;
  if (relation.kind === 'evidence-request' && relation.targetMode === 'nominal' && relation.sourceForm !== 'carrier-evidence-request') {
    const target = relation.slots.find(slot => slot.role === 'target');
    if (!target || block.pieces.some(piece => piece.kind === 'form' && piece.sourceSpan && overlaps(piece.sourceSpan, target.span))) return false;
  }
  return true;
}

function rebindBlocks(ir: DocumentIR, program: StructuralProgram, references?: Map<string, string>): RhetoricalBlock[] | undefined {
  const relations = recognizeRhetoricalRelations(ir), original = originalStructuralNodes(ir), blocks: RhetoricalBlock[] = [];
  const length = [...ir.source.raw].length;
  for (const submitted of program.blocks) {
    if (!submitted || !validSpan(submitted.sourceSpan, length) || !blockAlignsWithUnits(submitted.sourceSpan, original)
      || blocks.length && blocks.at(-1)!.sourceSpan.end > submitted.sourceSpan.start) return;
    const relation = relations.find(relation => relation.id === submitted.relation?.id && same(relation, submitted.relation));
    const operator = rhetoricalOperatorById.get(submitted.operatorId);
    if (!relation || !operator || operator.level > program.intensity
      || !relationRealizations(relation, program.intensity).some(choice => choice.operatorId === submitted.operatorId && choice.realizationId === submitted.realizationId)) return;
    const ids = submitted.evidenceIds;
    if (!Array.isArray(ids) || ids.length < 2 || new Set(ids).size !== ids.length) return;
    const permitted = operator.examples.filter(example => ids.includes(example.id)
      && (program.seriesId === 'all' || (example.series as readonly string[]).includes(program.seriesId))
      && validReference(example.id, references) && (!references || references.get(example.id)?.includes(example.needle))).map(example => example.id);
    if (!same(ids, permitted) || operator.id === 'carrier-evidence-request' && ids.length !== operator.examples.length) return;
    const expected = realizeRhetoricalBlock(ir, relation, submitted.operatorId, submitted.realizationId, permitted);
    if (!expected || !same(submitted, expected) || !slotsCovered(ir, expected) || !preservationPermitted(ir, expected, program.localEdits)) return;
    blocks.push(expected);
  }
  return blocks;
}

function originalLexicalPlan(ir: DocumentIR, plan: QuotePlan, references?: Map<string, string>): QuotePlan | undefined {
  const program = plan.structural!, original = originalStructuralNodes(ir), length = [...ir.source.raw].length;
  const literalContexts = literalRhetoricalContextSpans(ir);
  if (program.localEdits.some(edit => literalContexts.some(span => overlaps(span, edit.sourceSpan)))) return;
  for (const edit of program.localEdits) {
    if (!keys(edit, ['nodeId', 'sourceSpan', 'ruleId', 'from', 'to', 'evidenceIds']) || !validSpan(edit.sourceSpan, length)) return;
    const node = original.find(node => node.id === edit.nodeId), rule = rewriteRuleById.get(edit.ruleId);
    if (!node?.sourceSpan || !contained(edit.sourceSpan, node.sourceSpan) || !rule || rule.kind === 'punctuation' || rule.mode === 'insistence'
      || !structuralEvidenceSeries[rule.evidenceId] || !validReference(rule.evidenceId, references)
      || program.seriesId !== 'all' && !structuralEvidenceSeries[rule.evidenceId].includes(program.seriesId)) return;
    const intersecting = program.blocks.filter(block => overlaps(edit.sourceSpan, block.sourceSpan));
    if (intersecting.some(block => !contained(edit.sourceSpan, block.sourceSpan)
      || block.pieces.filter(piece => piece.kind === 'source' && contained(edit.sourceSpan, piece.sourceSpan)).length !== 1)) return;
  }
  // Preserve the ORIGINAL fact-node IDs and units. A moved block cannot lend a
  // safe narrator clause's permissions to another original clause or a quote.
  return { ...plan, structural: undefined, mainOperator: 'REWRITE',
    rewrite: { version: 1, intensity: program.intensity, seriesId: program.seriesId, edits: program.localEdits },
    evidenceIds: uniqueIds(program.localEdits), nodes: original.map(node => {
      const edits = program.localEdits.filter(edit => edit.nodeId === node.id);
      return { ...node, text: renderEdits(ir.source.raw, node, edits), evidenceIds: uniqueIds(edits) };
    }) };
}

function renderSourcePiece(ir: DocumentIR, span: Span, edits: RewriteEdit[]): string {
  const node: PlanNode = { id: '', type: 'FactClause', text: '', sourceSpan: span, factIds: [], evidenceIds: [] };
  return renderEdits(ir.source.raw, node, edits.filter(edit => contained(edit.sourceSpan, span)).sort(compareSourceEdits));
}
const signature = (text: string): unknown => text.trim() ? outputProtectedValues(text).map(value => [
  value.kind, value.raw, value.role, value.comparator ?? null, value.decimal ?? null, value.unit ?? null, value.sign ?? null,
]) : [];

function quantityPreserved(ir: DocumentIR, program: StructuralProgram, blocks: RhetoricalBlock[]): boolean {
  for (const block of blocks) {
    for (const slot of block.relation.slots) {
      const rendered = block.pieces.filter(piece => piece.sourceSpan && contained(piece.sourceSpan, slot.span))
        .map(piece => piece.kind === 'source' ? renderSourcePiece(ir, piece.sourceSpan, program.localEdits) : piece.text).join('');
      if (!same(signature(slice(ir.source.raw, slot.span)), signature(rendered))) return false;
    }
    for (const piece of block.pieces) {
      if (piece.kind !== 'source' || block.relation.slots.some(slot => contained(piece.sourceSpan, slot.span))) continue;
      if (!same(signature(slice(ir.source.raw, piece.sourceSpan)), signature(renderSourcePiece(ir, piece.sourceSpan, program.localEdits)))) return false;
    }
  }
  for (const node of originalStructuralNodes(ir)) {
    if (blocks.some(block => contained(node.sourceSpan!, block.sourceSpan))) continue;
    if (!same(signature(node.text), signature(renderSourcePiece(ir, node.sourceSpan!, program.localEdits)))) return false;
  }
  return true;
}

/** Compare each original role independently. Causal clause reordering must not
 * be mistaken for changing the global occurrence order of protected values. */
export function structuralQuantityPreserved(ir: DocumentIR, plan: QuotePlan): boolean {
  try {
    if (!validProgram(plan.structural)) return false;
    const blocks = rebindBlocks(ir, plan.structural);
    return !!blocks && quantityPreserved(ir, plan.structural, blocks);
  } catch { return false; }
}

export function validateStructural(ir: DocumentIR, plan: QuotePlan, references?: Map<string, string>): boolean {
  try {
    const program = plan.structural;
    if (!validProgram(program) || ir.topicOnly || !keys(plan, ['id', 'intent', 'intentPlan', 'narrative', 'mainOperator', 'auxiliaryOperators', 'family', 'mapping', 'backTranslation', 'evidenceIds', 'forbiddenEffects', 'nodes', 'experimental', 'structural'])
      || plan.mainOperator !== 'STRUCTURAL' || plan.experimental !== true || !same(plan.auxiliaryOperators, [])
      || typeof plan.backTranslation !== 'string' || !Array.isArray(plan.nodes)) return false;
    const intent = planIntent(ir), narrative = planNarrative(ir, 'source_order');
    if (!same(plan.intentPlan, intent) || plan.intent !== intent.act || !same(plan.narrative, narrative)
      || !same(plan.mapping, { source: 'original-propositions-and-illocution', target: 'source-grounded-rhetorical-operators', relation: 'typed-rhetorical-composition-v3' })
      || !same(plan.forbiddenEffects, [...intent.forbiddenEffects, 'promote_mentioned_target', 'duplicate_premise', 'remove_limitation'])) return false;
    const blocks = rebindBlocks(ir, program, references);
    if (!blocks || !quantityPreserved(ir, program, blocks)) return false;
    if (program.localEdits.length) {
      const lexical = originalLexicalPlan(ir, plan, references);
      if (!lexical || !validateRewrite(ir, lexical, references)) return false;
    }
    // Reconstruct nodes from source units, then independently verified recipes.
    // Never render submitted plan.nodes text as the verification oracle.
    const reconstructed = renderStructural(ir, { ...plan, structural: { ...program, blocks } });
    if (!same(plan.nodes, reconstructed.nodes) || !same(plan.evidenceIds, structuralEvidence(plan))
      || plan.family !== structuralFamily(plan) || plan.id !== hash({ ...plan, id: '' }).slice(0, 24)) return false;
    return true;
  } catch { return false; }
}
