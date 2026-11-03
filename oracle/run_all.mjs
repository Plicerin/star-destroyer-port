// Every harness, in order, with a verdict at the end.
//
// This had been an ad-hoc shell loop retyped a dozen times. It is a file now, because the
// suite is what the port's claim to be the disk rests on and it takes twenty minutes: it
// should be the same twenty minutes every time, and it should say plainly what failed.
//
//   node run_all.mjs            everything
//   node run_all.mjs renderer   only the probes whose name contains "renderer"
//
// Exit code is the number of harnesses that failed, so CI or a shell can test it.
//
// This file came over from the Space Vikings oracle, where the harnesses are named
// `*_parity.mjs` and `*_check.mjs`. Nothing in this project is called that - they are
// `probe_*.mjs` - so for its whole life here it matched no files, printed "nothing
// matches" and exited 0. A suite runner that passes because it found nothing to run is
// worse than none, since it reports success.
import { spawn } from 'child_process';
import fs from 'fs';

const filter = process.argv[2] || '';
// Two kinds of harness. A probe establishes what the original disk does; a parity
// harness holds the port to it. Both have to pass, and they run in that order because a
// parity failure means nothing if the probe it rests on is also failing.
const probes = fs.readdirSync('.').filter((f) => f.startsWith('probe_') && f.endsWith('.mjs')).sort();
const parity = fs.readdirSync('.').filter((f) => f.startsWith('parity_') && f.endsWith('.mjs')).sort();
const all = [...probes, ...parity];
if (!probes.length) {
  console.log('no probe_*.mjs here - refusing to report success on an empty suite');
  process.exit(1);
}
const files = all.filter((f) => !filter || f.includes(filter));
if (!files.length) {
  console.log(`nothing matches "${filter}" among ${all.length} probes`);
  process.exit(1);
}

const run = (file) => new Promise((resolve) => {
  const started = Date.now();
  const child = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'pipe'] });
  let tail = '';
  const keep = (buf) => { tail = (tail + buf.toString()).slice(-4000); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.on('close', (code) => resolve({ file, code, seconds: (Date.now() - started) / 1000, tail }));
});

console.log(`${files.length} harnesses (${files.filter((f) => f.startsWith('probe_')).length} probes, `
  + `${files.filter((f) => f.startsWith('parity_')).length} parity)`);
console.log('');
const failed = [];
for (const file of files) {
  process.stdout.write(`  ${file.padEnd(26)} `);
  const r = await run(file);
  console.log(`${r.code === 0 ? 'pass' : 'FAIL'}  ${r.seconds.toFixed(0)}s`);
  if (r.code !== 0) failed.push(r);
}

console.log('');
if (!failed.length) {
  console.log(`all ${files.length} passed`);
} else {
  console.log(`${failed.length} of ${files.length} failed:`);
  for (const f of failed) {
    console.log('');
    console.log(`--- ${f.file} ---`);
    console.log(f.tail.split('\n').slice(-14).join('\n'));
  }
}
process.exit(failed.length);
