import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../skills/mindgraph/SKILL.md',
);

export function readSkill() {
  try { return readFileSync(SKILL_PATH, 'utf8'); }
  catch { return 'You digest source material into a navigable source-first concept graph.'; }
}

export async function loadSdk() {
  try {
    const mod = await import('@anthropic-ai/claude-agent-sdk');
    return mod;
  } catch {
    throw new Error('Agent SDK not installed. Run: npm install @anthropic-ai/claude-agent-sdk');
  }
}
