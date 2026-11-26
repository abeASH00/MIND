// Belanja: charts drawn as SVG. Thin bars with rounded tops, hairline grid,
// a legend when there are two or more series, and a tooltip on hover, tap or keyboard focus.

import { esc, money, moneyShort } from './util.js';

const DATA = new Map();
let seq = 0;

function niceScale(lo, hi, ticks = 4) {
  if (hi === lo) hi = lo + 1;
  const raw = (hi - lo) / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  return { min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step, step };
}

// A bar whose top corners are rounded and whose base is square.
function barPath(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}V${y + r}a${r},${r} 0 0 1 ${r},${-r}h${w - 2 * r}a${r},${r} 0 0 1 ${r},${r}V${y + h}Z`;
}

const legend = (series, kind = 'rect') =>
  series.length < 2 ? '' : `<div class="legend">${series.map((s) => `<span class="lg"><i class="lg-${kind}" style="--b:var(--${s.color})"></i>${esc(s.name)}</span>`).join('')}</div>`;

/* Grouped columns, e.g. income and expense per month.
   series: [{ name, color: 'inc'|'exp'|'c1'.., values: [sen] }], labels: short x labels, titles: tooltip titles */
export function columns({ labels, titles = labels, series, height = 190, label = 'Chart' }) {
  const id = 'ch' + ++seq;
  const W = 360;
  const H = height;
  const L = 46;
  const R = 6;
  const Tp = 10;
  const B = 24;
  const pw = W - L - R;
  const ph = H - Tp - B;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const sc = niceScale(0, max);
  const n = labels.length;
  const slot = pw / n;
  const k = series.length;
  const bw = Math.max(3, Math.min(24, (slot * 0.72 - (k - 1) * 2) / k));
  const gw = k * bw + (k - 1) * 2;
  const y = (v) => Tp + ph - (v / sc.max) * ph;
  let g = '';
  for (let v = 0; v <= sc.max + 1e-6; v += sc.step) {
    g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end">${esc(moneyShort(v))}</text>`;
  }
  labels.forEach((lab, i) => {
    const x0 = L + i * slot + (slot - gw) / 2;
    series.forEach((s, j) => {
      const v = s.values[i] || 0;
      if (v > 0) g += `<path class="mark" d="${barPath(x0 + j * (bw + 2), y(v), bw, Tp + ph - y(v), 4)}" style="fill:var(--${s.color})"/>`;
    });
    if (n <= 12 || i % Math.ceil(n / 12) === 0) g += `<text class="tick" x="${L + i * slot + slot / 2}" y="${H - 7}" text-anchor="middle">${esc(lab)}</text>`;
  });
  g += `<line class="axis" x1="${L}" x2="${W - R}" y1="${Tp + ph}" y2="${Tp + ph}"/>`;
  g += `<rect class="band" x="0" y="${Tp}" width="${slot}" height="${ph}" visibility="hidden"/>`;
  labels.forEach((_, i) => { g += `<rect class="hit" x="${L + i * slot}" y="${Tp}" width="${slot}" height="${ph}" data-i="${i}" tabindex="0" aria-label="${esc(titles[i])}"/>`; });
  DATA.set(id, { type: 'columns', titles, rows: labels.map((_, i) => series.map((s) => ({ name: s.name, color: s.color, value: s.values[i] || 0 }))), slot, L });
  return `<div class="chart" data-chart="${id}"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${g}</svg><div class="tip" hidden></div></div>${legend(series)}`;
}

/* One line over time, e.g. net worth. values in sen (can be negative). */
export function line({ labels, titles = labels, values, color = 'inc', height = 190, label = 'Chart', name = 'Value' }) {
  const id = 'ch' + ++seq;
  const W = 360;
  const H = height;
  const L = 50;
  const R = 12;
  const Tp = 14;
  const B = 24;
  const pw = W - L - R;
  const ph = H - Tp - B;
  const sc = niceScale(Math.min(0, ...values), Math.max(...values, 1));
  const n = values.length;
  const x = (i) => L + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
  const y = (v) => Tp + ph - ((v - sc.min) / (sc.max - sc.min)) * ph;
  let g = '';
  for (let v = sc.min; v <= sc.max + 1e-6; v += sc.step) {
    g += `<line class="${v === 0 ? 'axis' : 'grid'}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end">${esc(moneyShort(v))}</text>`;
  }
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const base = y(Math.max(sc.min, 0));
  g += `<path class="area" d="M${x(0)},${base}L${pts.join('L')}L${x(n - 1)},${base}Z" style="fill:var(--${color})"/>`;
  g += `<path class="line" d="M${pts.join('L')}" style="stroke:var(--${color})"/>`;
  labels.forEach((lab, i) => { if (n <= 12 || i % Math.ceil(n / 12) === 0) g += `<text class="tick" x="${x(i)}" y="${H - 7}" text-anchor="middle">${esc(lab)}</text>`; });
  const last = values[n - 1];
  g += `<circle class="dot end" cx="${x(n - 1)}" cy="${y(last)}" r="4" style="fill:var(--${color})"/>`;
  g += `<text class="endlab" x="${x(n - 1) - 6}" y="${y(last) - 9}" text-anchor="end">${esc(moneyShort(last))}</text>`;
  g += `<line class="cross" x1="0" x2="0" y1="${Tp}" y2="${Tp + ph}" visibility="hidden"/><circle class="dot hov" r="4" cx="0" cy="0" visibility="hidden" style="fill:var(--${color})"/>`;
  g += `<rect class="hit wide" x="${L - 10}" y="${Tp}" width="${pw + 20}" height="${ph}" tabindex="0" aria-label="${esc(label)}"/>`;
  DATA.set(id, { type: 'line', titles, values, name, color, xs: values.map((_, i) => x(i)), ys: values.map((v) => y(v)) });
  return `<div class="chart" data-chart="${id}"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${g}</svg><div class="tip" hidden></div></div>`;
}

/* One whole split into parts (tall segmented bar). parts: [{ name, value, color }] */
export function segBar(parts, total) {
  const shown = parts.filter((p) => p.value > 0);
  if (!shown.length || total <= 0) return '';
  const blocks = shown
    .map((p) => {
      const share = p.value / total;
      const pct = Math.round(share * 100);
      const text = share >= 0.1 ? `${pct}%` : '';
      const dark = p.color === 'c4';
      return `<span class="seg${dark ? ' ink-dark' : ''}" style="flex:${share} 0 0;--b:var(--${p.color})" title="${esc(p.name)}: ${esc(money(p.value))} (${pct}%)" aria-label="${esc(p.name)}: ${esc(money(p.value))}, ${pct}%" tabindex="0">${text}</span>`;
    })
    .join('');
  const lg = `<div class="legend">${shown.map((p) => `<span class="lg"><i class="lg-rect" style="--b:var(--${p.color})"></i>${esc(p.name)}</span>`).join('')}</div>`;
  return `<div class="segbar" role="img" aria-label="Share of total">${blocks}</div>${lg}`;
}

// A budget meter: the fill shows how much is used; the colour shows how it's going.
export function meter(pct, state = 'ok', label = '') {
  return `<div class="meter ${state}" role="img" aria-label="${esc(label || Math.round(pct * 100) + '% used')}"><i style="width:${Math.min(100, Math.max(0, pct * 100)).toFixed(1)}%"></i></div>`;
}

/* ---------------- Tooltips ---------------- */

function tipRows(tip, title, rows) {
  tip.replaceChildren();
  const h = document.createElement('div');
  h.className = 'tip-t';
  h.textContent = title;
  tip.appendChild(h);
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'tip-r';
    const key = document.createElement('i');
    key.style.setProperty('--b', `var(--${r.color})`);
    const v = document.createElement('b');
    v.textContent = money(r.value);
    const n = document.createElement('span');
    n.textContent = r.name;
    row.append(key, v, n);
    tip.appendChild(row);
  }
}

function place(tip, box, xFrac) {
  tip.hidden = false;
  const w = tip.offsetWidth;
  const left = Math.min(Math.max(4, xFrac * box.width - w / 2), box.width - w - 4);
  tip.style.left = left + 'px';
}

export function mountCharts(root) {
  root.querySelectorAll('.chart[data-chart]').forEach((el) => {
    const d = DATA.get(el.dataset.chart);
    if (!d) return;
    const svg = el.querySelector('svg');
    const tip = el.querySelector('.tip');
    const vb = svg.viewBox.baseVal;
    const hide = () => {
      tip.hidden = true;
      svg.querySelectorAll('.band,.cross,.hov').forEach((n) => n.setAttribute('visibility', 'hidden'));
    };
    if (d.type === 'columns') {
      const band = svg.querySelector('.band');
      const show = (i) => {
        band.setAttribute('x', d.L + i * d.slot);
        band.setAttribute('visibility', 'visible');
        tipRows(tip, d.titles[i], d.rows[i]);
        place(tip, el.getBoundingClientRect(), (d.L + (i + 0.5) * d.slot) / vb.width);
      };
      svg.querySelectorAll('.hit').forEach((h) => {
        const i = Number(h.dataset.i);
        h.addEventListener('pointerenter', () => show(i));
        h.addEventListener('pointerdown', () => show(i));
        h.addEventListener('focus', () => show(i));
        h.addEventListener('blur', hide);
      });
      el.addEventListener('pointerleave', hide);
    } else if (d.type === 'line') {
      const hit = svg.querySelector('.hit');
      const cross = svg.querySelector('.cross');
      const dot = svg.querySelector('.hov');
      let cur = d.values.length - 1;
      const show = (i) => {
        cur = i;
        cross.setAttribute('x1', d.xs[i]);
        cross.setAttribute('x2', d.xs[i]);
        dot.setAttribute('cx', d.xs[i]);
        dot.setAttribute('cy', d.ys[i]);
        cross.setAttribute('visibility', 'visible');
        dot.setAttribute('visibility', 'visible');
        tipRows(tip, d.titles[i], [{ name: d.name, color: d.color, value: d.values[i] }]);
        place(tip, el.getBoundingClientRect(), d.xs[i] / vb.width);
      };
      const nearest = (evt) => {
        const r = svg.getBoundingClientRect();
        const vx = ((evt.clientX - r.left) / r.width) * vb.width;
        let best = 0;
        d.xs.forEach((x, i) => { if (Math.abs(x - vx) < Math.abs(d.xs[best] - vx)) best = i; });
        return best;
      };
      hit.addEventListener('pointermove', (e) => show(nearest(e)));
      hit.addEventListener('pointerdown', (e) => show(nearest(e)));
      hit.addEventListener('focus', () => show(cur));
      hit.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') show(Math.max(0, cur - 1));
        if (e.key === 'ArrowRight') show(Math.min(d.values.length - 1, cur + 1));
      });
      hit.addEventListener('blur', hide);
      el.addEventListener('pointerleave', hide);
    }
  });
}
