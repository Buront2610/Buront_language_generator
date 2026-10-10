import { Type, Static } from '@sinclair/typebox';
import Ajv2020 from 'ajv/dist/2020';

const enumeration = <T extends string>(values: T[]) => Type.Union(values.map(value => Type.Literal(value)));
export const Series = enumeration(['all', 'roto', 'yorusama', 'saiko', 'night', 'puronohito', 'nega', 'katuru', 'gg', 'sonota']);
export const SpanSchema = Type.Object({ start: Type.Integer({ minimum: 0 }), end: Type.Integer({ minimum: 0 }) }, { additionalProperties: false });
export const RuleSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 64 }), from: Type.String({ minLength: 1, maxLength: 128 }),
  to: Type.String({ maxLength: 128 }), priority: Type.Integer({ minimum: 0, maximum: 1000 }),
}, { additionalProperties: false });
export const GenerationSchema = Type.Object({
  source: Type.String({ minLength: 1, maxLength: 5000 }), task: enumeration(['rewrite', 'quote']),
  contextMode: enumeration(['faithful', 'full']), noveltyMode: enumeration(['canonical', 'blend', 'invent']),
  intensity: Type.Integer({ minimum: 1, maximum: 3 }), series: Series,
  focusSpans: Type.Optional(Type.Array(SpanSchema, { maxItems: 64 })), seed: Type.Optional(Type.String({ maxLength: 128 })),
  backend: enumeration(['structured', 'model']), customRules: Type.Optional(Type.Array(RuleSchema, { maxItems: 100 })),
  clientRevision: Type.Integer({ minimum: 0 }),
  experimentalStructural: Type.Optional(Type.Boolean()),
}, { $id: 'buront:generation-request:v1', $schema: 'https://json-schema.org/draft/2020-12/schema', additionalProperties: false });
export const PreferenceSchema = Type.Object({
  comparisonId: Type.String({ minLength: 1, maxLength: 128 }), annotatorId: Type.String({ minLength: 1, maxLength: 64 }),
  dimension: enumeration(['S', 'Q', 'C']), choice: enumeration(['left', 'right', 'tie', 'both_bad', 'cannot_judge']),
  reason: Type.String({ maxLength: 2000 }),
}, { additionalProperties: false });
export const RegenerationSchema = Type.Object({
  analysisId: Type.String({ maxLength: 200 }), candidateId: Type.String({ maxLength: 64 }),
  lockedNodeIds: Type.Array(Type.String({ maxLength: 64 }), { maxItems: 100 }),
  seed: Type.String({ maxLength: 128 }), operator: Type.Optional(Type.String({ pattern: '^(OP-(0[1-9]|10)|REWRITE|CONSTRUCTION|STRUCTURAL)$' })),
  series: Type.Optional(Series), clientRevision: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false });
export const AnalysisSchema = Type.Object({
  parserVersion: Type.String({ minLength: 1, maxLength: 2048 }),
  tokens: Type.Array(Type.Object({ id: Type.Integer({ minimum: 0 }), text: Type.String({ maxLength: 12000 }), lemma: Type.String({ maxLength: 12000 }), reading: Type.String({ maxLength: 12000 }), pos: Type.String({ maxLength: 32 }), tag: Type.String({ maxLength: 256 }), dep: Type.String({ maxLength: 32 }), head: Type.Integer({ minimum: 0 }), span: SpanSchema, morphology: Type.Array(Type.String({ maxLength: 256 }), { maxItems: 32 }) }, { additionalProperties: false }), { maxItems: 12000 }),
  sentences: Type.Array(SpanSchema, { maxItems: 12000 }), warnings: Type.Array(Type.String({ maxLength: 512 }), { maxItems: 100 }),
}, { additionalProperties: false });
const ajv = new Ajv2020({ allErrors: true, strict: true, coerceTypes: false, removeAdditional: false, useDefaults: false });
export const validateGenerationSchema = ajv.compile(GenerationSchema);
export const validatePreference = ajv.compile(PreferenceSchema);
export const validateRegeneration = ajv.compile(RegenerationSchema);
const validateAnalysisSchema = ajv.compile(AnalysisSchema);
export function validateAnalysis(value: unknown, source: string): asserts value is Analysis {
  if (!validateAnalysisSchema(value)) throw new Error('INVALID_ANALYSIS_CONTRACT');
  const analysis = value as Analysis, chars = [...source];
  if (analysis.tokens.some((token, i) => token.id !== i || token.head >= analysis.tokens.length || token.span.start >= token.span.end || token.span.end > chars.length || chars.slice(token.span.start, token.span.end).join('') !== token.text)) throw new Error('INVALID_ANALYSIS_OFFSETS');
  if (analysis.sentences.some((span, i) => span.start >= span.end || span.end > chars.length || i > 0 && span.start < analysis.sentences[i - 1].end)) throw new Error('INVALID_ANALYSIS_SENTENCES');
}
export type GenerationRequest = Static<typeof GenerationSchema>;
export type Preference = Static<typeof PreferenceSchema>;
export type Span = Static<typeof SpanSchema>;
export type Rule = Static<typeof RuleSchema>;
export function validateRequest(value: unknown): asserts value is GenerationRequest {
  if (!validateGenerationSchema(value)) throw new Error('INVALID_REQUEST: ' + ajv.errorsText(validateGenerationSchema.errors));
  const request = value as GenerationRequest;
  if (!request.source.trim() || !request.source.isWellFormed()) throw new Error('INVALID_SOURCE');
  const length = [...request.source].length;
  for (const span of request.focusSpans ?? []) if (span.start >= span.end || span.end > length) throw new Error('INVALID_FOCUS_SPAN');
  const sorted = [...(request.focusSpans ?? [])].sort((a, b) => a.start - b.start);
  if (sorted.some((span, i) => i > 0 && span.start < sorted[i - 1].end)) throw new Error('OVERLAPPING_FOCUS_SPANS');
  const ids = new Set<string>();
  for (const rule of request.customRules ?? []) {
    if (!rule.from.isWellFormed() || !rule.to.isWellFormed() || ids.has(rule.id)) throw new Error('INVALID_DICTIONARY');
    ids.add(rule.id);
  }
}
export type Check = { code: string; status: 'pass' | 'fail' | 'unknown'; required: boolean; explanation: string; sourceSpan?: Span; outputSpan?: Span; factIds: string[]; checkerVersion: string };
export type Token = { id: number; text: string; lemma: string; reading: string; pos: string; tag: string; dep: string; head: number; span: Span; morphology: string[] };
export type Analysis = { parserVersion: string; tokens: Token[]; sentences: Span[]; warnings: string[] };
export type ProtectedValue = { id: string; kind: string; raw: string; span: Span; decimal?: string; unit?: string; sign?: string; comparator?: 'eq' | 'lt' | 'le' | 'gt' | 'ge'; role: string; parentId?: string };
export type SourceDocument = { raw: string; inputHash: string; scalarToUtf16: number[]; normalized: string; normalizationMap: Span[]; protectedValues: ProtectedValue[]; opaqueSpans: Span[] };
export type Argument = { role: 'agent' | 'patient' | 'recipient' | 'location'; entityId: string | null; text: string; span: Span };
export type Fact = { id: string; sourceSpan: Span; predicateSpan: Span; predicateLemma: string; arguments: Argument[]; polarity: 'positive' | 'negative' | 'unknown'; realization: 'actual' | 'prospective' | 'hypothetical' | 'unknown'; completion: 'completed' | 'ongoing' | 'not_completed' | 'unknown'; tense: 'past' | 'nonpast' | 'unknown'; voice: 'active' | 'passive' | 'unknown'; attribution: { kind: 'narrator' | 'quotation' | 'hearsay'; speaker: string | null }; protectedValueIds: string[]; resolution: 'resolved' | 'partial' | 'opaque' };
export type AnchorReference = { id: string; raw: string; span: Span; utteranceSpan: Span; target: string; usage: 'reply' | 'evaluation' | 'agreement' | 'evidence' | 'vocative' | 'gratitude' | 'unknown'; factIds: string[] };
export type DocumentIR = { source: SourceDocument; parserVersion: string; facts: Fact[]; entities: { id: string; text: string; mentions: Span[] }[]; sentences: Span[]; anchors: AnchorReference[]; times: { text: string; span: Span }[]; conditions: Span[]; relations: { type: string; from: string; to: string }[]; adoptedSpans: Span[]; omittedSpans: Span[]; topicOnly: boolean; tokens: Token[] };
export type IntentPlan = { act: 'observation' | 'achievement' | 'unresolved' | 'prospect' | 'gratitude' | 'warning' | 'rebuttal' | 'self_justification'; targetFacts: string[]; targetSpan: Span; stance: 'neutral' | 'cautious' | 'appreciative'; addressee: string | null; evidence: string; forbiddenEffects: string[] };
export type NarrativeUnit = { id: string; sourceSpan: Span; factIds: string[]; role: 'achievement' | 'unresolved' | 'prospect' | 'observation' | 'reported' | 'conditional' | 'gratitude' };
export type NarrativePlan = { strategy: 'source_order' | 'status_order'; units: NarrativeUnit[]; sourceOrder: string[]; displayOrder: string[]; preservedRelations: DocumentIR['relations']; orderingReason: string };
export type SurfacePlan = { seriesId: string; profileHash: string; constructionId: string; evidenceIds: string[]; coreText: string };
export type RhetoricRelation = 'assistance' | 'exposure' | 'recovery' | 'stoppage' | 'verification';
export type RhetoricProgram = { version: 1; factId: string; relation: RhetoricRelation; participants: Argument[]; polarity: Fact['polarity']; tense: Fact['tense']; realization: Fact['realization']; completion: Fact['completion']; target: string; operator: string; discourse: 'mapping_first' | 'criterion_first'; discourseEvidenceIds: string[] };
export type RhetoricEdit = { sourceSpan: Span; outputSpan: Span; ruleId: string; from: string; to: string };
export type RewriteEdit = { nodeId: string; sourceSpan: Span; ruleId: string; from: string; to: string; evidenceIds: string[] };
export type RewriteProgram = { version: 1; seriesId: string; intensity: number; edits: RewriteEdit[] };
export type ConstructionBinding = { slot: 'emotion' | 'degree' | 'predicate' | 'marker' | 'experiencer' | 'state' | 'time' | 'claim' | 'reason' | 'antecedent' | 'contrast' | 'modesty' | 'achievement'; span: Span; text: string; tokenIds: number[] };
export type RecognizedDiscourseRelation = { version: 1; kind: 'explicit-reason' | 'explicit-contrast' | 'modest-achievement'; factId: string; clauses: { role: 'claim' | 'reason' | 'antecedent' | 'contrast' | 'modesty' | 'achievement'; span: Span; tokenIds: number[] }[]; evidenceTokens: { role: 'predicate' | 'marker' | 'past' | 'limit' | 'copula'; tokenId: number; span: Span }[]; conditions: { predicateTokenId: number; factId: string; polarity: Fact['polarity']; tense: Fact['tense']; realization: Fact['realization']; completion: Fact['completion']; voice: Fact['voice']; attribution: Fact['attribution']; conditional: boolean; speculative: boolean; prospective: boolean; ambiguous: boolean; nonDeclarative: boolean; reportedContent: boolean }[]; certainty: 'explicit'; provenance: { inputHash: string; parserVersion: string } };
export type ConstructionOperation = { kind: 'replace' } | { kind: 'prefix_source_body'; prefix: string; bodySourceSpan: Span; permittedLocalEdits: 'independently_verified_rewrites' };
export type ConstructionDiagnostic = { inputHash: string; nodeId: string | null; constructionId: string; candidateId: string | null; planId: string | null; stage: 'recognized' | 'relation_not_recognized' | 'unsupported_form' | 'scope_blocked' | 'edit_conflict' | 'planned' | 'verification_rejected' | 'verified' | 'selected' | 'not_selected'; reason: string; sourceSpan?: Span };
export type ConstructionEdit = { nodeId: string; sourceSpan: Span; operation: ConstructionOperation; relation?: RecognizedDiscourseRelation; constructionId: string; constructionVersion: 1 | 2; realizationId: string; factId: string; from: string; to: string; evidenceIds: string[]; bindings: ConstructionBinding[]; features: Pick<Fact, 'polarity' | 'tense' | 'realization' | 'completion' | 'attribution' | 'voice'> };
export type ConstructionProgram = { version: 2; seriesId: string; intensity: number; edits: ConstructionEdit[]; lexicalEdits: RewriteEdit[] };

// Experimental source-projection grammar. Lexical slots carry original scalar
// offsets and parser tokens, never memorized completed source/output strings.
export type StructuralSlot = { id: string; role: 'agent' | 'patient' | 'recipient' | 'location' | 'predicate' | 'operator' | 'case' | 'adjunct' | 'punctuation' | 'gap'; sourceSpan: Span; tokenIds: number[]; factIds: string[]; protectedValueIds: string[] };
export type StructuralClause = { nodeId: string; sourceSpan: Span; slots: StructuralSlot[]; predicates: Fact[] };
export type StructuralBinding = { id: string; kind: 'explicit-reason'; claimNodeId: string; reasonNodeId: string; relation: RecognizedDiscourseRelation; realizationId: 'claim-reason' | 'reason-claim'; evidenceIds: string[] };
export type StructuralProgram = { version: 1; grammarVersion: 'explicit-reason-slots-v1'; authoring: 'handwritten-source-projection'; seriesId: string; intensity: number; clauses: StructuralClause[]; bindings: StructuralBinding[]; sourceOrder: string[]; emissionOrder: string[]; lexicalEdits: RewriteEdit[] };

export type PlanNode = { id: string; type: 'FactClause' | 'ProtectedLiteral' | 'RhetoricalClause' | 'Connective' | 'QuoteBoundary' | 'Reference'; text: string; sourceSpan?: Span; factIds: string[]; evidenceIds: string[]; mention?: 'primary' | 'rhetorical_reference' };
export type QuotePlan = { id: string; intent: string; intentPlan?: IntentPlan; narrative?: NarrativePlan; surface?: SurfacePlan; rhetoric?: RhetoricProgram; rhetoricEdits?: RhetoricEdit[]; rewrite?: RewriteProgram; construction?: ConstructionProgram; structural?: StructuralProgram; mainOperator: string; auxiliaryOperators: string[]; family: string; mapping: { source: string; target: string; relation: string }; backTranslation: string; evidenceIds: string[]; forbiddenEffects: string[]; nodes: PlanNode[]; experimental: boolean };
export type OutputSpan = { span: Span; nodeId: string; origin: 'source_fact' | 'paraphrase' | 'rhetoric' | 'direct_quote' | 'unresolved_copy'; sourceSpan?: Span; factIds: string[]; evidenceIds: string[] };
export type Novelty = { classification: 'known_quote' | 'adaptation' | 'candidate_novel' | 'undetermined'; text: number | null; structure: number | null; concept: number | null; nearestIds: string[]; datasetId: string; historySnapshot: string; window: string };
export type Candidate = { id: string; text: string; plan: QuotePlan; spans: OutputSpan[]; checks: Check[]; verificationStatus: 'passed' | 'rejected' | 'needs_review'; verificationScope: string; scores: { S: number | null; Q: number | null; C: number | null; R: number | null }; novelty: Novelty; evidence: { id: string; kind: string; text: string; url?: string }[] };
export type GenerationResult = { inputHash: string; clientRevision: number; selectedCandidateId: string | null; candidates: Candidate[]; candidatePool?: Candidate[]; reviewCandidates: Candidate[]; fallback: { text: string; reason: string } | null; shortfallReason: string | null; ir: DocumentIR; diagnostics?: ConstructionDiagnostic[]; replayManifest: Record<string, unknown>; analysisId?: string };
