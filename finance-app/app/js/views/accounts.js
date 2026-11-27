// Belanja: Accounts. Net worth, then every account grouped by kind.

import * as st from '../store.js';
import { esc, money } from '../util.js';
import { balances, netWorth, toBase } from '../calc.js';
import { ACCOUNT_TYPES } from '../csv.js';
import { icon } from '../icons.js';
import { accBadge } from '../ui.js';
import { baseCur } from '../app.js';
import { editAccount } from './account.js';

const ORDER = ['bank', 'savings', 'cash', 'ewallet', 'credit', 'loan', 'investment', 'other'];
const GROUP = { bank: 'Bank accounts', savings: 'Savings', cash: 'Cash', ewallet: 'E-wallets', credit: 'Credit cards', loan: 'Loans', investment: 'Investments', other: 'Other' };

function row(a, bal) {
  const v = bal[a.id] || 0;
  return `<a class="row" href="#account-${a.id}">${accBadge(a)}<div class="meta"><div class="t">${esc(a.name)}</div><div class="s">${esc(ACCOUNT_TYPES[a.type] || 'Other')}${a.currency && a.currency !== baseCur() ? ' · ' + esc(a.currency) : ''}</div></div><div class="a num ${v < 0 ? 'neg' : ''}">${money(v, { cur: a.currency || baseCur() })}</div></a>`;
}

export default {
  render() {
    const all = st.accounts(true);
    const bal = balances(all, st.txs());
    const nw = netWorth(all, bal, baseCur());
    const open = all.filter((a) => !a.archived);
    let html = `<header class="top"><button type="button" class="iconbtn" data-act="back" aria-label="Back">${icon('back')}</button><div class="top-t"><h1>Accounts</h1></div>
      <div class="top-r"><button type="button" class="iconbtn" data-act="add" aria-label="Add an account">${icon('plus', 20)}</button></div></header>
      <section class="card"><div class="label">Net worth</div><div class="num" style="font-family:var(--display);font-size:32px;font-weight:700;${nw.net < 0 ? 'color:var(--neg)' : ''}">${money(nw.net)}</div>
      <div class="nw"><div class="stat"><div class="d">What you have</div><div class="v num">${money(nw.assets)}</div></div><div class="stat"><div class="d">What you owe</div><div class="v num">${money(-nw.liabilities)}</div></div></div></section>`;
    for (const type of ORDER) {
      const list = open.filter((a) => (a.type || 'other') === type);
      if (!list.length) continue;
      const sum = list.reduce((s, a) => s + toBase(bal[a.id] || 0, a, baseCur()), 0);
      html += `<h2 class="sec">${GROUP[type]} <span class="muted num" style="font-size:14px;font-family:var(--body)">${money(sum)}</span></h2><div class="list">${list.map((a) => row(a, bal)).join('')}</div>`;
    }
    const archived = all.filter((a) => a.archived);
    if (archived.length) html += `<details class="skipped" style="margin-top:16px"><summary><span>Archived (${archived.length})</span>${icon('down', 16)}</summary><div class="list" style="margin-bottom:10px">${archived.map((a) => row(a, bal)).join('')}</div></details>`;
    if (!all.length) html += `<div class="empty">No accounts yet. Tap + to add one.</div>`;
    return html;
  },
  parent: '#more',
  actions: { add: () => editAccount(null) },
};
