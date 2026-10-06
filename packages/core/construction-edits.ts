import type { ConstructionEdit, QuotePlan, RewriteEdit, Span } from '../contracts';
import { overlaps } from './source';
import { compareSourceEdits } from './rewrite-validation';

type Edit = ConstructionEdit | RewriteEdit;
const contains = (outer: Span, inner: Span) => outer.start <= inner.start && inner.end <= outer.end;
const prefix = (edit: Edit) => 'operation' in edit && edit.operation?.kind === 'prefix_source_body' ? edit.operation : undefined;

// Read/evidence scopes never masquerade as write ranges. The sole composable
// insertion is a registered prefix referencing an unchanged source body. Its
// local edits still need the complete independent rewrite proof.
export function constructionEditsConflict(a: Edit, b: Edit): boolean {
  const left = a.sourceSpan, right = b.sourceSpan;
  const leftInsertion = left.start === left.end, rightInsertion = right.start === right.end;
  if (leftInsertion && rightInsertion && left.start === right.start) return true;
  if (!leftInsertion && !rightInsertion && overlaps(left, right)) return true;
  if (leftInsertion && right.start < left.start && left.start < right.end) return true;
  if (rightInsertion && left.start < right.start && right.start < left.end) return true;
  for (const [frame, other] of [[a, b], [b, a]] as [Edit, Edit][]) {
    const operation = prefix(frame);
    if (!operation) continue;
    const touchedBody = overlaps(operation.bodySourceSpan, other.sourceSpan)
      || other.sourceSpan.start === frame.sourceSpan.start;
    if (touchedBody && ('constructionId' in other || other.nodeId !== frame.nodeId || !contains(operation.bodySourceSpan, other.sourceSpan))) return true;
  }
  return false;
}

export const constructionEdits = (plan: QuotePlan): Edit[] => [...plan.construction!.lexicalEdits, ...plan.construction!.edits].sort(compareSourceEdits);

export function hasConstructionEditConflicts(edits: Edit[]): boolean {
  const ordered = [...edits].sort(compareSourceEdits);
  if (ordered.some((edit, index) => index > 0 && constructionEditsConflict(ordered[index - 1], edit))) return true;
  // An insertion can read a wider body than its write point. Check that finite
  // extra policy only for prefixes, without quadratic copying of all edits.
  return ordered.filter(edit => !!prefix(edit)).some(frame => ordered.some(edit => edit !== frame && constructionEditsConflict(frame, edit)));
}
