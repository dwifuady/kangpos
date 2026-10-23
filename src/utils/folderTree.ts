// Template folders are paths (`Internal / Documents`). The sidebar shows them as
// a tree; these helpers build that tree and compute drag results. Pure and tested.

import type { Template } from '../types';

export interface FolderNode {
  /** Full path, `''` for templates that have no folder. */
  path: string;
  /** Last path segment; `'No folder'` for the root bucket. */
  name: string;
  /** Nesting level: 0 for a top-level folder. */
  depth: number;
  /** Templates directly in this folder, in sidebar order. */
  templates: Template[];
  children: FolderNode[];
  /** Templates in this folder and all its subfolders. */
  total: number;
}

/** Same canonical form as the Rust side: levels trimmed and joined with " / ". */
export function normalizeFolderPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .map(s => s.trim())
    .filter(s => s !== '' && s !== '.' && s !== '..')
    .join(' / ');
}

/** Parent path (`A` for `A / B`), empty for a top-level folder. */
export function folderParent(path: string): string {
  const parts = normalizeFolderPath(path).split(' / ').filter(Boolean);
  parts.pop();
  return parts.join(' / ');
}

/** Last path segment (`B` for `A / B`). */
export function folderName(path: string): string {
  const parts = normalizeFolderPath(path).split(' / ').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

/** True when `path` is `parent` or lies somewhere below it. */
export function isSameOrInsideFolder(path: string, parent: string): boolean {
  if (!path || !parent) return false;
  return path === parent || path.startsWith(`${parent} / `);
}

const bySidebarOrder = (a: Template, b: Template) =>
  a.sort_order - b.sort_order || a.name.localeCompare(b.name);

/**
 * Build the folder tree. `folderOrder` is the sidebar order of the folder rows;
 * folders not listed there (and every parent of a listed path) are filled in from
 * the templates, so nested paths always have their ancestors.
 */
export function buildFolderTree(templates: Template[], folderOrder: string[] = []): FolderNode[] {
  const order: string[] = [];
  const seen = new Set<string>();

  const addPath = (raw: string) => {
    const path = normalizeFolderPath(raw);
    if (!path || seen.has(path)) return;
    addPath(folderParent(path)); // ancestors first, so parents exist before children
    seen.add(path);
    order.push(path);
  };

  for (const path of folderOrder) addPath(path);
  for (const t of templates) addPath(t.folder);

  const nodes = new Map<string, FolderNode>();
  const roots: FolderNode[] = [];

  for (const path of order) {
    const parent = folderParent(path);
    const parentNode = parent ? nodes.get(parent) : undefined;
    const node: FolderNode = {
      path,
      name: folderName(path),
      depth: parentNode ? parentNode.depth + 1 : 0,
      templates: [],
      children: [],
      total: 0,
    };
    nodes.set(path, node);
    if (parentNode) parentNode.children.push(node);
    else roots.push(node);
  }

  const loose: Template[] = [];
  for (const t of templates) {
    const path = normalizeFolderPath(t.folder);
    if (!path) loose.push(t);
    else nodes.get(path)?.templates.push(t);
  }

  const count = (node: FolderNode): number => {
    node.templates.sort(bySidebarOrder);
    node.total = node.templates.length + node.children.reduce((n, child) => n + count(child), 0);
    return node.total;
  };
  roots.forEach(count);

  // Templates outside every folder are a bucket of their own, shown last.
  if (loose.length > 0) {
    loose.sort(bySidebarOrder);
    roots.push({ path: '', name: 'No folder', depth: 0, templates: loose, children: [], total: loose.length });
  }
  return roots;
}

/** Drop folders that hold no matching templates (used while filtering). */
export function pruneEmptyFolders(nodes: FolderNode[]): FolderNode[] {
  return nodes
    .map(node => ({ ...node, children: pruneEmptyFolders(node.children) }))
    .filter(node => node.total > 0);
}

/** Where a moved folder goes: inside a parent, or next to a target folder. */
export type FolderPlacement = { parent: string } | { target: string; edge: 'before' | 'after' };

/**
 * The new global folder order after moving `fromPath` (with its subfolders) to
 * `newPath`. `paths` is the current order of every folder row.
 */
export function moveFolderInOrder(
  paths: string[],
  fromPath: string,
  newPath: string,
  placement: FolderPlacement,
): string[] {
  const renamed = paths.map(p =>
    p === fromPath || p.startsWith(`${fromPath} / `) ? `${newPath}${p.slice(fromPath.length)}` : p,
  );
  const subtree = renamed.filter(p => p === newPath || p.startsWith(`${newPath} / `));
  const rest = renamed.filter(p => !(p === newPath || p.startsWith(`${newPath} / `)));

  let index = rest.length;
  if ('target' in placement) {
    const at = rest.indexOf(placement.target);
    if (at >= 0) index = placement.edge === 'after' ? at + 1 : at;
  } else {
    // End of the new parent: after the last folder inside it.
    const parent = normalizeFolderPath(placement.parent);
    if (parent) {
      for (let i = rest.length - 1; i >= 0; i--) {
        if (rest[i] === parent || rest[i].startsWith(`${parent} / `)) {
          index = i + 1;
          break;
        }
      }
    }
  }
  return [...rest.slice(0, index), ...subtree, ...rest.slice(index)];
}
