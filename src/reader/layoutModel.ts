// Timeline layouts that don't depend on the page: estimated dates, and a text-length estimate from verse counts (used
// when no text is on screen, or to keep hidden gospels' sections in place).
import { ROWS, type Book, type Reckoning } from './model';

export type Spacing = 'text' | 'chrono';
export interface Years {
  first: number;
  last: number;
  /** Decimal year → position along the timeline (0–1). */
  toU: (y: number) => number;
  /** Spans shown shortened when the long silences are compressed. */
  breaks: [number, number][];
}
export interface Layout { starts: number[]; ends: number[]; years: Years | null }

const shownIn = (i: number, books: Book[]) => books.some((b) => ROWS[i].refs[b]);

export function computeLayout(books: Book[], spacing: Spacing, opts: { reckoning: Reckoning; compress: boolean }): Layout {
  const n = ROWS.length;
  const starts = new Array<number>(n), ends = new Array<number>(n);
  if (spacing === 'chrono') {
    const t = ROWS.map((r) => r.date[opts.reckoning]);
    const tEnd = t[n - 1] + 0.01;
    const span = t.map((ti, i) => (i + 1 < n ? t[i + 1] : tEnd) - ti);
    // Long silences (the childhood years, the years after age twelve) shrink when compressing.
    const length = span.map((s) => (opts.compress && s > 3 ? 0.8 : s));
    const total = length.reduce((a, b) => a + b, 0);
    const breaks: [number, number][] = [];
    let acc = 0;
    for (let i = 0; i < n; i++) {
      starts[i] = acc / total;
      acc += length[i];
      ends[i] = acc / total;
      if (length[i] !== span[i]) breaks.push([starts[i], ends[i]]);
    }
    const toU = (y: number) => {
      if (y <= t[0]) return 0;
      if (y >= tEnd) return 1;
      let lo = 0, hi = n - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (t[mid] <= y) lo = mid; else hi = mid - 1; }
      return starts[lo] + (ends[lo] - starts[lo]) * Math.min(1, (y - t[lo]) / (span[lo] || 1));
    };
    return { starts, ends, years: { first: t[0], last: tEnd, toU, breaks } };
  }
  const weight = ROWS.map((r, i) => (shownIn(i, books) ? Math.max(1, ...books.map((b) => r.counts[b] ?? 0)) : 0));
  const total = weight.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  for (let i = 0; i < n; i++) { starts[i] = acc / total; acc += weight[i]; ends[i] = acc / total; }
  return { starts, ends, years: null };
}

/** The row at a timeline position; a row with no width resolves to the next row that has one. */
export function rowAtU(u: number, starts: number[], ends: number[]): number {
  const n = starts.length;
  if (!n) return 0;
  let lo = 0, hi = n - 1, best = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (starts[mid] <= u) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  let i = best;
  while (i < n - 1 && ends[i] <= starts[i]) i++;
  if (ends[i] <= starts[i]) { i = best; while (i > 0 && ends[i] <= starts[i]) i--; }
  return i;
}
