// Copies static assets into dist/ and marks the stdio entry executable.
import { chmodSync, cpSync, existsSync, readFileSync } from 'node:fs';

cpSync('src/public', 'dist/public', { recursive: true });

const bin = 'dist/stdio.js';
if (!existsSync(bin)) throw new Error(`${bin} was not emitted`);
if (!readFileSync(bin, 'utf8').startsWith('#!/usr/bin/env node')) {
  throw new Error(`${bin} lost its shebang`);
}
chmodSync(bin, 0o755);
console.log('postbuild: copied public/ and chmod +x dist/stdio.js');
