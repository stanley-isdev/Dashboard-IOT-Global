// Fails the build if an em dash (U+2014) appears anywhere in the project.
//
// Why a script and not a code-review habit: the character is invisible in a
// diff at a glance, it is what most editors and most language models emit when
// a sentence wants a pause, and by the time anyone noticed there were 816 of
// them across 97 files. A rule nobody can see is not a rule, so this makes the
// build the thing that sees it.
//
// The replacement is a plain hyphen-minus (U+002D), in interface copy and in
// source comments alike. In the interface it is also the no-data marker: the
// cell for a base with no gateway prints "-" rather than a blank, because a
// blank cell reads as a rendering fault and a dash reads as "asked, no answer".
//
// The en dash (U+2013) is NOT flagged. It is used, and correctly: numeric spans
// such as "08:00-09:00" and the tier bands in domain/tier.ts. Only U+2014 is
// banned.
//
// Run: npm run check:nodash
import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// Built by codepoint on purpose: written literally, this file would report
// itself on every run.
const EM_DASH = String.fromCodePoint(0x2014);

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '.vite']);
const SKIP_FILES = new Set(['package-lock.json']);

// Anything not on this list is assumed binary and skipped. Fonts and the
// Natural Earth geometry are the bulk of the tree by bytes.
const TEXTUAL =
  /\.(m?[jt]sx?|css|html|json|md|mjs|cjs|svg|txt|yml|yaml|example|gitignore|gitattributes)$/i;

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...(await walk(join(dir, entry.name))));
    } else if (!SKIP_FILES.has(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

const hits = [];
for (const file of await walk(root)) {
  if (!TEXTUAL.test(file) && !/^\.[a-z]+$/i.test(relative(root, file))) continue;
  if ((await stat(file)).size > 4_000_000) continue;
  const text = await readFile(file, 'utf8');
  if (!text.includes(EM_DASH)) continue;
  text.split('\n').forEach((line, i) => {
    if (line.includes(EM_DASH)) {
      hits.push({ file: relative(root, file).replace(/\\/g, '/'), line: i + 1, text: line.trim() });
    }
  });
}

if (hits.length === 0) {
  console.log('No em dash (U+2014) anywhere in the project.');
  process.exit(0);
}

console.error(`Em dash (U+2014) found in ${hits.length} place(s). Use a hyphen "-" instead.\n`);
for (const h of hits.slice(0, 40)) {
  console.error(`  ${h.file}:${h.line}  ${h.text.slice(0, 100)}`);
}
if (hits.length > 40) console.error(`  ... and ${hits.length - 40} more`);
process.exit(1);
