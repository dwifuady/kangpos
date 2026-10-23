// Small helpers for the hand-rolled HTML5 drag-and-drop in the sidebar.

/** Put `id` directly before or after `targetId` in a list of ids. */
export function moveId(ids: string[], id: string, targetId: string, after: boolean): string[] {
  if (id === targetId) return ids;
  const next = ids.filter(x => x !== id);
  const index = next.indexOf(targetId);
  if (index < 0) return ids;
  next.splice(after ? index + 1 : index, 0, id);
  return next;
}

/** Where a drop lands relative to the row under the pointer. */
export type DropEdge = 'before' | 'after' | null;

/** Inset line on the edge of a row so the drop position is visible without shifting layout. */
export function dropEdgeClass(edge: DropEdge): string {
  if (edge === 'before') return 'shadow-[inset_0_2px_0_0_var(--accent-color)]';
  if (edge === 'after') return 'shadow-[inset_0_-2px_0_0_var(--accent-color)]';
  return '';
}

/** Which half of the row the pointer is over. */
export function dropEdgeAt(event: React.DragEvent<HTMLElement>): 'before' | 'after' {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
}
