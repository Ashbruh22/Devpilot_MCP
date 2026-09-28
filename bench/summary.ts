/**
 * Summarize bench/results.csv: median time-to-context and tool calls per condition, and the
 * median per-task time saved by DevPilot (only tasks answered correctly in both conditions).
 *
 *   npm run bench:summary
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface BenchRow {
  task_id: string;
  condition: 'manual' | 'devpilot';
  time_to_context_s: number;
  tool_calls: number;
  correct: boolean;
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function parseCsv(text: string): BenchRow[] {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const cols = (header ?? '').split(',');
  return lines
    .filter((l) => l.trim())
    .map((line) => {
      const cells = line.split(',');
      const get = (name: string) => (cells[cols.indexOf(name)] ?? '').trim();
      const condition = get('condition');
      if (condition !== 'manual' && condition !== 'devpilot') throw new Error(`Bad condition in: ${line}`);
      return {
        task_id: get('task_id'),
        condition,
        time_to_context_s: Number(get('time_to_context_s')),
        tool_calls: Number(get('tool_calls')),
        correct: /^(yes|true|1)$/i.test(get('correct')),
      };
    });
}

export function summarize(rows: BenchRow[]) {
  const by = (c: BenchRow['condition']) => rows.filter((r) => r.condition === c);
  const savings: number[] = [];
  for (const task of new Set(rows.map((r) => r.task_id))) {
    const m = rows.filter((r) => r.task_id === task && r.condition === 'manual' && r.correct);
    const d = rows.filter((r) => r.task_id === task && r.condition === 'devpilot' && r.correct);
    if (!m.length || !d.length) continue;
    const mt = median(m.map((r) => r.time_to_context_s));
    const dt = median(d.map((r) => r.time_to_context_s));
    if (mt > 0) savings.push((1 - dt / mt) * 100);
  }
  const stats = (c: BenchRow['condition']) => ({
    runs: by(c).length,
    median_time_s: median(by(c).map((r) => r.time_to_context_s)),
    median_tool_calls: median(by(c).map((r) => r.tool_calls)),
  });
  return {
    runs: rows.length,
    paired_tasks: savings.length,
    manual: stats('manual'),
    devpilot: stats('devpilot'),
    median_time_saved_pct: median(savings),
    min_time_saved_pct: savings.length ? Math.min(...savings) : NaN,
    max_time_saved_pct: savings.length ? Math.max(...savings) : NaN,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const rows = parseCsv(readFileSync(new URL('./results.csv', import.meta.url), 'utf8'));
  if (!rows.length) {
    console.warn('bench/results.csv has no runs yet. See bench/README.md for the method.');
  } else {
    const s = summarize(rows);
    console.warn(JSON.stringify(s, null, 2));
    if (s.paired_tasks) {
      console.warn(
        `\nMedian time-to-context saved: ${s.median_time_saved_pct.toFixed(0)}% across ${s.paired_tasks} paired ` +
          `task(s) (range ${s.min_time_saved_pct.toFixed(0)}–${s.max_time_saved_pct.toFixed(0)}%).`,
      );
    }
  }
}
