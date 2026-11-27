// Kuat — simple stick-figure line drawings, drawn as inline SVG (no images, no outside files).
// Each pose lists joint positions on a 160 × 128 canvas (floor at y = 108, figure faces right).
// h head, n neck, p hip, a near arm [elbow x,y, wrist x,y], l near leg [knee x,y, foot x,y].
// a2 / l2 are the far arm and leg (drawn lighter); if left out they copy the near side, nudged.
// s / s2 / hp / hp2 override shoulder and hip points (used for front-facing poses).
// db: where dumbbells are drawn — 'both', 'one' (near hand), 'goblet' (one held in both hands),
// 'hip' (resting on hips) or 'none'. chair: x position of a chair seat.

const STAND = { h: [80, 22], n: [80, 31], p: [80, 63], l: [81, 86, 80, 108], l2: [78, 86, 77, 108] };
const LIE = { h: [26, 96], n: [36, 98], p: [80, 100], l: [100, 80, 112, 108], l2: [102, 82, 114, 108] };

export const POSES = {
  stand: { ...STAND, a: [81, 47, 82, 63], db: 'both' },
  pressRack: { ...STAND, a: [90, 44, 89, 30], db: 'both' },
  pressTop: { ...STAND, a: [84, 17, 83, 3], db: 'both' },
  pressTopOne: { ...STAND, a: [84, 16, 83, 2], db: 'goblet' },
  ohExtDown: { ...STAND, a: [85, 14, 70, 26], db: 'goblet' },
  curlTop: { ...STAND, a: [82, 47, 93, 34], db: 'both' },
  frontRaiseTop: { ...STAND, a: [96, 35, 112, 32], db: 'both' },
  calfTop: { h: [80, 16], n: [80, 25], p: [80, 57], a: [81, 41, 82, 57], l: [81, 80, 82, 102], l2: [78, 80, 79, 102], db: 'both', toes: true },
  suitcase: { ...STAND, a: [81, 47, 82, 63], a2: [80, 47, 80, 62], db: 'one' },
  hinge: { h: [113, 42], n: [104, 46], p: [70, 62], a: [100, 62, 98, 78], l: [76, 86, 76, 108], l2: [73, 86, 73, 108], db: 'both' },
  lunge: { h: [80, 31], n: [80, 40], p: [80, 72], a: [81, 56, 82, 72], l: [98, 88, 98, 108], l2: [66, 102, 50, 106], db: 'both' },
  gobletStand: { ...STAND, a: [87, 48, 88, 38], db: 'goblet' },
  gobletSquat: { h: [87, 43], n: [84, 52], p: [72, 86], a: [92, 70, 93, 58], l: [96, 84, 92, 108], l2: [93, 85, 89, 108], db: 'goblet' },
  squatRack: { h: [87, 43], n: [84, 52], p: [72, 86], a: [96, 64, 94, 50], l: [96, 84, 92, 108], l2: [93, 85, 89, 108], db: 'both' },
  sumoStand: { h: [80, 22], n: [80, 31], p: [80, 63], s: [72, 33], s2: [88, 33], hp: [75, 63], hp2: [85, 63], a: [74, 48, 79, 66], a2: [86, 48, 81, 66], l: [68, 86, 64, 108], l2: [92, 86, 96, 108], db: 'goblet' },
  sumoSquat: { h: [80, 41], n: [80, 50], p: [80, 82], s: [72, 52], s2: [88, 52], hp: [75, 82], hp2: [85, 82], a: [74, 68, 79, 86], a2: [86, 68, 81, 86], l: [60, 86, 62, 108], l2: [100, 86, 98, 108], db: 'goblet' },
  frontStand: { h: [80, 22], n: [80, 31], p: [80, 63], s: [71, 33], s2: [89, 33], hp: [76, 63], hp2: [84, 63], a: [68, 48, 67, 63], a2: [92, 48, 93, 63], l: [75, 86, 74, 108], l2: [85, 86, 86, 108], db: 'both' },
  lateralTop: { h: [80, 22], n: [80, 31], p: [80, 63], s: [71, 33], s2: [89, 33], hp: [76, 63], hp2: [84, 63], a: [56, 34, 42, 36], a2: [104, 34, 118, 36], l: [75, 86, 74, 108], l2: [85, 86, 86, 108], db: 'both' },
  splitTop: { h: [83, 21], n: [82, 30], p: [80, 62], a: [81, 46, 82, 62], l: [86, 85, 86, 108], l2: [64, 80, 48, 80], db: 'both', chair: 20 },
  splitBottom: { h: [81, 37], n: [80, 46], p: [76, 78], a: [79, 62, 80, 78], l: [96, 82, 94, 108], l2: [62, 96, 48, 80], db: 'both', chair: 20 },
  stepStart: { h: [77, 22], n: [76, 31], p: [72, 63], a: [75, 47, 76, 63], l: [92, 54, 100, 80], l2: [72, 86, 72, 108], db: 'both', chair: 90 },
  stepTop: { h: [100, -5], n: [100, 4], p: [100, 36], a: [101, 20, 102, 36], l: [101, 58, 100, 80], l2: [97, 58, 96, 80], db: 'both', chair: 90 },
  rowDown: { h: [121, 55], n: [112, 58], p: [78, 62], s: [112, 60], a2: [116, 70, 118, 79], l: [72, 85, 68, 108], l2: [100, 78, 124, 78], chair: 96, chairR: true, a: [106, 74, 104, 90], db: 'one' },
  rowUp: { h: [121, 55], n: [112, 58], p: [78, 62], s: [112, 60], a2: [116, 70, 118, 79], l: [72, 85, 68, 108], l2: [100, 78, 124, 78], chair: 96, chairR: true, a: [96, 52, 101, 66], db: 'one' },
  kickbackBent: { h: [121, 55], n: [112, 58], p: [78, 62], s: [112, 60], a2: [116, 70, 118, 79], l: [72, 85, 68, 108], l2: [100, 78, 124, 78], chair: 96, chairR: true, a: [96, 58, 96, 74], db: 'one' },
  kickbackStraight: { h: [121, 55], n: [112, 58], p: [78, 62], s: [112, 60], a2: [116, 70, 118, 79], l: [72, 85, 68, 108], l2: [100, 78, 124, 78], chair: 96, chairR: true, a: [96, 58, 80, 60], db: 'one' },
  bentRowDown: { h: [108, 34], n: [100, 40], p: [70, 64], a: [99, 56, 98, 72], l: [78, 86, 76, 108], l2: [75, 86, 73, 108], db: 'both' },
  bentRowUp: { h: [108, 34], n: [100, 40], p: [70, 64], a: [84, 46, 88, 60], l: [78, 86, 76, 108], l2: [75, 86, 73, 108], db: 'both' },
  reverseFlyUp: { h: [108, 34], n: [100, 40], p: [70, 64], a: [96, 46, 102, 46], a2: [92, 38, 96, 32], l: [78, 86, 76, 108], l2: [75, 86, 73, 108], db: 'both' },
  floorPressDown: { ...LIE, a: [44, 106, 46, 90], db: 'both', mat: true },
  floorPressUp: { ...LIE, a: [42, 84, 40, 70], db: 'both', mat: true },
  flyOpen: { ...LIE, a: [46, 104, 56, 106], a2: [40, 92, 44, 82], db: 'both', mat: true },
  pulloverBack: { ...LIE, a: [24, 94, 10, 98], db: 'goblet', mat: true },
  skullDown: { ...LIE, a: [42, 80, 30, 90], db: 'both', mat: true },
  pushUp: { h: [119, 70], n: [110, 74], p: [69, 90], s: [110, 76], a: [111, 92, 112, 108], l: [49, 98, 28, 106], l2: [49, 99, 30, 107], db: 'none', mat: true },
  pushDown: { h: [120, 92], n: [110, 96], p: [69, 101], s: [110, 98], a: [98, 94, 110, 108], l: [49, 104, 28, 106], l2: [49, 105, 30, 107], db: 'none', mat: true },
  renegadeUp: { h: [119, 70], n: [110, 74], p: [69, 90], s: [110, 76], a: [98, 74, 104, 88], a2: [112, 92, 113, 106], l: [49, 98, 28, 106], l2: [49, 99, 30, 107], db: 'both', mat: true },
  inclinePushUp: { h: [108, 56], n: [100, 62], p: [65, 85], s: [100, 64], a: [102, 72, 104, 80], l: [47, 97, 30, 108], l2: [47, 98, 32, 108], db: 'none', chair: 100 },
  inclinePushDown: { h: [107, 69], n: [98, 74], p: [64, 91], s: [98, 76], a: [90, 74, 104, 80], l: [46, 100, 30, 108], l2: [46, 101, 32, 108], db: 'none', chair: 100 },
  dipUp: { h: [66, 45], n: [64, 54], p: [66, 84], s: [64, 56], a: [63, 68, 62, 80], l: [92, 82, 96, 108], l2: [90, 83, 93, 108], db: 'none', chair: 30 },
  dipDown: { h: [68, 59], n: [66, 68], p: [68, 98], s: [66, 70], a: [52, 72, 62, 80], l: [94, 90, 96, 108], l2: [92, 91, 93, 108], db: 'none', chair: 30 },
  seatedRack: { h: [65, 37], n: [64, 46], p: [66, 78], a: [74, 58, 72, 44], l: [92, 78, 92, 108], l2: [90, 79, 89, 108], db: 'both', chair: 56 },
  seatedTop: { h: [65, 37], n: [64, 46], p: [66, 78], a: [70, 30, 69, 16], l: [92, 78, 92, 108], l2: [90, 79, 89, 108], db: 'both', chair: 56 },
  seatedLean: { h: [104, 58], n: [96, 62], p: [70, 78], a: [92, 78, 90, 96], l: [94, 80, 94, 108], l2: [92, 81, 91, 108], db: 'both', chair: 56 },
  seatedLeanUp: { h: [104, 58], n: [96, 62], p: [70, 78], a: [98, 60, 102, 56], a2: [94, 54, 96, 48], l: [94, 80, 94, 108], l2: [92, 81, 91, 108], db: 'both', chair: 56 },
  concDown: { h: [89, 42], n: [84, 50], p: [68, 78], a: [90, 76, 92, 94], l: [94, 80, 94, 108], l2: [92, 81, 91, 108], db: 'one', chair: 56 },
  concUp: { h: [89, 42], n: [84, 50], p: [68, 78], a: [90, 76, 88, 58], l: [94, 80, 94, 108], l2: [92, 81, 91, 108], db: 'one', chair: 56 },
  bridgeDown: { h: [26, 100], n: [36, 102], p: [74, 104], a: [50, 106, 64, 106], l: [96, 84, 108, 108], l2: [98, 86, 110, 108], db: 'hip', mat: true },
  bridgeUp: { h: [26, 100], n: [36, 102], p: [74, 86], a: [50, 106, 64, 106], l: [98, 80, 108, 108], l2: [100, 82, 110, 108], db: 'hip', mat: true },
  thrustDown: { h: [36, 69], n: [40, 78], p: [58, 104], a: [30, 82, 20, 80], l: [86, 84, 94, 108], l2: [86, 78, 104, 64], db: 'none', chair: 6 },
  thrustUp: { h: [36, 69], n: [40, 78], p: [66, 82], a: [30, 82, 20, 80], l: [90, 78, 94, 108], l2: [88, 70, 112, 72], db: 'none', chair: 6 },
  slRdl: { h: [117, 50], n: [108, 52], p: [78, 62], a: [106, 68, 105, 84], l: [80, 86, 80, 108], l2: [56, 62, 36, 60], db: 'one' },
  allFours: { h: [110, 72], n: [100, 76], p: [62, 78], s: [100, 78], a: [100, 92, 100, 108], l: [62, 106, 36, 108], l2: [64, 106, 38, 108], db: 'none', mat: true },
  donkeyUp: { h: [110, 72], n: [100, 76], p: [62, 78], s: [100, 78], a: [100, 92, 100, 108], l: [40, 76, 40, 58], l2: [64, 106, 38, 108], db: 'none', mat: true },
  plank: { h: [117, 85], n: [108, 88], p: [68, 97], s: [108, 90], a: [108, 106, 124, 106], l: [48, 101, 28, 106], l2: [48, 102, 30, 107], db: 'none', mat: true },
  sidePlankDown: { h: [116, 78], n: [108, 84], p: [68, 104], s: [108, 86], a: [108, 106, 120, 106], a2: [96, 92, 76, 100], l: [48, 106, 28, 107], db: 'none', mat: true },
  sidePlank: { h: [117, 75], n: [108, 80], p: [68, 93], s: [108, 82], a: [108, 106, 120, 106], a2: [108, 64, 108, 50], l: [48, 100, 28, 106], db: 'none', mat: true },
  deadBug: { h: [26, 100], n: [36, 102], p: [76, 104], a: [38, 88, 38, 74], l: [76, 80, 98, 80], db: 'none', mat: true },
  deadBugReach: { h: [26, 100], n: [36, 102], p: [76, 104], a: [24, 96, 12, 100], a2: [39, 88, 39, 74], l: [96, 100, 118, 104], l2: [77, 80, 99, 80], db: 'none', mat: true },
  vSit: { h: [52, 63], n: [56, 72], p: [70, 104], a: [70, 84, 76, 80], l: [92, 84, 108, 108], l2: [94, 85, 110, 108], db: 'goblet', mat: true },
  vSitTwist: { h: [52, 63], n: [56, 72], p: [70, 104], a: [72, 90, 82, 98], l: [92, 84, 108, 108], l2: [94, 85, 110, 108], db: 'goblet', mat: true },
  crunchDown: { h: [26, 98], n: [36, 102], p: [76, 104], a: [48, 96, 46, 98], l: [98, 84, 110, 108], l2: [100, 86, 112, 108], db: 'goblet', mat: true },
  crunchUp: { h: [38, 82], n: [44, 90], p: [76, 104], a: [56, 90, 52, 92], l: [98, 84, 110, 108], l2: [100, 86, 112, 108], db: 'goblet', mat: true },
  swingBottom: { h: [108, 44], n: [100, 48], p: [70, 66], a: [94, 66, 84, 84], l: [80, 86, 76, 108], l2: [77, 86, 73, 108], db: 'goblet' },
  swingTop: { ...STAND, a: [96, 40, 112, 38], db: 'goblet' },
  squatHands: { h: [102, 64], n: [94, 70], p: [70, 88], a: [100, 90, 102, 108], l: [92, 80, 86, 108], l2: [90, 81, 84, 108], db: 'none', mat: true },
};

const r = (n) => Math.round(n * 10) / 10;
const line = (a, b, cls = '') => `<line x1="${r(a[0])}" y1="${r(a[1])}" x2="${r(b[0])}" y2="${r(b[1])}"${cls ? ` class="${cls}"` : ''}/>`;

function dumbbell(x, y, vertical = false) {
  if (vertical) return `<g class="dbl"><rect x="${r(x - 2)}" y="${r(y - 8)}" width="4" height="16" rx="1"/><rect x="${r(x - 5)}" y="${r(y - 9)}" width="10" height="4" rx="1.5"/><rect x="${r(x - 5)}" y="${r(y + 5)}" width="10" height="4" rx="1.5"/></g>`;
  return `<g class="dbl"><rect x="${r(x - 8)}" y="${r(y - 1.5)}" width="16" height="3" rx="1"/><rect x="${r(x - 9)}" y="${r(y - 5)}" width="4" height="10" rx="1.5"/><rect x="${r(x + 5)}" y="${r(y - 5)}" width="4" height="10" rx="1.5"/></g>`;
}

function chairSVG(cx, right = false) {
  // Seat from cx to cx + 30 at y 80, backrest on the left edge (or the right edge when right = true).
  const bx = right ? cx + 28 : cx + 2;
  return `<g class="prop">${line([cx, 80], [cx + 30, 80])}${line([cx + 2, 80], [cx + 2, 108])}${line([cx + 28, 80], [cx + 28, 108])}${line([bx, 80], [bx, 48])}</g>`;
}

function figure(pose, ghost = false) {
  const p = pose;
  const sh = p.s || [p.n[0], p.n[1] + 2];
  const sh2 = p.s2 || [sh[0] + (p.s ? 0 : 3), sh[1] - (p.s ? 0 : 1)];
  const hp = p.hp || p.p, hp2 = p.hp2 || p.p;
  const a2 = p.a2 || [p.a[0] + 3, p.a[1] - 1, p.a[2] + 3, p.a[3] - 1];
  const l2 = p.l2 || [p.l[0] - 3, p.l[1], p.l[2] - 3, p.l[3]];
  let s = `<g class="${ghost ? 'fig-ghost' : ''}">`;
  // far limbs (lighter)
  s += `<g class="far">${line(sh2, [a2[0], a2[1]])}${line([a2[0], a2[1]], [a2[2], a2[3]])}${line(hp2, [l2[0], l2[1]])}${line([l2[0], l2[1]], [l2[2], l2[3]])}</g>`;
  // torso
  if (p.s && p.s2) s += line(p.s, p.s2);
  if (p.hp && p.hp2) s += line(p.hp, p.hp2);
  s += line(p.n, p.p);
  // near limbs
  s += line(sh, [p.a[0], p.a[1]]) + line([p.a[0], p.a[1]], [p.a[2], p.a[3]]);
  s += line(hp, [p.l[0], p.l[1]]) + line([p.l[0], p.l[1]], [p.l[2], p.l[3]]);
  if (p.toes) s += line([p.l[2], p.l[3]], [p.l[2] + 7, 108]) + line([l2[2], l2[3]], [l2[2] + 7, 108], 'far');
  // head
  s += `<circle cx="${p.h[0]}" cy="${p.h[1]}" r="7" class="head"/>`;
  // dumbbells
  if (p.db === 'both') s += dumbbell(a2[2], a2[3]) + dumbbell(p.a[2], p.a[3]);
  else if (p.db === 'one') s += dumbbell(p.a[2], p.a[3]);
  else if (p.db === 'goblet') s += dumbbell((p.a[2] + a2[2]) / 2, (p.a[3] + a2[3]) / 2, true);
  else if (p.db === 'hip') s += dumbbell(p.p[0], p.p[1] - 6);
  s += '</g>';
  return s;
}

// Returns the SVG markup for an exercise. Pose names come from our own data, never from user input.
export function exerciseFigure(ex, { small = false } = {}) {
  const [a, b] = ex.fig || ['stand', 'stand'];
  const pa = POSES[a] || POSES.stand, pb = POSES[b] || POSES.stand;
  const chair = pb.chair ?? pa.chair;
  const mat = pa.mat || pb.mat || (ex.gear || []).includes('mat');
  let s = `<svg viewBox="0 -14 160 128" role="img" aria-label="Line drawing of the movement" fill="none" stroke="currentColor" stroke-width="${small ? 4 : 3}" stroke-linecap="round" stroke-linejoin="round">`;
  s += `<style>.far{opacity:.45}.prop{opacity:.5;stroke-width:2.5}.dbl rect{fill:currentColor;stroke:none}.fig-ghost{opacity:.25}.head{fill:none}</style>`;
  s += `<line x1="4" y1="109.5" x2="156" y2="109.5" stroke-width="1.5" opacity=".3"/>`;
  if (mat) s += `<rect x="14" y="108" width="132" height="3" rx="1.5" fill="currentColor" stroke="none" opacity=".18"/>`;
  if (chair !== undefined) s += chairSVG(chair, !!(pb.chairR || pa.chairR));
  if (a !== b && !small) s += figure(pa, true);
  s += figure(small ? pb : pb);
  s += '</svg>';
  return s;
}
