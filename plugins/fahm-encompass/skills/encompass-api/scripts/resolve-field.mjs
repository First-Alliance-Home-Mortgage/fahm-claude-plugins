#!/usr/bin/env node
/**
 * resolve-field.mjs — offline Encompass field-ID lookup.
 *
 * Resolves a canonical field id (Fields.1997, Loan.LoanFolder) or a friendly
 * property name (loanStatus, underwriterName) against references/field-ids.md,
 * and prints any correction recorded for it.
 *
 * No network, no credentials, no environment. Exists so that "look up the field
 * before writing the filter" costs one command.
 *
 *   node resolve-field.mjs Fields.1997
 *   node resolve-field.mjs underwriterName
 *   node resolve-field.mjs --list
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REF = join(dirname(fileURLToPath(import.meta.url)), '..', 'references', 'field-ids.md');

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

let doc;
try {
  doc = readFileSync(REF, 'utf8');
} catch {
  die(`Cannot read ${REF}. The reference must sit alongside this script.`, 2);
}

/**
 * Parse every three-column markdown table row in the document.
 * Field tables are `| canonical | property | note |`; the corrections table is
 * `| field | what it actually is |` (two columns) and is collected separately.
 */
function parseTables(text) {
  const fields = [];
  const corrections = new Map();
  let inCorrections = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();

    if (line.startsWith('#')) {
      inCorrections = /corrections/i.test(line);
      continue;
    }
    if (!line.startsWith('|')) continue;

    const cells = line.slice(1, line.endsWith('|') ? -1 : undefined).split('|').map((c) => c.trim());
    if (cells.length < 2) continue;
    if (cells.every((c) => /^-{2,}$/.test(c.replace(/:/g, '')))) continue; // separator row

    const key = cells[0].replace(/`/g, '').trim();
    if (!/^(Fields\.|Loan\.)/.test(key)) continue; // skips header rows too

    if (inCorrections) {
      // `Fields.2` vs `Fields.1109` — one row, two subjects.
      for (const k of key.split(/\s+vs\s+/).map((s) => s.replace(/`/g, '').trim())) {
        corrections.set(k, cells[1]);
      }
    } else if (cells.length >= 3) {
      fields.push({ canonical: key, property: cells[1].replace(/`/g, '').trim(), note: cells[2] });
    }
  }
  return { fields, corrections };
}

const { fields, corrections } = parseTables(doc);
if (fields.length === 0) die('Parsed zero fields from field-ids.md — the table shape changed.', 2);

const args = process.argv.slice(2);

if (args.includes('--list')) {
  for (const f of fields) console.log(`${f.canonical.padEnd(30)} ${f.property}`);
  console.log(`\n${fields.length} entries.`);
  process.exit(0);
}

const query = args[0];
if (!query || query.startsWith('-')) {
  die('usage: resolve-field.mjs <Fields.NNNN | propertyName> | --list');
}

const q = query.toLowerCase();
const exact = fields.filter((f) => f.canonical.toLowerCase() === q || f.property.toLowerCase() === q);
const matches = exact.length
  ? exact
  : fields.filter((f) => f.canonical.toLowerCase().includes(q) || f.property.toLowerCase().includes(q));

if (matches.length === 0) {
  console.log(`No match for "${query}".`);
  console.log('Try --list, or grep references/field-ids.md directly.');
  process.exit(1);
}

for (const m of matches) {
  console.log(`\n  ${m.canonical}  →  ${m.property}`);
  if (m.note) console.log(`  ${m.note}`);
  const c = corrections.get(m.canonical);
  if (c) console.log(`\n  ⚠ CORRECTION: ${c}`);
}

// Several canonical ids intentionally map to one property (fallback chains).
// Surface that, because insertion order decides which one wins.
const byProperty = new Map();
for (const m of matches) {
  const siblings = fields.filter((f) => f.property === m.property);
  if (siblings.length > 1) byProperty.set(m.property, siblings);
}
for (const [prop, siblings] of byProperty) {
  console.log(`\n  "${prop}" is written by ${siblings.length} fields, in this order:`);
  siblings.forEach((s, i) => {
    const role = i === siblings.length - 1 ? 'wins when populated' : 'fallback';
    console.log(`    ${i + 1}. ${s.canonical.padEnd(22)} ${role}`);
  });
  console.log('  The LATER entry overwrites the earlier one. Reordering is a data-corruption bug.');
}

console.log('');
