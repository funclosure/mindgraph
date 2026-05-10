#!/usr/bin/env node
// Postinstall hook: symlink ~/.claude/skills/mindgraph -> the installed
// package's skills/mindgraph directory, but only when the package is being
// installed globally (npm install -g ...).
//
// Self-heals on every global install: if a previous symlink (including a
// dangling one, e.g. from a different node version's lib/node_modules) lives
// at the target, it gets repointed at the current install. If a non-symlink
// already lives at the target, we leave it alone — the user has put it there
// deliberately.

import { execSync } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const PACKAGE_NAME = 'mindgraph';
const localPackageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function getGlobalRoot() {
  try {
    const root = execSync('npm root -g', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return root || null;
  } catch {
    return null;
  }
}

const globalRoot = getGlobalRoot();
const isGlobalInstall =
  process.env.npm_config_global === 'true' ||
  (globalRoot !== null && localPackageRoot.startsWith(globalRoot));

if (!isGlobalInstall) {
  // Local dev install or transitive dependency — don't touch ~/.claude.
  process.exit(0);
}

if (!globalRoot) {
  console.error(
    '[mindgraph postinstall] could not resolve `npm root -g`; skipping skill link.',
  );
  process.exit(0);
}

// Always point at the *final* install location, not the script's current
// location — npm may run postinstall in a temp staging dir during git+url
// installs, and that path vanishes once npm finalizes the move.
const installedRoot = join(globalRoot, PACKAGE_NAME);
const skillsDir = join(os.homedir(), '.claude', 'skills');
const targetLink = join(skillsDir, PACKAGE_NAME);
const skillSource = join(installedRoot, 'skills', PACKAGE_NAME);

mkdirSync(skillsDir, { recursive: true });

try {
  const stat = lstatSync(targetLink);
  if (!stat.isSymbolicLink()) {
    console.error(
      `[mindgraph postinstall] ${targetLink} exists and is not a symlink — leaving it alone.\n` +
        `                        Remove or rename it manually if you want the skill auto-linked.`,
    );
    process.exit(0);
  }
  if (readlinkSync(targetLink) === skillSource) {
    // Already correct — nothing to do.
    process.exit(0);
  }
  // Symlink exists but points elsewhere (or is dangling). Remove and replace.
  rmSync(targetLink);
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
  // Target doesn't exist — fall through to create.
}

symlinkSync(skillSource, targetLink, 'dir');
console.log(`[mindgraph postinstall] linked ${targetLink} -> ${skillSource}`);
