import { describe, expect, it } from 'vitest';
import { median, parseCsv, summarize } from '../bench/summary.js';

describe('bench summary', () => {
  it('computes medians', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNaN();
  });

  it('pairs tasks and ignores incorrect runs for savings', () => {
    const rows = parseCsv(
      [
        'task_id,condition,agent,model,time_to_context_s,tool_calls,correct,date,notes',
        'T01,manual,cc,m,100,10,yes,d,',
        'T01,devpilot,cc,m,40,5,yes,d,',
        'T02,manual,cc,m,200,20,yes,d,',
        'T02,devpilot,cc,m,50,6,yes,d,',
        'T03,manual,cc,m,80,8,yes,d,',
        'T03,devpilot,cc,m,10,3,no,d,wrong file',
      ].join('\n'),
    );
    const s = summarize(rows);
    expect(s.paired_tasks).toBe(2);
    expect(s.median_time_saved_pct).toBeCloseTo(67.5); // (60% + 75%) / 2
    expect(s.manual.median_time_s).toBe(100);
    expect(s.devpilot.median_tool_calls).toBe(5);
  });

  it('rejects unknown conditions', () => {
    expect(() => parseCsv('task_id,condition\nT01,other')).toThrow(/Bad condition/);
  });
});
