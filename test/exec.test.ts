import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCommand, sanitizedEnv, splitCommand } from '../src/lib/exec.js';

const node = process.execPath;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  // A killed process whose parent is gone can linger as a zombie until PID 1 reaps it
  // (containers without an init). A zombie is dead for our purposes.
  try {
    const state = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]?.[0];
    return state !== 'Z';
  } catch {
    return true;
  }
}

describe('exec', () => {
  it('captures output and exit code without a shell', async () => {
    const r = await runCommand(
      node,
      ['-e', 'console.log("hi $HOME"); console.error("err"); process.exit(3)'],
      {
        cwd: os.tmpdir(),
        timeoutMs: 10_000,
        maxOutputChars: 1_000,
      },
    );
    expect(r.exitCode).toBe(3);
    expect(r.stdout.trim()).toBe('hi $HOME'); // no shell expansion
    expect(r.stderr.trim()).toBe('err');
    expect(r.timedOut).toBe(false);
  });

  it('kills the whole process tree on timeout', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'devpilot-exec-'));
    const pidFile = path.join(dir, 'grandchild.pid');
    // The child spawns a long-lived grandchild, records its pid, then hangs.
    const script = `
      const { spawn } = require('node:child_process');
      const gc = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(gc.pid));
      setInterval(() => {}, 1000);`;
    const r = await runCommand(node, ['-e', script], { cwd: dir, timeoutMs: 1_000, maxOutputChars: 1_000 });
    expect(r.timedOut).toBe(true);
    expect(r.durationMs).toBeLessThan(8_000);
    expect(existsSync(pidFile)).toBe(true);
    const gcPid = Number(readFileSync(pidFile, 'utf8'));
    await new Promise((res) => setTimeout(res, 300));
    expect(alive(gcPid)).toBe(false);
  });

  it('caps output (tail)', async () => {
    const r = await runCommand(node, ['-e', 'for (let i = 0; i < 5000; i++) console.log("line " + i)'], {
      cwd: os.tmpdir(),
      timeoutMs: 10_000,
      maxOutputChars: 200,
      keep: 'tail',
    });
    expect(r.stdout.length).toBeLessThanOrEqual(200);
    expect(r.stdout).toContain('line 4999');
    expect(r.stdoutTruncated).toBe(true);
  });

  it('caps output (head)', async () => {
    const r = await runCommand(node, ['-e', 'for (let i = 0; i < 5000; i++) console.log("line " + i)'], {
      cwd: os.tmpdir(),
      timeoutMs: 10_000,
      maxOutputChars: 100,
      keep: 'head',
    });
    expect(r.stdout.startsWith('line 0')).toBe(true);
    expect(r.stdout.length).toBe(100);
    expect(r.stdoutTruncated).toBe(true);
  });

  it('reports spawn errors instead of throwing', async () => {
    const r = await runCommand('definitely-not-a-real-binary-xyz', [], {
      cwd: os.tmpdir(),
      timeoutMs: 5_000,
      maxOutputChars: 100,
    });
    expect(r.spawnError).toMatch(/ENOENT/);
  });

  it('strips secrets from the child environment', async () => {
    const env = sanitizedEnv({
      PATH: '/bin',
      GITHUB_TOKEN: 'x',
      DEVPILOT_API_KEY: 'y',
      AWS_SECRET_ACCESS_KEY: 'z',
      MY_PASSWORD: 'p',
      HOME: '/h',
    });
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.DEVPILOT_API_KEY).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.MY_PASSWORD).toBeUndefined();
    expect(env.PATH).toBe('/bin');
    expect(env.CI).toBe('1');

    process.env.GITHUB_TOKEN = 'ghp_should_not_leak';
    try {
      const r = await runCommand(node, ['-e', 'console.log(process.env.GITHUB_TOKEN ?? "none")'], {
        cwd: os.tmpdir(),
        timeoutMs: 5_000,
        maxOutputChars: 100,
      });
      expect(r.stdout.trim()).toBe('none');
    } finally {
      delete process.env.GITHUB_TOKEN;
    }
  });

  it('splits configured commands without shell semantics', () => {
    expect(splitCommand('npx vitest run --reporter=json')).toEqual([
      'npx',
      'vitest',
      'run',
      '--reporter=json',
    ]);
    expect(splitCommand(`pytest -k "not slow" -q`)).toEqual(['pytest', '-k', 'not slow', '-q']);
    expect(() => splitCommand('npm test && rm -rf /')).toThrow(/Shell operator/);
    expect(() => splitCommand('echo $HOME')).toThrow(/Shell operator/);
    expect(() => splitCommand('echo "oops')).toThrow(/Unterminated/);
  });
});
