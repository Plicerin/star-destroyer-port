// The A2-3D2 shape format, tested. See shapes.mjs for how the format was arrived at.
import { parseScene, OPS } from './shapes.mjs';
import fs from 'fs';

const results = [];
const check = (what, ok, detail = '') => {
  results.push({ what, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? '   ' + detail : ''}`);
};
const hex = (n) => '$' + n.toString(16).toUpperCase().padStart(4, '0');
const out = {};

// The two scenes whose configuration block ships alongside their own shapes.
for (const [cfgName, shapeName] of [['SV DATA', 'MAIN DATA'], ['SV DATA2', 'BASE STAR DATA']]) {
  const shapes = parseScene(cfgName, shapeName);
  out[shapeName] = shapes;
  const cmds = shapes.flatMap((s) => s.commands);
  const coords = cmds.filter((c) => c.op !== 18).flatMap((c) => [c.x, c.y, c.z]);
  const opsSeen = [...new Set(cmds.map((c) => c.op))].sort((a, b) => a - b);

  console.log(`\n=== ${shapeName} (pointers from ${cfgName}) ===`);
  console.log(`  ${shapes.length} shapes, ${cmds.length} commands, `
    + `opcodes ${opsSeen.map((o) => `${o}=${OPS[o]}`).join(' ')}`);

  check(`${shapeName}: all 24 shapes parse to a terminator`,
    shapes.every((s) => s.ok), `${shapes.filter((s) => s.ok).length}/24`);
  check(`${shapeName}: no opcode outside 0,1,2,3,18`,
    opsSeen.every((o) => o <= 3 || o === 18), opsSeen.join(','));
  check(`${shapeName}: coordinates are model-sized`,
    coords.every((v) => v >= -400 && v <= 400), `${Math.min(...coords)} to ${Math.max(...coords)}`);
  check(`${shapeName}: the COLOUR operand is a hi-res colour, 0-7`,
    cmds.filter((c) => c.op === 18).every((c) => c.colour <= 7),
    'values ' + [...new Set(cmds.filter((c) => c.op === 18).map((c) => c.colour))].sort().join(','));
  check(`${shapeName}: no shape opens with a DRAW`,
    shapes.every((s) => !s.commands.length || s.commands[0].op !== 2), '');
  check(`${shapeName}: every DRAW has somewhere to draw from`,
    shapes.every((s) => {
      let pen = false;
      for (const c of s.commands) {
        if (c.op === 0 || c.op === 1 || c.op === 3) pen = true;
        if (c.op === 2 && !pen) return false;
      }
      return true;
    }), '');
}

// The control. STARBASE MAIN DATA holds different shapes behind SV DATA's pointers, so
// most of those pointers are stale for it. If everything here parsed, the parser would be
// accepting anything and none of the checks above would mean a thing.
{
  const shapes = parseScene('SV DATA', 'STARBASE MAIN DATA');
  out['STARBASE MAIN DATA'] = shapes;
  const on = [0, 6], off = [1, 2, 3];
  console.log('\n=== STARBASE MAIN DATA: the control ===');
  for (const r of [...on, ...off]) {
    const s = shapes[r];
    console.log(`  record ${r} -> ${hex(s.ptr)}  ${s.ok ? 'parses' : 'de-syncs'}  `
      + `${s.commands.length} cmds${s.ok ? '' : '   ' + s.why}`);
  }
  check('the records STARBASE switches on parse clean',
    on.every((r) => shapes[r].ok), 'records 0 and 6');
  check('and the stale ones do not - so the parser can still fail',
    off.some((r) => !shapes[r].ok),
    `records ${off.filter((r) => !shapes[r].ok).join(', ')} de-sync, as they should`);
}

console.log('\n=== MAIN DATA, shape by shape ===');
for (const s of out['MAIN DATA']) {
  const k = s.commands.reduce((m, c) => (m[OPS[c.op]] = (m[OPS[c.op]] || 0) + 1, m), {});
  const v = s.commands.filter((c) => c.op !== 18);
  const sp = (f) => (v.length ? `${Math.min(...v.map(f))}..${Math.max(...v.map(f))}` : '-');
  console.log(`  ${String(s.record).padStart(2)}  ${hex(s.ptr)}  ${String(v.length).padStart(3)} pts  `
    + Object.entries(k).map(([a, b]) => `${a}:${b}`).join(' ').padEnd(30)
    + `x ${sp((c) => c.x).padEnd(11)} y ${sp((c) => c.y).padEnd(11)} z ${sp((c) => c.z)}`);
}

fs.mkdirSync('captured/shapes', { recursive: true });
fs.writeFileSync('captured/shapes/golden.json', JSON.stringify({ shapes: out, results }, null, 1) + '\n');
const failed = results.filter((r) => !r.ok).length;
console.log('');
console.log(failed === 0 ? `shapes: all ${results.length} checks passed`
  : `shapes: ${failed} of ${results.length} failed`);
process.exit(failed === 0 ? 0 : 1);
