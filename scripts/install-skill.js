#!/usr/bin/env node
// Postinstall hook: symlink ~/.claude/skills/mindgraph -> this package's
// skills/mindgraph directory, but only when the package is being installed
// globally (npm install -g ...).
//
// Self-heals on every global install: if a previous symlink points at a
// stale path (e.g. a different nvm node version's lib/node_modules), it gets
// repointed at the current install. If a non-symlink already lives at the
// target, we leave it alone — the user has put something there deliberately.

import { execSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function isGlobalInstall() {
  if (process.env.npm_config_global === 'true') return true;
  try {
    const globalRoot = execSync('npm root -g', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return globalRoot.length > 0 && packageRoot.startsWith(globalRoot);
  } catch {
    return false;
  }
}

if (!isGlobalInstall()) {
  // Local dev install or transitive dependency — don't touch ~/.claude.
  process.exit(0);
}

const skillsDir = join(os.homedir(), '.claude', 'skills');
const targetLink = join(skillsDir, 'mindgraph');
const skillSource = join(packageRoot, 'skills', 'mindgraph');

if (!existsSync(skillSource)) {
  console.error(
    `[mindgraph postinstall] skill source missing at ${skillSource} — nothing to link.`,
  );
  process.exit(0);
}

mkdirSync(skillsDir, { recursive: true });

if (existsSync(targetLink)) {
  const stat = lstatSync(targetLink);
  if (!stat.isSymbolicLink()) {
    console.error(
      `[mindgraph postinstall] ${targetLink} exists and is not a symlink — leaving it alone.\n` +
        `                        Remove or rename it manually if you want the skill auto-linked.`,
    );
    process.exit(0);
  }
  const current = readlinkSync(targetLink);
  if (current === skillSource) {
    // Already correct — nothing to do.
    process.exit(0);
  }
  rmSync(targetLink);
}

symlinkSync(skillSource, targetLink, 'dir');
console.log(`[mindgraph postinstall] linked ${targetLink} -> ${skillSource}`);
