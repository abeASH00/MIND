// Belanja: pieces several screens share: transaction rows, day groups, the period bar.

import * as st from '../store.js';
import { esc, money, dayLabel } from '../util.js';
import { toBase, periodFor } from '../calc.js';
import { icon } from '../icons.js';
import { catBadge, pickFrom } from '../ui.js';
import { app, baseCur } from '../app.js';

export function txTitle(t) {
  if (t.title) return t.title;
  if (t.type === 't') return 'Transfer';
  if (t.splits && t.splits.length > 1) return 'Split';
  return st.catLabel(t.categoryId);
}

export function txSub(t) {
  const acc = st.idx().acc;
  if (t.type === 't') return `${acc.get(t.accountId)?.name || 'Outside'} → ${acc.get(t.toAccountId)?.name || 'Outside'}`;
  const where = acc.get(t.accountId)?.name || 'No account';
  if (t.splits && t.splits.length > 1) return `Split into ${t.splits.length} · ${where}`;
  return `${st.catLabel(t.categoryId)} · ${where}`;
}

export function txRow(t, { balance } = {}) {
  const a = st.idx().acc.get(t.accountId);
  const cls = t.type === 'i' ? 'inc' : t.type === 't' ? 'xf' : '';
  const sign = t.type === 'i' ? '+' : t.type === 't' ? '' : '−';
  const tags = [];
  if (t.status === 'pending') tags.push('<span class="tg pend">Pending</span>');
  if (t.source === 'notif') tags.push('<span class="tg">Auto</span>');
  if (t.source === 'receipt') tags.push('<span class="tg">Receipt</span>');
  if (t.source === 'recurring') tags.push('<span class="tg">Repeat</span>');
  for (const l of (t.labels || []).slice(0, 2)) tags.push(`<span class="tg">#${esc(l)}</span>`);
  const clip = t.attachmentIds && t.attachmentIds.length ? icon('clip', 13) : '';
  const fx = t.fx ? `<small>${esc(t.fx.currency)} ${(t.fx.amount / 100).toFixed(2)}</small>` : balance != null ? `<small>${money(balance)}</small>` : '';
  return `<a class="row" href="#tx-${t.id}">${catBadge(t)}
    <div class="meta"><div class="t">${esc(txTitle(t))}${tags.length || clip ? `<span class="tagline">${tags.join('')}${clip}</span>` : ''}</div><div class="s">${esc(txSub(t))}</div></div>
    <div class="a num ${cls}">${sign}${money(t.amount, { cur: a?.currency || baseCur() })}${fx}</div></a>`;
}

// Transactions grouped under a heading for each day, newest first.
export function dayGroups(list, { limit = 0, moreAct = '', balances = null } = {}) {
  if (!list.length) return '';
  const shown = limit ? list.slice(0, limit) : list;
  const acc = st.idx().acc;
  let html = '<div class="list">';
  let day = null;
  for (const t of shown) {
    if (t.date !== day) {
      day = t.date;
      const spent = list.filter((x) => x.date === day && x.type === 'e').reduce((s, x) => s + toBase(x.amount, acc.get(x.accountId), baseCur()), 0);
      html += `<div class="day"><span>${esc(dayLabel(day, app.today))}</span><span class="num">${spent ? '−' + money(spent) : ''}</span></div>`;
    }
    html += txRow(t, { balance: balances ? balances.get(t.id) : undefined });
  }
  if (limit && list.length > limit && moreAct) html += `<button type="button" class="more-btn" data-act="${moreAct}">Show ${Math.min(200, list.length - limit)} more</button>`;
  return html + '</div>';
}

export function periodBar(label, { act = 'period' } = {}) {
  return `<div class="period">
    <button type="button" class="iconbtn" data-act="prev" aria-label="Previous period">${icon('back', 20)}</button>
    <button type="button" class="pl" data-act="${act}">${esc(label)}</button>
    <button type="button" class="iconbtn" data-act="next" aria-label="Next period">${icon('next', 20)}</button>
  </div>`;
}

export async function choosePeriodKind(current) {
  const v = await pickFrom('Show', [
    { value: 'day', label: 'One day' },
    { value: 'week', label: 'One week' },
    { value: 'month', label: 'One month' },
    { value: 'year', label: 'One year' },
    { value: 'all', label: 'Everything' },
  ], current);
  return v;
}

export const freshPeriod = (kind, opts) => periodFor(kind, app.today, opts);

export function totalsBox(t) {
  return `<div class="totals num">
    <div><span>Income</span><b>${money(t.income)}</b></div>
    <div><span>Spent</span><b>${money(t.expense)}</b></div>
    <div><span>Left over</span><b style="${t.net < 0 ? 'color:var(--neg)' : ''}">${money(t.net, { sign: t.net > 0 ? '+' : undefined })}</b></div>
  </div>`;
}
