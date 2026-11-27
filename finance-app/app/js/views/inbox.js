// Belanja: Inbox. Payments read from notifications, waiting for one tap to save.

import * as st from '../store.js';
import { esc, money, todayISO, nowHM, initials } from '../util.js';
import { icon } from '../icons.js';
import { openSheet, pickCategory, pickAccount, keypad, toast, badge } from '../ui.js';
import { app, go } from '../app.js';
import * as capture from '../capture.js';

const when = (ms) => {
  const d = new Date(ms);
  const day = todayISO(d);
  const t = nowHM(d);
  if (day === app.today) return t;
  return `${d.getDate()}/${d.getMonth() + 1} ${t}`;
};

function card(it) {
  const p = it.parsed || {};
  const acc = st.idx().acc;
  const dup = it.dupOf || it.dupTx;
  const pill = dup ? ['warn', it.dupOf ? 'Possible duplicate' : 'Already saved?'] : p.kind === 'transfer' ? ['info', 'Transfer'] : p.kind === 'income' ? ['ok', 'Money in'] : p.confidence === 'low' || p.kind === 'unknown' ? ['warn', 'Check this'] : ['ok', 'Looks right'];
  let guess;
  if (p.kind === 'transfer') {
    guess = `<span class="badge xf" style="width:36px;height:36px">${icon('swap', 18)}</span><div class="meta"><div class="ttl">${esc(p.merchant || 'Transfer')}</div><div class="chips" style="margin-top:6px">
      <button type="button" class="chip" data-act="pickFrom" data-id="${it.id}"><span>${esc(acc.get(p.accountId)?.name || 'From?')}</span></button><span class="muted">→</span>
      <button type="button" class="chip" data-act="pickTo" data-id="${it.id}"><span>${esc(acc.get(p.toAccountId)?.name || 'To?')}</span></button></div></div>`;
  } else {
    const c = st.idx().cat.get(p.categoryId);
    guess = `${c ? badge(initials(c.name), st.catColor(c.id)) : badge('?', 'c0')}<div class="meta"><div class="ttl">${esc(p.merchant || (p.kind === 'income' ? 'Money in' : 'Payment'))}</div><div class="chips" style="margin-top:6px">
      <button type="button" class="chip" data-act="pickCat" data-id="${it.id}"><span>${esc(c ? c.name : 'Category?')}</span>${icon('down', 12)}</button>
      <button type="button" class="chip" data-act="pickAcc" data-id="${it.id}"><span>${esc(acc.get(p.accountId)?.name || 'Account?')}</span>${icon('down', 12)}</button></div></div>`;
  }
  const reason = dup ? it.reason || p.reason : p.reason;
  return `<div class="icard ${dup || pill[0] === 'warn' ? 'flag' : ''}">
    <span><span class="pill ${pill[0]}">${pill[1]}</span></span>
    <div class="notif"><div class="body"><div class="from">${esc(it.app || 'Message')}<span class="time">${esc(when(it.receivedAt))}</span></div>${esc([it.title, it.text].filter(Boolean).join(' — '))}</div></div>
    <div class="guess">${guess}<button type="button" class="amt num" data-act="amount" data-id="${it.id}" aria-label="Change amount">${p.amount ? money(p.amount) : 'RM?'}</button></div>
    ${reason ? `<div class="why">${icon('spark', 14)}<span>${esc(reason)}</span></div>` : ''}
    <div class="row-btns" style="margin-top:0">${dup
      ? `<button type="button" class="btn" data-act="save" data-id="${it.id}">Save anyway</button><button type="button" class="btn primary" data-act="skip" data-id="${it.id}">Skip it</button>`
      : `<button type="button" class="btn ghost" data-act="skip" data-id="${it.id}">Skip</button><button type="button" class="btn" data-act="open" data-id="${it.id}">Edit</button><button type="button" class="btn primary" data-act="save" data-id="${it.id}">Save</button>`}</div>
  </div>`;
}

function render() {
  const items = st.S.inbox.filter((i) => i.status === 'new').sort((a, b) => b.receivedAt - a.receivedAt);
  const junk = st.S.inbox.filter((i) => i.status === 'junk').sort((a, b) => b.receivedAt - a.receivedAt).slice(0, 40);
  const s = st.S.settings;
  let html = `<header class="top"><div class="top-t"><h1>Inbox</h1><div class="sub">Payments read from your bank and e-wallet messages</div></div>
    <div class="top-r"><button type="button" class="iconbtn" data-act="check" aria-label="Check for new messages">${icon('refresh', 20)}</button></div></header>
    <div class="tools"><button type="button" class="btn" data-act="paste">${icon('edit', 18)}Paste a message</button><a class="btn" href="#receipt">${icon('receipt', 18)}Scan a receipt</a><a class="btn" href="#add">${icon('plus', 18)}Type it in</a></div>`;
  if (!app.demo && !s.appKey) {
    html += `<div class="card" style="margin-bottom:12px"><b>Catch payments automatically</b><p class="muted small" style="margin:6px 0 10px">Connect Belanja to your phone's notifications and payments land here by themselves. It takes about 15 minutes, once.</p><a class="btn primary" href="#prefs">Set it up</a></div>`;
  }
  html += items.length ? items.map(card).join('') : `<div class="card"><div class="empty" style="padding:12px">All caught up. New payments will show up here.</div></div>`;
  html += `<details class="skipped" style="margin-top:12px"><summary><span>Skipped by Belanja (${junk.length})</span><span class="muted">${icon('down', 16)}</span></summary>${
    junk.length
      ? junk.map((k) => `<div class="skip"><div class="meta"><div><b>${esc(k.app || 'Message')}</b> ${esc([k.title, k.text].filter(Boolean).join(' — '))}</div><div class="r">${esc(k.parsed?.reason || 'Not a payment')}</div></div><button type="button" data-act="notJunk" data-id="${k.id}">Not junk</button></div>`).join('')
      : '<div class="skip"><div class="meta r">Nothing skipped yet. Codes, promos and delivery updates go here.</div></div>'
  }</details>`;
  if (!app.demo && s.appKey) html += `<p class="muted small" style="text-align:center">Last checked ${s.lastFetch ? when(s.lastFetch) : 'never'}.</p>`;
  return html;
}

const find = (id) => st.S.inbox.find((x) => x.id === id);
const update = (it, patch) => st.save('inbox', { ...it, parsed: { ...it.parsed, ...patch } });

async function saveItem(it) {
  const p = it.parsed;
  const needsForm = !p.amount || p.kind === 'unknown' || (p.kind === 'transfer' ? !p.accountId && !p.toAccountId : !p.accountId || !p.categoryId);
  const d = new Date(it.receivedAt);
  const base = { date: todayISO(d), time: nowHM(d), amount: p.amount || 0, title: p.merchant || '', source: 'notif', inboxId: it.id, notes: '' };
  if (needsForm) {
    app.prefill = { ...base, type: p.kind === 'income' ? 'i' : p.kind === 'transfer' ? 't' : 'e', accountId: p.accountId || null, toAccountId: p.toAccountId || null, categoryId: p.categoryId || null };
    go('#add');
    return;
  }
  const tx = p.kind === 'transfer'
    ? { ...base, type: 't', accountId: p.accountId || null, toAccountId: p.toAccountId || null, categoryId: null }
    : { ...base, type: p.kind === 'income' ? 'i' : 'e', accountId: p.accountId, categoryId: p.categoryId };
  tx.labels = [];
  tx.status = 'cleared';
  const [saved] = await st.save('transactions', tx, { quiet: true });
  if (tx.type === 'e' && tx.title) await st.remember(tx.title, tx.categoryId, tx.accountId);
  await st.save('inbox', { ...it, status: 'saved', txId: saved.id });
  toast(`Saved ${money(tx.amount)}`, { label: 'Undo', run: async () => { await st.remove('transactions', saved.id); await st.save('inbox', { ...find(it.id), status: 'new', txId: null }); } });
}

export default {
  render,
  actions: {
    pickCat: async (b) => {
      const it = find(b.dataset.id);
      const id = await pickCategory({ kind: it.parsed.kind === 'income' ? 'income' : 'expense', current: it.parsed.categoryId });
      if (id) await update(it, { categoryId: id, kind: it.parsed.kind === 'unknown' ? 'expense' : it.parsed.kind, reason: 'You picked the category. Belanja will remember it for this shop.', confidence: 'medium' });
    },
    pickAcc: async (b) => {
      const it = find(b.dataset.id);
      const id = await pickAccount({ current: it.parsed.accountId });
      if (id) await update(it, { accountId: id });
    },
    pickFrom: async (b) => {
      const it = find(b.dataset.id);
      const id = await pickAccount({ current: it.parsed.accountId, title: 'Money came from', exclude: it.parsed.toAccountId, allowNone: true });
      if (id != null) await update(it, { accountId: id || null });
    },
    pickTo: async (b) => {
      const it = find(b.dataset.id);
      const id = await pickAccount({ current: it.parsed.toAccountId, title: 'Money went to', exclude: it.parsed.accountId, allowNone: true });
      if (id != null) await update(it, { toAccountId: id || null });
    },
    amount: (b) => {
      const it = find(b.dataset.id);
      keypad({ title: 'Amount', value: it.parsed.amount || 0, onDone: (v) => update(it, { amount: v }) });
    },
    save: (b) => saveItem(find(b.dataset.id)),
    open: (b) => {
      const it = find(b.dataset.id);
      const p = it.parsed;
      const d = new Date(it.receivedAt);
      app.prefill = { type: p.kind === 'income' ? 'i' : p.kind === 'transfer' ? 't' : 'e', amount: p.amount || 0, title: p.merchant || '', date: todayISO(d), time: nowHM(d), accountId: p.accountId || null, toAccountId: p.toAccountId || null, categoryId: p.categoryId || null, source: 'notif', inboxId: it.id };
      go('#add');
    },
    skip: async (b) => {
      const it = find(b.dataset.id);
      await st.save('inbox', { ...it, status: 'skipped' });
      toast('Skipped', { label: 'Undo', run: () => st.save('inbox', { ...find(it.id), status: 'new' }) });
    },
    notJunk: async (b) => {
      const it = find(b.dataset.id);
      await st.save('inbox', { ...it, status: 'new', parsed: { ...it.parsed, kind: 'unknown', confidence: 'low', reason: 'You said this isn’t junk. Fill in the details, then save.' } });
      toast('Moved back to your inbox');
    },
    paste: () => {
      openSheet({
        title: 'Paste a message',
        body: `<p class="muted small">Copy a bank SMS or notification text, paste it here, and Belanja reads it. Several messages? Leave an empty line between them.</p>
          <textarea class="input" id="paste-text" placeholder="You have paid RM12.50 to NASI KANDAR PELITA SS2." autofocus></textarea>
          <input class="input" id="paste-app" placeholder="Which app or bank sent it? (helps pick the account)" autocomplete="off">
          <button type="button" class="btn primary block" data-pick="read">Read it</button>`,
        onPick: async () => {
          const text = document.getElementById('paste-text').value.trim();
          const appName = document.getElementById('paste-app').value.trim();
          if (!text) { toast('Paste a message first.'); return true; }
          const parts = text.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
          let added = 0;
          let junk = 0;
          for (const part of parts) {
            const it = await capture.intake({ text: part, app: appName || 'Pasted', source: 'paste' }, { quiet: true });
            if (!it) continue;
            if (it.status === 'junk') junk++;
            else added++;
          }
          st.emit('inbox');
          if (added) capture.aiCheck(st.S.inbox.filter((x) => x.status === 'new')).catch(() => {});
          toast(added ? `Read ${added} payment${added === 1 ? '' : 's'}${junk ? `, skipped ${junk}` : ''}` : junk ? 'That looks like a code or promo, so it was skipped.' : 'Already in your inbox.');
          return false;
        },
      });
    },
    check: async () => {
      if (app.demo) { toast('In the demo, try Paste a message instead.'); return; }
      if (!st.S.settings.appKey) { go('#prefs'); return; }
      const n = await capture.fetchRemote();
      toast(n ? `${n} new message${n === 1 ? '' : 's'}` : 'Nothing new');
    },
  },
};
