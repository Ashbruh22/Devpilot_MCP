export type Runner = 'vitest' | 'jest' | 'pytest' | 'raw';

export interface ParsedFailure {
  test_name: string;
  /** Test file, relative to the workspace root when possible. */
  file: string;
  line?: number;
  /** First meaningful lines of the failure (no stack). */
  message: string;
  /** Full failure text including stack, used for frame extraction. */
  stack: string;
}

export interface ParsedTestReport {
  runner: Runner;
  passed: number;
  failed: number;
  skipped: number;
  failures: ParsedFailure[];
  /** True when counts came from a machine-readable report rather than scraping text. */
  structured: boolean;
}
