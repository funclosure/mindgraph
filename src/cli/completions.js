// ---------------------------------------------------------------------------
// Shell completion — declarative CLI command tree + zsh script generator.
//
// The tree mirrors the dispatch branches in src/cli/index.js; when a command
// is added there, add it here so `mindgraph completions zsh` stays in sync.
// `arg` names the kind of first positional argument a (sub)command takes:
//   'doc'   → *.mindgraph.json          (runtime documents)
//   'graph' → *.mindgraph.(json|md)     (anything the reader UI can load)
//   'md'    → *.mindgraph.md            (authoring markdown)
//   'file'  → any file
// ---------------------------------------------------------------------------

export const COMMAND_TREE = [
  { name: 'gallery', summary: 'List the bundled sample graphs' },
  { name: 'author', summary: 'Digest a source into a finished graph with an LLM agent', arg: 'file' },
  { name: 'init', summary: 'Create an empty starter mindgraph document', arg: 'file' },
  { name: 'validate', summary: 'Validate a mindgraph JSON document', arg: 'doc' },
  { name: 'inspect', summary: 'Print a concise summary of a document', arg: 'doc' },
  {
    name: 'authoring',
    summary: 'Source-first Markdown authoring pipeline',
    sub: [
      { name: 'validate', summary: 'Validate authoring Markdown', arg: 'md' },
      { name: 'compile', summary: 'Compile authoring Markdown to runtime JSON', arg: 'md' },
      { name: 'draft', summary: 'Draft editable Markdown from plain text', arg: 'file' },
      { name: 'qa', summary: 'Check focus concepts bind to source phrasing', arg: 'md' },
    ],
  },
  {
    name: 'source',
    summary: 'Source preparation',
    sub: [{ name: 'import', summary: 'Prepare a file or web article for ingestion', arg: 'file' }],
  },
  {
    name: 'digest',
    summary: 'Source→document digestion and digest plans',
    arg: 'file',
    sub: [
      { name: 'apply', summary: 'Apply a batch digest plan', arg: 'doc' },
      { name: 'evaluate', summary: 'Report digest quality signals', arg: 'doc' },
    ],
  },
  { name: 'mcp', summary: 'Start the mindgraph MCP server over stdio' },
  {
    name: 'ingest',
    summary: 'Transcript ingestion',
    sub: [{ name: 'transcript', summary: 'Parse a transcript into a starter document', arg: 'file' }],
  },
  {
    name: 'build',
    summary: 'Staged build pipelines',
    sub: [{ name: 'timeline', summary: 'Transcript→timeline pipeline', arg: 'file' }],
  },
  {
    name: 'concept',
    summary: 'Concept operations',
    sub: [
      { name: 'upsert', summary: 'Create or update a concept', arg: 'doc' },
      { name: 'list', summary: 'List concepts', arg: 'doc' },
      { name: 'show', summary: 'Show one concept', arg: 'doc' },
    ],
  },
  {
    name: 'relation',
    summary: 'Relation operations',
    sub: [{ name: 'upsert', summary: 'Create or update a relation', arg: 'doc' }],
  },
  {
    name: 'frame',
    summary: 'Frame operations',
    sub: [
      { name: 'list', summary: 'List frames', arg: 'doc' },
      { name: 'show', summary: 'Show one frame', arg: 'doc' },
      { name: 'set-activations', summary: 'Write weighted activations to a frame', arg: 'doc' },
      { name: 'merge', summary: 'Merge frames into a coarser frame', arg: 'doc' },
      { name: 'backfill-activations', summary: 'Broadcast coarse activations onto finer frames', arg: 'doc' },
    ],
  },
  {
    name: 'stats',
    summary: 'Document statistics',
    sub: [{ name: 'recompute', summary: 'Recompute concept stats', arg: 'doc' }],
  },
  { name: 'view', summary: 'Open the read-only reading UI', arg: 'graph' },
  { name: 'open', summary: 'Launch the live UI with the Ask agent', arg: 'graph' },
  {
    name: 'completions',
    summary: 'Print a shell completion script',
    sub: [{ name: 'zsh', summary: 'zsh completion script' }],
  },
];

const ARG_GLOBS = {
  doc: '*.mindgraph.json',
  graph: '*.mindgraph.(json|md)',
  md: '*.mindgraph.md',
};

function describeLines(entries, indent) {
  return entries
    .map((entry) => `${indent}'${entry.name}:${(entry.summary ?? '').replace(/'/g, '')}'`)
    .join('\n');
}

function fileAction(arg, indent) {
  if (!arg) return `${indent}return`;
  if (arg === 'graph') {
    // `open` resolves name fragments against ./graphs, so list those
    // documents directly (from any directory that has a graphs/ folder)
    // alongside ordinary path completion.
    return (
      `${indent}local -a graph_docs\n` +
      `${indent}graph_docs=( graphs/*.mindgraph.(json|md)(N) )\n` +
      `${indent}if (( \${#graph_docs} )); then\n` +
      `${indent}  _alternative \\\n` +
      `${indent}    'graphs:mindgraph document under ./graphs:compadd -f -a graph_docs' \\\n` +
      `${indent}    'files:file:_files -g "${ARG_GLOBS.graph}"'\n` +
      `${indent}else\n` +
      `${indent}  _files -g "${ARG_GLOBS.graph}"\n` +
      `${indent}fi`
    );
  }
  const glob = ARG_GLOBS[arg];
  return glob ? `${indent}_files -g "${glob}"` : `${indent}_files`;
}

// Group commands that share the same argument kind into one case branch,
// e.g. `open|view) _files -g "*.mindgraph.(json|md)" ;;`.
function topLevelCaseBranches() {
  const groups = new Map();
  for (const command of COMMAND_TREE) {
    if (command.sub) continue;
    const key = command.arg ?? '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(command.name);
  }
  const branches = [];
  for (const [arg, names] of groups) {
    if (!arg) continue;
    branches.push(`    ${names.join('|')})\n${fileAction(arg, '      ')}\n      ;;`);
  }
  return branches.join('\n');
}

function nestedCaseBranches() {
  const branches = [];
  for (const command of COMMAND_TREE) {
    if (!command.sub) continue;
    const subDescribe = describeLines(command.sub, '          ');
    const argGroups = new Map();
    for (const sub of command.sub) {
      const key = sub.arg ?? '';
      if (!key) continue;
      if (!argGroups.has(key)) argGroups.set(key, []);
      argGroups.get(key).push(sub.name);
    }
    const subArgCases = [...argGroups]
      .map(([arg, names]) => `          ${names.join('|')})\n${fileAction(arg, '            ')}\n            ;;`)
      .join('\n');
    // Commands like `digest` take a direct argument OR a subcommand: offer both.
    const directAction = command.arg ? `\n        _files\n` : '\n';
    branches.push(
      `    ${command.name})\n` +
      `      if (( CURRENT == 3 )); then\n` +
      `        subcmds=(\n${subDescribe}\n        )\n` +
      `        _describe -t commands 'mindgraph ${command.name} command' subcmds${directAction}` +
      `      else\n` +
      `        case "$words[3]" in\n${subArgCases || '          *) ;;'}\n        esac\n` +
      `      fi\n` +
      `      ;;`,
    );
  }
  return branches.join('\n');
}

export function buildZshCompletion() {
  return `#compdef mindgraph
# Generated by \`mindgraph completions zsh\` — regenerate after CLI upgrades.

_mindgraph() {
  local -a subcmds
  if (( CURRENT == 2 )); then
    subcmds=(
${describeLines(COMMAND_TREE, '      ')}
    )
    _describe -t commands 'mindgraph command' subcmds
    return
  fi

  case "$words[2]" in
${nestedCaseBranches()}
${topLevelCaseBranches()}
    *)
      _files
      ;;
  esac
}

_mindgraph "$@"
`;
}
