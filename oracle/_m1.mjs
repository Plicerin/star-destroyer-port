import { openOracle } from './a2.mjs';
import { toFlight, arm, callSub } from './exercise.mjs';
const a2 = await openOracle();
await toFlight(a2); await arm(a2);
const s16=(v)=>v>32767?v-65536:v;
console.log('angle   $61C8 (labelled COS)   $61CB (labelled SIN)');
for (const a of [0,16,32,48,64,96,128,192]) {
  const c = await callSub(a2, 0x61C8, { a });
  const s = await callSub(a2, 0x61CB, { a });
  const cv = s16(c.a | (c.x<<8)), sv = s16(s.a | (s.x<<8));
  console.log(`  ${String(a).padStart(3)}   ${String(cv).padStart(7)} (${(cv/32768).toFixed(4)})   ${String(sv).padStart(7)} (${(sv/32768).toFixed(4)})`
    + `    true sin=${Math.sin(a/256*2*Math.PI).toFixed(4)} cos=${Math.cos(a/256*2*Math.PI).toFixed(4)}`);
}
