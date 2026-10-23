import { describe, expect, it } from 'vitest';
import { dropZoneAt, moveId } from './drag';

describe('moveId', () => {
  const ids = ['a', 'b', 'c'];

  it('moves an item down past its neighbour', () => {
    expect(moveId(ids, 'a', 'b', true)).toEqual(['b', 'a', 'c']);
  });

  it('moves an item up before its neighbour', () => {
    expect(moveId(ids, 'c', 'a', false)).toEqual(['c', 'a', 'b']);
  });

  it('moves to the end by dropping after the last item', () => {
    expect(moveId(ids, 'a', 'c', true)).toEqual(['b', 'c', 'a']);
  });

  it('still moves when the pair is already adjacent', () => {
    expect(moveId(['a', 'b'], 'a', 'b', true)).toEqual(['b', 'a']);
  });

  it('ignores drops onto itself or unknown targets', () => {
    expect(moveId(ids, 'a', 'a', true)).toBe(ids);
    expect(moveId(ids, 'a', 'zzz', true)).toBe(ids);
  });

  it('does not mutate the input', () => {
    moveId(ids, 'a', 'c', true);
    expect(ids).toEqual(['a', 'b', 'c']);
  });
});

describe('dropZoneAt', () => {
  const row = (clientY: number) =>
    ({ clientY, currentTarget: { getBoundingClientRect: () => ({ top: 100, height: 20 }) } }) as unknown as React.DragEvent<HTMLElement>;

  it('uses the outer quarters to reorder and the middle to nest', () => {
    expect(dropZoneAt(row(101))).toBe('before');
    expect(dropZoneAt(row(110))).toBe('inside');
    expect(dropZoneAt(row(119))).toBe('after');
  });
});
