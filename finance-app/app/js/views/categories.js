// Belanja: Categories. Groups (like Food & Drinks) with categories inside (like Dining Out).

import * as st from '../store.js';
import { esc, initials } from '../util.js';
import { icon } from '../icons.js';
import { openSheet, pickCategory, toast, confirmBox, badge } from '../ui.js';
import { app } from '../app.js';

let kind = 'expense';
const COLORS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c0'];

function uses(id) {
  return st.txs().filter((t) => t.categoryId === id || (t.splits || []).some((s) => s.categoryId === id)).length;
}

function render() {
  const ps = st.parents(kind);
  let html = `<header class="top"><button type="button" class="iconbtn" data-act="back" aria-label="Back">${icon('back')}</button><div class="top-t"><h1>Categories</h1></div>
    <div class="top-r"><button type="button" class="iconbtn" data-act="addGroup" aria-label="Add a group">${icon('plus', 20)}</button></div></header>
    <div class="seg-ctl" style="margin-bottom:12px"><button type="button" class="${kind === 'expense' ? 'on' : ''}" data-act="kind" data-v="expense">Spending</button><button type="button" class="${kind === 'income' ? 'on' : ''}" data-act="kind" data-v="income">Income</button></div>`;
  for (const p of ps) {
    const kids = st.children(p.id);
    html += `<div class="list" style="margin-bottom:10px"><button type="button" class="row" data-act="edit" data-id="${p.id}">${badge(initials(p.name), p.color || 'c0')}<div class="meta"><div class="t">${esc(p.name)}</div><div class="s">${kids.length} inside</div></div>${icon('edit', 16)}</button>
      ${kids.map((c) => `<button type="button" class="row" data-act="edit" data-id="${c.id}" style="padding-left:30px"><span class="dot" style="--b:var(--${esc(p.color || 'c0')})"></span><div class="meta"><div class="t">${esc(c.name)}</div></div><span class="small muted">${uses(c.id) || ''}</span></button>`).join('')}
      <button type="button" class="more-btn" data-act="addChild" data-id="${p.id}">Add a category to ${esc(p.name)}</button></div>`;
  }
  if (!ps.length) html += `<div class="empty">No ${kind === 'income' ? 'income' : 'spending'} categories yet. Tap + to add a group.</div>`;
  return html;
}

function editSheet(c, isNew = false) {
  const draft = { ...c };
  const isParent = !draft.parentId;
  const body = () => `<div class="stack">
    <label><div class="label">Name</div><input class="input" id="c-name" value="${esc(draft.name)}" placeholder="${isParent ? 'e.g. Family' : 'e.g. School fees'}" autocomplete="off"></label>
    ${isParent ? `<div><div class="label" style="margin-bottom:6px">Colour</div><div class="chip-opts">${COLORS.map((k) => `<button type="button" class="chip-opt ${draft.color === k ? 'on' : ''}" data-pick="color:${k}" aria-label="Colour ${k}"><span class="dot" style="--b:var(--${k});width:16px;height:16px;border-radius:5px"></span></button>`).join('')}</div></div>`
      : `<label><div class="label">Group</div><select class="input" id="c-parent">${st.parents(draft.kind).map((p) => `<option value="${p.id}" ${p.id === draft.parentId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>`}
    ${!isNew ? `<div class="row-btns" style="margin-top:0"><button type="button" class="btn" data-pick="up">Move up</button><button type="button" class="btn" data-pick="down">Move down</button></div>` : ''}
    <div class="row-btns">${!isNew ? '<button type="button" class="btn" data-pick="delete">Delete</button>' : ''}<button type="button" class="btn primary" data-pick="save">Save</button></div></div>`;
  openSheet({
    title: isNew ? (isParent ? 'New group' : 'New category') : `Edit ${draft.name}`,
    body: body(),
    onPick: (v) => {
      const name = document.getElementById('c-name').value.trim();
      draft.name = name;
      if (!isParent) draft.parentId = document.getElementById('c-parent').value;
      if (v.startsWith('color:')) {
        draft.color = v.slice(6);
        document.querySelector('#sheet-root .sheet-body').innerHTML = body();
        return true;
      }
      if (v === 'up' || v === 'down') {
        const sibs = isParent ? st.parents(draft.kind) : st.children(draft.parentId);
        const i = sibs.findIndex((x) => x.id === draft.id);
        const j = v === 'up' ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= sibs.length) return true;
        const order = sibs.map((x) => x.id);
        [order[i], order[j]] = [order[j], order[i]];
        st.save('categories', order.map((id, k) => ({ ...st.idx().cat.get(id), order: k })));
        return true;
      }
      if (v === 'delete') { setTimeout(() => remove(c), 0); return false; }
      if (!name) { toast('Give it a name.'); return true; }
      const clash = st.categories(draft.kind).some((x) => x.id !== draft.id && (x.parentId || null) === (draft.parentId || null) && x.name.toLowerCase() === name.toLowerCase());
      if (clash) { toast('There is already one with that name here.'); return true; }
      st.save('categories', draft).then(() => toast('Saved'));
      return false;
    },
  });
}

async function remove(c) {
  if (!c.parentId && st.children(c.id).length) { toast('Move or delete the categories inside this group first.'); return; }
  const n = uses(c.id);
  let target = null;
  if (n) {
    toast(`${n} transaction${n === 1 ? ' uses' : 's use'} ${c.name}. Pick where they should go.`);
    target = await pickCategory({ kind: c.kind, title: `Move ${n} transaction${n === 1 ? '' : 's'} to` });
    if (!target || target === c.id) return;
  } else if (!(await confirmBox(`Delete ${c.name}?`, { ok: 'Delete', danger: true }))) return;
  if (target) {
    const moved = st.txs().filter((t) => t.categoryId === c.id || (t.splits || []).some((s) => s.categoryId === c.id)).map((t) => ({
      ...t, categoryId: t.categoryId === c.id ? target : t.categoryId, splits: t.splits ? t.splits.map((s) => (s.categoryId === c.id ? { ...s, categoryId: target } : s)) : t.splits,
    }));
    await st.save('transactions', moved, { quiet: true });
    await st.save('recurring', st.S.recurring.filter((r) => !r.deleted && r.template.categoryId === c.id).map((r) => ({ ...r, template: { ...r.template, categoryId: target } })), { quiet: true });
    await st.save('memory', st.S.memory.filter((m) => m.categoryId === c.id).map((m) => ({ ...m, categoryId: target })), { quiet: true });
  }
  await st.remove('budgets', st.S.budgets.filter((b) => b.categoryId === c.id).map((b) => b.id), { quiet: true });
  await st.remove('categories', c.id);
  toast(target ? `Moved and deleted ${c.name}` : `Deleted ${c.name}`);
}

export default {
  render,
  parent: '#more',
  actions: {
    kind: (b) => { kind = b.dataset.v; app.refresh(); },
    edit: (b) => editSheet(st.idx().cat.get(b.dataset.id)),
    addGroup: () => editSheet({ kind, name: '', parentId: null, color: COLORS[st.parents(kind).length % 8], order: st.parents(kind).length }, true),
    addChild: (b) => editSheet({ kind, name: '', parentId: b.dataset.id, color: st.idx().cat.get(b.dataset.id)?.color, order: st.children(b.dataset.id).length }, true),
  },
};
