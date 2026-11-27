// Kuat — charts drawn by hand as inline SVG. No chart library, nothing loaded from outside.
import { esc, toDisplay, unit, fmtDate } from './ui.js';

const W = 320, H = 180, PL = 34, PR = 10, PT = 22, PB = 24;

function niceTicks(min, max, n = 4) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min, raw = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

// points: [{ x: timestamp, y: number }]. Options: unitKg (convert y to kg/lb for labels),
// pbIndex (mark that point as a personal best), second: [{x,y}] dashed second line.
export function lineChart(points, { unitKg = false, pbIndex = -1, second = null, label = '' } = {}) {
  if (!points.length) return '';
  const conv = (v) => (unitKg ? Number(toDisplay(v)) : v);
  const ys = points.map((p) => conv(p.y)).concat(second ? second.map((p) => conv(p.y)) : []);
  const ticks = niceTicks(Math.min(...ys), Math.max(...ys));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const xs = points.map((p) => p.x);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const sx = (x) => (x1 === x0 ? PL + (W - PL - PR) / 2 : PL + ((x - x0) / (x1 - x0)) * (W - PL - PR));
  const sy = (y) => PT + (1 - (y - y0) / (y1 - y0 || 1)) * (H - PT - PB);
  const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(conv(p.y)).toFixed(1)}`).join(' ');
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label || 'Chart')}">`;
  for (const t of ticks) s += `<line class="grid" x1="${PL}" x2="${W - PR}" y1="${sy(t).toFixed(1)}" y2="${sy(t).toFixed(1)}"/><text x="${PL - 6}" y="${(sy(t) + 4).toFixed(1)}" text-anchor="end">${esc(t)}</text>`;
  const area = `${path(points)} L${sx(x1).toFixed(1)},${H - PB} L${sx(x0).toFixed(1)},${H - PB} Z`;
  if (points.length > 1) s += `<path class="area" d="${area}" opacity=".6"/>`;
  if (second && second.length > 1) s += `<path class="ln2" d="${path(second)}"/>`;
  if (points.length > 1) s += `<path class="ln" d="${path(points)}"/>`;
  points.forEach((p, i) => { s += `<circle class="${i === pbIndex ? 'pb' : 'dot'}" cx="${sx(p.x).toFixed(1)}" cy="${sy(conv(p.y)).toFixed(1)}" r="${i === pbIndex ? 5.5 : 3.5}"/>`; });
  s += `<text x="${PL}" y="${H - 6}">${esc(fmtDate(x0))}</text>`;
  if (x1 !== x0) s += `<text x="${W - PR}" y="${H - 6}" text-anchor="end">${esc(fmtDate(x1))}</text>`;
  if (unitKg) s += `<text x="${PL - 6}" y="9" text-anchor="end">${esc(unit())}</text>`;
  s += '</svg>';
  return s;
}

// bars: [{ label, value }]
export function barChart(bars, { format = (v) => String(Math.round(v)), label = '' } = {}) {
  if (!bars.length) return '';
  const max = Math.max(1, ...bars.map((b) => b.value));
  const bw = (W - PL - PR) / bars.length;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label || 'Bar chart')}">`;
  s += `<line class="grid" x1="${PL}" x2="${W - PR}" y1="${H - PB}" y2="${H - PB}"/>`;
  bars.forEach((b, i) => {
    const h = (b.value / max) * (H - PT - PB - 12);
    const x = PL + i * bw + bw * 0.18, w = bw * 0.64, y = H - PB - h;
    s += `<rect class="bar ${b.value ? '' : 'low'}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(h, 2).toFixed(1)}" rx="5"/>`;
    if (b.value) s += `<text x="${(x + w / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle">${esc(format(b.value))}</text>`;
    s += `<text x="${(x + w / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(b.label)}</text>`;
  });
  return s + '</svg>';
}
