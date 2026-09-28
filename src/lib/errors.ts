/**
 * An error whose message is safe and useful to show the client verbatim.
 * Anything else thrown inside a tool is reported generically (no stack traces).
 */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
