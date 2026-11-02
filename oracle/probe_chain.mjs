// Every Applesoft program on the disk, detokenised, and what each one RUNs next.
//
// Space Vikings was 23 chained programs and the chain was the map of the whole game: what
// loads what is what the game *is*. This reads them off the disk rather than out of a
// running machine, so a branch nobody manages to trigger is still listed.
//
// The chain is found by looking for the DOS commands in PRINT strings - Ctrl-D then RUN,
// LOAD, BLOAD, BRUN or CHAIN - which is how an Applesoft program talks to DOS 3.3.
import { openDisk, DISK, asMemory } from './dsk.mjs';
import { listProgram } from './detokenise.mjs';
import fs from 'fs';

const d = openDisk(DISK);
fs.mkdirSync('captured/chain', { recursive: true });
fs.mkdirSync('listing', { recursive: true });

const DOS = /\^D\s*(RUN|LOAD|BLOAD|BRUN|CHAIN|SAVE|BSAVE|OPEN|READ|WRITE|CLOSE|DELETE)\s*([^"]*)/gi;

const programs = [];
for (const f of d.files) {
  if (f.type !== 'APPLESOFT') continue;
  let lines;
  try { lines = listProgram(asMemory(d.read(f)), 0x801); }
  catch (e) { console.log(`${f.name}: UNREADABLE - ${e.message}`); continue; }

  const text = lines.map((l) => `${l.num} ${l.text}`).join('\n');
  fs.writeFileSync(`listing/${f.name.replace(/[^A-Z0-9.]+/gi, '_')}.bas`, text + '\n');

  const calls = [];
  for (const m of text.matchAll(DOS)) calls.push(`${m[1].toUpperCase()} ${m[2].trim()}`.trim());
  programs.push({ name: f.name, lines: lines.length, dos: [...new Set(calls)] });
}

console.log(`${programs.length} Applesoft programs, listed into listing/\n`);
for (const p of programs) {
  console.log(`${p.name.padEnd(20)} ${String(p.lines).padStart(3)} lines`);
  for (const c of p.dos) console.log(`     -> ${c}`);
}
fs.writeFileSync('captured/chain/golden.json', JSON.stringify({ programs }, null, 1) + '\n');
