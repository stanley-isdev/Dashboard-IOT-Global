// Fails the build if the stylesheets read a custom property nobody defines.
//
// Why a script and not a code-review habit: `var(--ink)` where the token is
// `--text` is not a syntax error and no tool in the pipeline objected. It is
// "invalid at computed-value time", which for an inherited property means the
// declaration silently becomes `inherit` - so the element takes its parent's
// value and the page still renders. That is the worst possible failure mode: it
// looks deliberate, and it looks fine for exactly as long as the inherited
// value happens to be close to the intended one.
//
// It cost a real bug. The display-zone `<option>` rule asked for `var(--ink)`,
// inherited the closed select's colour instead, and read as correct for a week
// because that colour was dark on a white list. The day the selected half of
// the control started filling orange with near-white type, the open list became
// white on white and every zone in it vanished - reported as "why is the
// dropdown empty", with nothing in the CSS that looked wrong.
//
// typecheck cannot see CSS, eslint does not read it, and the contrast checker
// only knows the pairs it is handed. So this is the thing that sees it.
//
// A `var()` WITH a fallback is not reported: `var(--x, 1rem)` is how a
// stylesheet says "this may be absent", which is a decision rather than a typo.
// Custom properties set from TSX (`style={{ '--brand-logo-on-light': ... }}`)
// count as defined - the elements that read them are styled from a stylesheet
// but fed from a component.
//
// Run: npm run check:tokens
import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '.vite', '.scratch']);

/** Where a token may be DEFINED: stylesheets, plus components that set one inline. */
const DEFINES = /\.(css|tsx?)$/i;
/** Where a token may be READ in a way this script judges. */
const READS = /\.css$/i;

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...(await walk(join(dir, entry.name))));
    } else {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/*
 * Comments are stripped before either pass.
 *
 * Not fussiness: this project's stylesheets carry long block comments that
 * discuss tokens by name - including the ones that were REMOVED and the wrong
 * spellings that caused bugs, which is exactly the prose worth keeping. Reading
 * `var(--ink)` out of the note explaining why `var(--ink)` was wrong would make
 * the check fail on its own documentation.
 */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ');

const files = await walk(root).catch(() => []);

const defined = new Set();
const read = new Map(); // name -> [{ file, line }]

for (const file of files) {
  if (!DEFINES.test(file)) continue;
  if (!(await stat(file)).isFile()) continue;
  const raw = await readFile(file, 'utf8');
  const src = stripComments(raw);

  // `--name:` in a declaration block, and `'--name':` set from a component.
  for (const m of src.matchAll(/(?:^|[;{\s('"])(--[a-zA-Z0-9-]+)\s*['"]?\s*:/g)) {
    defined.add(m[1]);
  }

  if (!READS.test(file)) continue;
  // `var(--name)` with no fallback: the closing paren has to follow the name.
  const lines = src.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*\)/g)) {
      const at = read.get(m[1]) ?? [];
      at.push({ file: relative(root, file), line: i + 1 });
      read.set(m[1], at);
    }
  });
}

const missing = [...read.entries()].filter(([name]) => !defined.has(name));

if (missing.length === 0) {
  const names = read.size;
  console.log(`Every custom property read by the stylesheets is defined (${names} distinct).`);
  process.exit(0);
}

const places = missing.reduce((n, [, at]) => n + at.length, 0);
console.error(
  `Undefined custom propert${missing.length === 1 ? 'y' : 'ies'} read in ` +
    `${places} place(s). A var() on an undefined token is not an error - it ` +
    `computes to 'inherit' and the page keeps rendering, wrong.\n`,
);
for (const [name, at] of missing.sort((a, b) => a[0].localeCompare(b[0]))) {
  console.error(`  ${name}`);
  for (const { file, line } of at) console.error(`      ${file}:${line}`);
}
console.error(
  `\nEither define the token in src/theme/tokens.css, correct the spelling, or ` +
    `give the var() an explicit fallback - var(${missing[0][0]}, <value>) - which ` +
    `is how a stylesheet says the absence is intended.`,
);
process.exit(1);
