import { describe, expect, it } from 'vitest';
import { usageSegments, type Interval } from './lanes';

const MIN = 60_000;
const at = (m: number) => m * MIN;

describe('usageSegments', () => {
  it('returns nothing for no intervals', () => {
    expect(usageSegments([])).toEqual([]);
  });

  it('counts overlapping intervals', () => {
    const intervals: Interval[] = [
      { start: at(0), end: at(30) },
      { start: at(10), end: at(20) },
    ];
    expect(usageSegments(intervals)).toEqual([
      { start: at(0), end: at(10), count: 1, label: undefined },
      { start: at(10), end: at(20), count: 2, label: undefined },
      { start: at(20), end: at(30), count: 1, label: undefined },
    ]);
  });

  it('merges adjacent segments with the same count and label', () => {
    const intervals: Interval[] = [
      { start: at(0), end: at(10), label: '220°' },
      { start: at(10), end: at(25), label: '220°' },
    ];
    expect(usageSegments(intervals)).toEqual([
      { start: at(0), end: at(25), count: 1, label: '220°' },
    ]);
  });

  it('keeps gaps between disjoint intervals', () => {
    const intervals: Interval[] = [
      { start: at(0), end: at(5) },
      { start: at(15), end: at(20) },
    ];
    const segments = usageSegments(intervals);
    expect(segments).toHaveLength(2);
    expect(segments[0].end).toBe(at(5));
    expect(segments[1].start).toBe(at(15));
  });
});
