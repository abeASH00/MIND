// Belanja: Import & export. Bring in a Bluecoins export, save CSV files and backups, restore.

import * as st from '../store.js';
import { esc, money, shortDate, todayISO } from '../util.js';
import { analyzeImport, buildImport, FIELD_NAMES, parseDate, exportBluecoins, exportPlain, makeBackup, readBackup } from '../csv.js';
import { icon } from '../icons.js';
import { openSheet, toast, confirmBox, saveFile } from '../ui.js';
import { app, go, baseCur } from '../app.js';

let an = null; // the file being imported, analysed
let fileName = '';
let mapping = null;
let dateFormat = 'MDY';
let tidyDefaults = true;
let busy = false;

const FIELDS = ['date', 'amount', 'type', 'title', 'parent', 'category', 'account', 'accountType', 'toAccount', 'notes', 'labels', 'status', 'split', 'currency', 'rate', 'time'];

function result() {
  try {
    return buildImport(an, { accounts: st.S.accounts, categories: st.S.categories, transactions: st.S.transactions }, { mapping, dateFormat, base: baseCur() });
  } catch (e) {
    return { error: e.message };
  }
}

function unusedDefaults(extraUsed = new Set()) {
  const used = new Set(extraUsed);
  for (const t of st.txs()) { used.add(t.categoryId); for (const s of t.splits || []) used.add(s.categoryId); }
  for (const r of st.S.recurring) if (!r.deleted) used.add(r.template.categoryId);
  for (const b of st.S.budgets) if (!b.deleted) used.add(b.categoryId);
  const kids = st.categories().filter((c) => c.key && c.parentId && !c.importBatch && !used.has(c.id));
  const kidIds = new Set(kids.map((c) => c.id));
  const parents = st.categories().filter((c) => c.key && !c.parentId && !used.has(c.id) && st.children(c.id).every((k) => kidIds.has(k.id)));
  return [...kids, ...parents];
}

function importCard() {
  if (!an) {
    return `<div class="card"><b>From Bluecoins</b>
      <ol class="small muted" style="padding-left:18px;margin:8px 0 12px;display:grid;gap:4px"><li>In Bluecoins, open Settings › Data › Export to CSV and choose all time.</li><li>Save the file to your phone (Downloads or Google Drive).</li><li>Pick it here. You'll see a summary before anything is added.</li></ol>
      <label class="btn primary block" for="imp-file">${icon('upload', 18)}Choose the CSV file</label><input type="file" id="imp-file" accept=".csv,text/csv,text/plain,text/comma-separated-values" hidden>
      <p class="small muted" style="margin:10px 0 0">Other apps' CSV files work too, as long as they have a date and an amount column.</p></div>`;
  }
  const r = result();
  const sample = an.rows.slice(0, 3);
  let html = `<div class="card"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(fileName)}</b><span class="muted small">${an.rows.length} rows</span></div>
    <details style="margin-top:8px"><summary class="small" style="cursor:pointer;color:var(--accent);font-weight:600">Check which column is which</summary><div class="stack" style="margin-top:8px">${FIELDS.map((f) => `<label class="field" style="padding:6px 0;min-height:0;border:0"><span class="k">${esc(FIELD_NAMES[f])}</span><select data-map="${f}" class="input" style="padding:6px 8px"><option value="">Not in file</option>${an.headers.map((h, i) => `<option value="${i}" ${mapping[f] === i ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></label>`).join('')}</div></details>
    <div class="label" style="margin-top:12px">Dates in this file look like</div>
    <div class="seg-ctl" style="margin-top:6px"><button type="button" class="${dateFormat === 'MDY' ? 'on' : ''}" data-act="fmt" data-v="MDY">Month first (3/31)</button><button type="button" class="${dateFormat === 'DMY' ? 'on' : ''}" data-act="fmt" data-v="DMY">Day first (31/3)</button></div>
    <div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Date</th><th>Item</th><th>Amount</th></tr></thead><tbody>${sample
      .map((row) => {
        const d = mapping.date != null ? parseDate(row[mapping.date], dateFormat) : null;
        return `<tr><td>${d ? esc(shortDate(d.date, true)) : '<span style="color:var(--neg)">?</span>'}</td><td style="text-align:left">${esc(mapping.title != null ? row[mapping.title] : '')}</td><td>${esc(mapping.amount != null ? row[mapping.amount] : '')}</td></tr>`;
      })
      .join('')}</tbody></table></div>`;
  if (r.error) return html + `<p style="color:var(--neg)" class="small">${esc(r.error)}</p><div class="row-btns"><button type="button" class="btn" data-act="cancelImp">Choose another file</button></div></div>`;
  const total = r.txs.length;
  html += `<div class="stack small" style="margin-top:12px">
    <div><b>${total}</b> new transaction${total === 1 ? '' : 's'}${r.range ? ` from ${esc(shortDate(r.range.start, true))} to ${esc(shortDate(r.range.end, true))}` : ''}: ${r.counts.e} expenses, ${r.counts.i} income, ${r.counts.t} transfers.</div>
    ${r.skipped ? `<div>${r.skipped} already in Belanja, so they'll be skipped.</div>` : ''}
    ${r.newAccounts.length ? `<div>New accounts: ${r.newAccounts.map((a) => esc(a.name)).join(', ')}.</div>` : '<div>All accounts already exist.</div>'}
    ${r.newCategories.length ? `<div>${r.newCategories.length} new categor${r.newCategories.length === 1 ? 'y' : 'ies'}: ${r.newCategories.filter((c) => c.parentId).slice(0, 8).map((c) => esc(c.name)).join(', ')}${r.newCategories.length > 8 ? '…' : ''}.</div>` : ''}
    ${r.openings.length ? `<div>${r.openings.length} starting balance${r.openings.length === 1 ? '' : 's'} will be set.</div>` : ''}
    ${r.unpaired ? `<div style="color:var(--warm)">${r.unpaired} transfer${r.unpaired === 1 ? ' has' : 's have'} no matching other half. ${r.unpaired === 1 ? 'It' : 'They'}'ll be saved as money in or out of the account only.</div>` : ''}
    ${r.problems.length ? `<div style="color:var(--neg)">${r.problems.length} row${r.problems.length === 1 ? '' : 's'} can't be read and will be left out:<br>${r.problems.slice(0, 4).map(esc).join('<br>')}</div>` : ''}
  </div>`;
  const used = new Set(r.txs.flatMap((t) => [t.categoryId, ...(t.splits || []).map((s) => s.categoryId)]));
  const extra = unusedDefaults(used);
  if (extra.length) html += `<label class="field" style="padding:10px 0;border:0"><span class="v" style="display:grid"><span>Remove starting categories you don't use</span><span class="small muted" style="font-weight:400;white-space:normal">${extra.length} of Belanja's own categories have nothing in them after this import.</span></span><span class="switch"><input type="checkbox" id="imp-tidy" ${tidyDefaults ? 'checked' : ''}><span></span></span></label>`;
  html += `<div class="row-btns"><button type="button" class="btn" data-act="cancelImp">Cancel</button><button type="button" class="btn primary" data-act="doImp" ${total || r.openings.length ? '' : 'disabled'}>${busy ? 'Importing…' : `Import ${total}`}</button></div></div>`;
  return html;
}

function render() {
  const s = st.S.settings;
  let html = `<header class="top"><button type="button" class="iconbtn" data-act="back" aria-label="Back">${icon('back')}</button><div class="top-t"><h1>Import & export</h1></div></header>
    <h2 class="sec">Bring in your history</h2>${importCard()}`;
  if (s.lastImport && !an) html += `<div class="card" style="margin-top:10px"><div class="small">Last import: ${esc(s.lastImport.name)}, ${s.lastImport.count} transactions on ${esc(shortDate(s.lastImport.date, true))}.</div><div class="row-btns"><button type="button" class="btn" data-act="undoImp">Undo that import</button></div></div>`;
  html += `<h2 class="sec">Save a copy</h2><div class="card stack">
      <button type="button" class="btn block" data-act="exp" data-v="plain">${icon('download', 18)}Spreadsheet (CSV)</button>
      <button type="button" class="btn block" data-act="exp" data-v="bc">${icon('download', 18)}For Bluecoins (CSV)</button>
      <button type="button" class="btn block" data-act="exp" data-v="json">${icon('download', 18)}Full backup (everything)</button>
      <p class="small muted" style="margin:0">${s.lastBackupAt ? `Last full backup ${new Date(s.lastBackupAt).toLocaleDateString('en-MY')}.` : 'No full backup yet.'} Keep one in Google Drive now and then.</p></div>
    <h2 class="sec">Restore a backup</h2><div class="card"><p class="small muted" style="margin:0 0 10px">Replaces what's in Belanja with a full backup file. A safety copy of what's here now is saved first.</p>
      <label class="btn block" for="rest-file">${icon('upload', 18)}Choose a backup file</label><input type="file" id="rest-file" accept=".json,application/json" hidden></div>
    <h2 class="sec">Example data</h2><div class="card">${st.hasSample()
      ? '<p class="small muted" style="margin:0 0 10px">Example transactions are mixed in. Remove them before you start for real; your own entries stay.</p><button type="button" class="btn block" data-act="clearSample">Remove example data</button>'
      : '<p class="small muted" style="margin:0 0 10px">Fill Belanja with three months of made-up spending to try things out. You can remove it later.</p><button type="button" class="btn block" data-act="loadSample">Add example data</button>'}</div>
    <h2 class="sec">Start over</h2><div class="card"><p class="small muted" style="margin:0 0 10px">Deletes everything on this phone. Your cloud copy, if you have one, isn't touched.</p><button type="button" class="btn block" data-act="wipe" style="color:var(--neg)">Delete everything</button></div>`;
  return html;
}

function mount(el) {
  el.querySelector('#imp-file')?.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      an = analyzeImport(await f.text());
      fileName = f.name;
      mapping = { ...an.mapping };
      dateFormat = an.dateFormat;
      app.refresh();
    } catch (err) {
      toast(err.message);
    }
  });
  el.querySelectorAll('select[data-map]').forEach((s) => s.addEventListener('change', () => {
    const f = s.dataset.map;
    if (s.value === '') delete mapping[f];
    else mapping[f] = Number(s.value);
    app.refresh();
  }));
  el.querySelector('#imp-tidy')?.addEventListener('change', (e) => { tidyDefaults = e.target.checked; });
  el.querySelector('#rest-file')?.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      const backup = readBackup(await f.text());
      const when = backup.exportedAt ? new Date(backup.exportedAt).toLocaleString('en-MY') : 'an unknown date';
      if (!(await confirmBox(`Replace everything with the backup from ${when}? It has ${backup.transactions.filter((t) => !t.deleted).length} transactions.`, { ok: 'Restore', danger: true }))) return;
      if (!app.demo) await saveFile(`belanja-before-restore-${todayISO()}.json`, makeBackup(st.S, st.S.settings), 'application/json');
      await st.restoreBackup(backup);
      toast('Backup restored');
      go('#home');
    } catch (err) {
      toast(err.message);
    }
  });
}

async function exportFile(kind) {
  if (app.demo) { toast('Saving files is switched off in the demo.'); return; }
  const day = todayISO();
  const data = { accounts: st.S.accounts.filter((a) => !a.deleted), categories: st.S.categories.filter((c) => !c.deleted), transactions: st.txs(), budgets: st.S.budgets.filter((b) => !b.deleted), recurring: st.S.recurring.filter((r) => !r.deleted), memory: st.S.memory };
  let how;
  if (kind === 'plain') how = await saveFile(`belanja-${day}.csv`, exportPlain(data));
  if (kind === 'bc') how = await saveFile(`belanja-for-bluecoins-${day}.csv`, exportBluecoins(data, baseCur()));
  if (kind === 'json') {
    how = await saveFile(`belanja-backup-${day}.json`, makeBackup(data, st.S.settings), 'application/json');
    if (how !== 'cancelled') await st.setSettings({ lastBackupAt: Date.now() }, true);
  }
  if (how === 'downloaded') toast('Saved to your Downloads');
}

export default {
  render,
  mount,
  parent: '#more',
  actions: {
    fmt: (b) => { dateFormat = b.dataset.v; app.refresh(); },
    cancelImp: () => { an = null; app.refresh(); },
    doImp: async () => {
      if (busy) return;
      const r = result();
      if (r.error) return toast(r.error);
      busy = true;
      app.refresh();
      try {
        await st.applyImport(r);
        if (tidyDefaults) {
          const extra = unusedDefaults();
          if (extra.length) await st.remove('categories', extra.map((c) => c.id), { quiet: true });
        }
        await st.setSettings({ onboarded: true, lastImport: { batch: r.batch, name: fileName, count: r.txs.length, date: todayISO() } });
        toast(`Imported ${r.txs.length} transactions`);
        an = null;
        go('#home');
      } finally {
        busy = false;
      }
    },
    undoImp: async () => {
      const li = st.S.settings.lastImport;
      if (!li || !(await confirmBox(`Take out the ${li.count} transactions from ${li.name}?`, { ok: 'Undo import', danger: true }))) return;
      const n = await st.undoImport(li.batch);
      await st.setSettings({ lastImport: null });
      toast(`Removed ${n} transactions`);
    },
    exp: (b) => exportFile(b.dataset.v),
    loadSample: async () => { await st.loadSample(app.today); toast('Example data added'); go('#home'); },
    clearSample: async () => {
      if (!(await confirmBox('Remove all example data? Your own entries stay.', { ok: 'Remove' }))) return;
      await st.clearSample();
      toast('Example data removed');
    },
    wipe: () => {
      openSheet({
        title: 'Delete everything?',
        body: `<p class="muted small">Type DELETE to confirm. This can't be undone on this phone.</p><input class="input" id="wipe-ok" autocomplete="off" autocapitalize="characters"><div class="row-btns"><button type="button" class="btn" data-pick="no">Cancel</button><button type="button" class="btn danger" data-pick="yes">Delete everything</button></div>`,
        onPick: (v) => {
          if (v !== 'yes') return false;
          if (document.getElementById('wipe-ok').value.trim().toUpperCase() !== 'DELETE') { toast('Type DELETE first.'); return true; }
          st.wipeAll().then(() => { toast('Everything deleted'); go('#welcome'); });
          return false;
        },
      });
    },
  },
};

export { money };
