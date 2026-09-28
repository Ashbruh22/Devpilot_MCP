// All logs go to stderr: in stdio mode, stdout is reserved for MCP messages.
type Level = 'debug' | 'info' | 'warn' | 'error';
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const env = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as Level;
  return order[env] ?? order.info;
}

function write(level: Level, msg: string, extra?: Record<string, unknown>): void {
  if (order[level] < threshold()) return;
  const line = { t: new Date().toISOString(), level, msg, ...extra };
  process.stderr.write(JSON.stringify(line) + '\n');
}

export const log = {
  debug: (msg: string, extra?: Record<string, unknown>) => write('debug', msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => write('info', msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => write('warn', msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => write('error', msg, extra),
};
