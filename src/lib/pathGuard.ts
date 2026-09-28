import { realpathSync } from 'node:fs';
import path from 'node:path';
import { ToolError } from './errors.js';

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function realpathOrNull(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

/**
 * Resolve a client-supplied relative path against `root` and prove it stays inside.
 * Rejects absolute paths, `..` escapes, NUL bytes, and symlinks whose target escapes the root.
 * Returns the absolute path and the normalized root-relative path (POSIX separators).
 */
export function resolveInside(root: string, userPath: string): { abs: string; rel: string } {
  if (typeof userPath !== 'string' || userPath.length === 0) {
    throw new ToolError('Path must be a non-empty relative path');
  }
  if (userPath.includes('\0')) throw new ToolError('Path contains a NUL byte');
  if (path.isAbsolute(userPath) || /^[A-Za-z]:[\\/]/.test(userPath)) {
    throw new ToolError(
      `Absolute paths are not allowed: "${userPath}". Use a path relative to the workspace root.`,
    );
  }
  const rootAbs = path.resolve(root);
  const abs = path.resolve(rootAbs, userPath);
  if (!isInside(rootAbs, abs)) {
    throw new ToolError(`Path "${userPath}" escapes the workspace root`);
  }
  // Symlink check: compare real paths when the target exists.
  const realRoot = realpathOrNull(rootAbs) ?? rootAbs;
  const real = realpathOrNull(abs);
  if (real !== null && !isInside(realRoot, real)) {
    throw new ToolError(`Path "${userPath}" resolves (via symlink) outside the workspace root`);
  }
  return { abs, rel: toPosix(path.relative(rootAbs, abs)) || '.' };
}

/** Non-throwing variant for filtering results (e.g. search hits). */
export function isSafeRelative(root: string, userPath: string): boolean {
  try {
    resolveInside(root, userPath);
    return true;
  } catch {
    return false;
  }
}

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** Validate a glob pattern supplied by the client (no absolute paths, no parent traversal). */
export function assertSafeGlob(glob: string): void {
  if (glob.includes('\0')) throw new ToolError('Glob contains a NUL byte');
  if (path.isAbsolute(glob) || glob.startsWith('~')) throw new ToolError('path_glob must be relative');
  if (glob.split(/[\\/]/).includes('..')) throw new ToolError('path_glob must not contain ".."');
  if (glob.startsWith('-')) throw new ToolError('path_glob must not start with "-"');
}
