import { describe, expect, it } from 'vitest';
import type { Template } from '../types';
import {
  buildFolderTree,
  folderName,
  folderParent,
  isSameOrInsideFolder,
  moveFolderInOrder,
  normalizeFolderPath,
  pruneEmptyFolders,
} from './folderTree';

const tpl = (folder: string, name: string, sort_order = 0) =>
  ({ id: name, space_id: 's', name, folder, sort_order }) as unknown as Template;

const paths = (...names: string[]) => names;

describe('folder paths', () => {
  it('normalizes separators and stray whitespace like the Rust side', () => {
    expect(normalizeFolderPath(' Internal \\ Documents ')).toBe('Internal / Documents');
    expect(normalizeFolderPath('/A//B/../C/')).toBe('A / B / C');
  });

  it('splits a path into parent and name', () => {
    expect(folderParent('Internal / Documents')).toBe('Internal');
    expect(folderParent('Internal')).toBe('');
    expect(folderName('Internal / Documents')).toBe('Documents');
    expect(folderName('')).toBe('');
  });

  it('recognises a folder inside another one', () => {
    expect(isSameOrInsideFolder('Internal', 'Internal')).toBe(true);
    expect(isSameOrInsideFolder('Internal / Documents', 'Internal')).toBe(true);
    expect(isSameOrInsideFolder('Internal2', 'Internal')).toBe(false);
    expect(isSameOrInsideFolder('Internal', 'Internal / Documents')).toBe(false);
  });
});

describe('buildFolderTree', () => {
  it('nests imported Postman folders under their parents', () => {
    const tree = buildFolderTree(
      [
        tpl('Internal / Documents', 'List documents'),
        tpl('Internal / Payments', 'Create payment'),
        tpl('External / Offers', 'List offers'),
        tpl('External / Products', 'List products'),
      ],
      paths('Internal', 'Internal / Documents', 'Internal / Payments', 'External', 'External / Offers', 'External / Products'),
    );

    expect(tree.map(n => n.name)).toEqual(['Internal', 'External']);
    expect(tree.map(n => n.depth)).toEqual([0, 0]);
    expect(tree[0].children.map(n => n.name)).toEqual(['Documents', 'Payments']);
    expect(tree[0].children.map(n => n.depth)).toEqual([1, 1]);
    expect(tree[0].children.map(n => n.templates.map(t => t.name))).toEqual([
      ['List documents'],
      ['Create payment'],
    ]);
    expect(tree.map(n => n.total)).toEqual([2, 2]);
    expect(tree[0].children.map(n => n.total)).toEqual([1, 1]);
  });

  it('fills in parents that have no folder row', () => {
    const tree = buildFolderTree([tpl('A / B / C', 'Deep request')], paths('A / B / C'));

    expect(tree.map(n => n.path)).toEqual(['A']);
    expect(tree[0].children.map(n => n.path)).toEqual(['A / B']);
    expect(tree[0].children[0].children[0]).toMatchObject({
      path: 'A / B / C',
      depth: 2,
      total: 1,
      templates: [{ name: 'Deep request' }],
    });
  });

  it('keeps the sidebar order of sibling folders', () => {
    const tree = buildFolderTree([], paths('Zeta', 'Alpha', 'Zeta / Two', 'Zeta / One'));

    expect(tree.map(n => n.name)).toEqual(['Zeta', 'Alpha']);
    expect(tree[0].children.map(n => n.name)).toEqual(['Two', 'One']);
  });

  it('orders templates inside a folder by sort_order, then name', () => {
    const tree = buildFolderTree(
      [tpl('Contacts', 'b', 2), tpl('Contacts', 'a', 1), tpl('Contacts', 'c', 2)],
      paths('Contacts'),
    );

    expect(tree[0].templates.map(t => t.name)).toEqual(['a', 'b', 'c']);
  });

  it('puts templates without a folder in a bucket at the end', () => {
    const tree = buildFolderTree([tpl('Contacts', 'In folder'), tpl('', 'Loose')], paths('Contacts'));

    expect(tree.map(n => n.path)).toEqual(['Contacts', '']);
    expect(tree[1]).toMatchObject({ name: 'No folder', total: 1, templates: [{ name: 'Loose' }] });
  });
});

describe('pruneEmptyFolders', () => {
  it('drops folders that have no matching templates, keeping their ancestors', () => {
    const tree = pruneEmptyFolders(
      buildFolderTree(
        [tpl('Internal / Payments', 'Create payment')],
        paths('Internal', 'Internal / Documents', 'Internal / Payments', 'External', 'External / Offers'),
      ),
    );

    expect(tree.map(n => n.name)).toEqual(['Internal']);
    expect(tree[0].children.map(n => n.name)).toEqual(['Payments']);
    expect(tree[0].total).toBe(1);
  });
});

describe('moveFolderInOrder', () => {
  const order = paths('Internal', 'Internal / Documents', 'Internal / Payments', 'External', 'External / Offers');

  it('moves a folder next to a target at the same level', () => {
    expect(moveFolderInOrder(order, 'External', 'External', { target: 'Internal', edge: 'before' })).toEqual([
      'External',
      'External / Offers',
      'Internal',
      'Internal / Documents',
      'Internal / Payments',
    ]);
  });

  it('moves a folder and its subfolders into a new parent', () => {
    expect(moveFolderInOrder(order, 'External', 'Internal / External', { parent: 'Internal' })).toEqual([
      'Internal',
      'Internal / Documents',
      'Internal / Payments',
      'Internal / External',
      'Internal / External / Offers',
    ]);
  });

  it('renames the moved subtree without touching the rest', () => {
    expect(moveFolderInOrder(order, 'Internal', 'Archived', { parent: '' })).toEqual([
      'External',
      'External / Offers',
      'Archived',
      'Archived / Documents',
      'Archived / Payments',
    ]);
  });
});
