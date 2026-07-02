/** Resource-usage lanes derived from scheduled blocks (hands, burners, oven). */

export interface Interval {
  start: number; // ms epoch
  end: number;
  label?: string;
}

export interface UsageSegment {
  start: number;
  end: number;
  count: number;
  label?: string;
}

/**
 * Sweep a set of intervals into disjoint segments annotated with how many
 * intervals overlap there. Adjacent segments with equal count and label merge.
 */
export function usageSegments(intervals: Interval[]): UsageSegment[] {
  if (intervals.length === 0) return [];
  const points = Array.from(
    new Set(intervals.flatMap((i) => [i.start, i.end])),
  ).sort((a, b) => a - b);

  const segments: UsageSegment[] = [];
  for (let p = 0; p < points.length - 1; p += 1) {
    const [from, to] = [points[p], points[p + 1]];
    const covering = intervals.filter((i) => i.start < to && i.end > from);
    if (covering.length === 0) continue;
    const labels = Array.from(new Set(covering.map((i) => i.label).filter(Boolean)));
    const segment: UsageSegment = {
      start: from,
      end: to,
      count: covering.length,
      label: labels.length === 1 ? labels[0] : labels.join(' / ') || undefined,
    };
    const last = segments[segments.length - 1];
    if (last && last.end === from && last.count === segment.count && last.label === segment.label) {
      last.end = to;
    } else {
      segments.push(segment);
    }
  }
  return segments;
}
