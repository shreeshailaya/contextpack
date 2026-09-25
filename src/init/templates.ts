/** Relative paths written by `contextpack init`. */
export const CURSOR_RULE_REL = ".cursor/rules/contextpack.mdc";
export const SKILL_REL = "skills/contextpack/SKILL.md";
export const AGENTS_REL = "AGENTS.md";

export const AGENTS_SECTION_START = "<!-- contextpack-agent-setup -->";
export const AGENTS_SECTION_END = "<!-- /contextpack-agent-setup -->";

export const PREFERRED_INVOKE =
  "npx -p @shree_vitkar/contextpack contextpack pack . --budget 8000";
export const PR_REVIEW_RECIPE = "contextpack pack . --since main --diff --budget 12000";
export const SEARCH_RECIPE =
  "rg -l '…' | contextpack pack . --paths-from - --budget 8000";

const FLAG_LIST = `Key flags (do not invent others):
- \`--list\` — preview which files would be included (dry-run)
- \`--since <ref>\` — only files changed since a git ref
- \`--diff\` — pack unified diffs of those changes (requires \`--since\`)
- \`--paths-from -\` — pack only paths from stdin (no tree walk)
- \`--format json\` — structured output for tooling
- \`-o <file>\` — write the digest to a file
- \`--no-redact\` — disable best-effort secret redaction (default on; not a scanner)

Token counts are estimates (characters / 4), not a model tokenizer.`;

const RECIPES = `Preferred:

\`\`\`bash
${PREFERRED_INVOKE}
\`\`\`

PR review (patches since main):

\`\`\`bash
${PR_REVIEW_RECIPE}
\`\`\`

Search-scoped (files you already found):

\`\`\`bash
${SEARCH_RECIPE}
\`\`\``;

export const CURSOR_RULE = `---
description: Use contextpack when you need a token-budgeted digest of this repo before a large refactor, PR review, or orientation. Do not invent CLI flags.
alwaysApply: false
---

# contextpack

Package: \`@shree_vitkar/contextpack\`. Bin: \`contextpack\`.

Use this when an agent needs codebase context without dumping the whole tree.

${RECIPES}

${FLAG_LIST}
`;

export const SKILL = `---
name: contextpack
description: Use this when you need a token-budgeted digest of a codebase before a large refactor, PR review, or orientation. Packs files under a budget instead of dumping the repo.
---

# contextpack

Package: \`@shree_vitkar/contextpack\`. Bin: \`contextpack\`.

## Steps

1. Decide the scope: whole repo, a subdirectory, files changed since a git ref, or an explicit path list.
2. Preview with \`--list\` if the budget is tight.
3. Pack with one of the recipes below. Write to a file with \`-o\` when you want to reread the digest.

${RECIPES}

${FLAG_LIST}

Install / run without a global install:

\`\`\`bash
${PREFERRED_INVOKE}
\`\`\`
`;

export const AGENTS_SECTION = `${AGENTS_SECTION_START}
## contextpack

Pack this repo into a token-budgeted digest before large refactors, PR review, or orientation.

\`\`\`bash
${PREFERRED_INVOKE}
\`\`\`

- PR review: \`${PR_REVIEW_RECIPE}\`
- Search-scoped: \`${SEARCH_RECIPE}\`

Useful flags: \`--list\`, \`--since\`, \`--diff\`, \`--paths-from -\`, \`--format json\`, \`-o\`, \`--no-redact\`. Token counts are estimates (chars/4). Secret redaction is best-effort, not a scanner.
${AGENTS_SECTION_END}
`;

export const AGENTS_FILE_HEADER = `# Agent instructions

`;
