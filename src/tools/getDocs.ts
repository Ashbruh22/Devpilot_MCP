import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import {
  listDocFiles,
  readDoc,
  scoreSection,
  splitSections,
  tokenize,
  type DocSection,
} from '../lib/docs.js';
import { ToolError } from '../lib/errors.js';
import { resolveInside } from '../lib/pathGuard.js';
import { fitToBudget } from '../lib/truncate.js';
import { readOnly, safe, toolResult, workspaceRepoField, type ServerDeps } from './shared.js';

export const getDocsOutput = z.object({
  workspace: z.string(),
  sections: z.array(z.object({ path: z.string(), heading: z.string(), content: z.string() })),
  available_docs: z.array(z.string()),
});

const DOC_EXT = /\.(md|mdx|markdown|txt|rst)$/i;

export function registerGetDocs(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    'get_docs',
    {
      title: 'Get project docs',
      description:
        'Read project documentation (README*, CONTRIBUTING*, root *.md, docs/**/*.md). With "path": return that file, or just the section whose heading matches "topic". With only "topic": return the 3 best-matching sections ranked by keyword hits. With neither: return the README intro and the list of docs.',
      inputSchema: z.object({
        topic: z
          .string()
          .max(200)
          .optional()
          .describe('Keywords to look for, e.g. "discount rounding" or "configuration".'),
        path: z
          .string()
          .max(300)
          .optional()
          .describe('A specific doc file relative to the workspace root, e.g. "docs/setup.md".'),
        max_chars: z
          .number()
          .int()
          .min(200)
          .max(50_000)
          .default(8000)
          .describe('Total character budget for returned section content. Default 8000.'),
        repo: workspaceRepoField,
      }),
      outputSchema: getDocsOutput,
      annotations: { ...readOnly, openWorldHint: false },
    },
    safe('get_docs', async ({ topic, path: docPath, max_chars, repo }) => {
      const ws = deps.workspaces.resolve(repo);
      const available = listDocFiles(ws.root);
      const budget = Math.min(max_chars, Math.floor(deps.config.maxOutputChars * 0.8));
      const terms = tokenize(topic ?? '');
      let picked: DocSection[];

      if (docPath) {
        const { abs, rel } = resolveInside(ws.root, docPath);
        if (!DOC_EXT.test(rel))
          throw new ToolError(`"${rel}" is not a documentation file (.md, .mdx, .txt, .rst).`);
        const text = readDoc(abs);
        if (text === null) {
          throw new ToolError(
            `Doc "${rel}" not found or too large.${available.length ? ` Available: ${available.slice(0, 15).join(', ')}` : ''}`,
          );
        }
        const sections = splitSections(rel, text);
        if (terms.length) {
          const ranked = sections
            .map((s) => ({
              s,
              score: scoreSection({ ...s, content: '' }, terms) || scoreSection(s, terms) / 10,
            }))
            .filter((x) => x.score > 0)
            .sort((a, b) => b.score - a.score);
          if (!ranked.length) {
            throw new ToolError(
              `No section in ${rel} matches "${topic}". Headings: ${sections
                .map((s) => s.heading)
                .slice(0, 20)
                .join(' | ')}`,
            );
          }
          picked = [ranked[0]!.s];
        } else {
          picked = [{ path: rel, heading: '(whole file)', level: 0, content: text }];
        }
      } else if (terms.length) {
        const all = available.flatMap((rel) => {
          const text = readDoc(resolveInside(ws.root, rel).abs);
          return text ? splitSections(rel, text) : [];
        });
        picked = all
          .map((s) => ({ s, score: scoreSection(s, terms) }))
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .map((x) => x.s);
      } else {
        const readme = available.find((p) => /^readme/i.test(p));
        const text = readme ? readDoc(resolveInside(ws.root, readme).abs) : null;
        picked = readme && text ? splitSections(readme, text).slice(0, 2) : [];
      }

      const contents = fitToBudget(
        picked.map((s) => s.content),
        budget,
      );
      const sections = picked.map((s, i) => ({ path: s.path, heading: s.heading, content: contents[i]! }));
      const data = { workspace: ws.name, sections, available_docs: available.slice(0, 100) };
      const summary = sections.length
        ? `Returned ${sections.length} section(s): ${sections.map((s) => `${s.path} › ${s.heading}`).join('; ')}.`
        : `No doc sections matched${topic ? ` "${topic}"` : ''}. ${available.length} doc file(s) available.`;
      return toolResult(summary, data, deps.config.maxOutputChars);
    }),
  );
}
