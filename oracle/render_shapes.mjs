// Draw every A2-3D2 shape, as three orthographic views.
//
// This is the proof that the format in shapes.mjs is read correctly. A parser can satisfy
// every structural check in probe_shapes.mjs - terminators in the right places, opcodes in
// range, coordinates small - and still be slicing the bytes wrongly. What it cannot do is
// come out looking like a spaceship by accident.
//
// Three views rather than one perspective, because a wireframe drawn from a single angle
// hides exactly the mistakes worth catching: front (X right, Y down), top (X right, Z
// down) and side (Z right, Y down).
import { parseScene, OPS } from './shapes.mjs';
import { toPng } from './hgr.mjs';
import fs from 'fs';

const PANEL = 150, PAD = 8, GAP = 6;
const W = PANEL * 3 + GAP * 2, H = PANEL;

/** A 1-bit canvas with a line drawer, because that is all this needs. */
function canvas(w, h) {
  const px = new Uint8Array(w * h);
  const plot = (x, y) => {
    x = Math.round(x); y = Math.round(y);
    if (x >= 0 && x < w && y >= 0 && y < h) px[y * w + x] = 1;
  };
  // Bresenham, the same shape of line the Apple drew.
  const line = (x0, y0, x1, y1) => {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      plot(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };
  return { px, plot, line };
}

const VIEWS = [
  { name: 'front', h: (c) => c.x, v: (c) => c.y },
  { name: 'top', h: (c) => c.x, v: (c) => c.z },
  { name: 'side', h: (c) => c.z, v: (c) => c.y },
];

function renderShape(shape) {
  const pts = shape.commands.filter((c) => c.op !== 18);
  const c = canvas(W, H);
  if (!pts.length) return c.px;

  // One scale for all three panels, so the views stay comparable to each other.
  const all = pts.flatMap((p) => [p.x, p.y, p.z]);
  const extent = Math.max(1, ...all.map(Math.abs));
  const k = (PANEL / 2 - PAD) / extent;

  VIEWS.forEach((view, i) => {
    const ox = i * (PANEL + GAP) + PANEL / 2, oy = PANEL / 2;
    const sx = (p) => ox + view.h(p) * k, sy = (p) => oy + view.v(p) * k;
    let pen = null;
    for (const cmd of shape.commands) {
      if (cmd.op === 18) continue;
      if (cmd.op === 2 && pen) c.line(sx(pen), sy(pen), sx(cmd), sy(cmd));
      else if (cmd.op === 0) { c.plot(sx(cmd), sy(cmd)); c.plot(sx(cmd) + 1, sy(cmd)); }
      pen = cmd;
    }
    // A frame, so an empty panel reads as empty rather than as a missing file.
    for (let x = 0; x < PANEL; x++) { c.plot(i * (PANEL + GAP) + x, 0); c.plot(i * (PANEL + GAP) + x, H - 1); }
    for (let y = 0; y < H; y++) { c.plot(i * (PANEL + GAP), y); c.plot(i * (PANEL + GAP) + PANEL - 1, y); }
  });
  return c.px;
}

const SCENES = [['SV DATA', 'MAIN DATA'], ['SV DATA2', 'BASE STAR DATA']];
for (const [cfgName, shapeName] of SCENES) {
  const dir = `captured/shapes/${shapeName.replace(/ /g, '_')}`;
  fs.mkdirSync(dir, { recursive: true });
  const shapes = parseScene(cfgName, shapeName);
  for (const s of shapes) {
    if (!s.ok) continue;
    const pts = s.commands.filter((c) => c.op !== 18);
    const kinds = s.commands.reduce((m, c) => (m[OPS[c.op]] = (m[OPS[c.op]] || 0) + 1, m), {});
    fs.writeFileSync(`${dir}/${String(s.record).padStart(2, '0')}.png`,
      toPng(renderShape(s), { scale: 1, w: W, h: H }));
    console.log(`  ${shapeName} ${String(s.record).padStart(2)}  ${String(pts.length).padStart(3)} pts  `
      + Object.entries(kinds).map(([a, b]) => `${a}:${b}`).join(' '));
  }
  console.log(`-> ${dir}/  (front | top | side)\n`);
}
