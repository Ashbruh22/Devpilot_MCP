import { randomUUID } from 'node:crypto';
import type { ParsedTestReport } from './parsers/types.js';

export interface TestRun {
  run_id: string;
  created_at: string;
  repo: string;
  root: string;
  command: string[];
  exit_code: number | null;
  duration_ms: number;
  timed_out: boolean;
  raw_output: string;
  report: ParsedTestReport;
}

/** In-memory LRU of test runs keyed by run_id. */
export class RunStore {
  private readonly runs = new Map<string, TestRun>();
  constructor(private readonly capacity = 20) {}

  newId(): string {
    return `run_${randomUUID().slice(0, 8)}`;
  }

  put(run: TestRun): void {
    this.runs.delete(run.run_id);
    this.runs.set(run.run_id, run);
    while (this.runs.size > this.capacity) {
      const oldest = this.runs.keys().next().value;
      if (oldest === undefined) break;
      this.runs.delete(oldest);
    }
  }

  get(runId: string): TestRun | undefined {
    const run = this.runs.get(runId);
    if (run) {
      // Refresh recency.
      this.runs.delete(runId);
      this.runs.set(runId, run);
    }
    return run;
  }

  ids(): string[] {
    return [...this.runs.keys()];
  }

  get size(): number {
    return this.runs.size;
  }
}
