// Belanja: first run. Start fresh, bring in Bluecoins history, or try it with example data.

import * as st from '../store.js';
import { icon } from '../icons.js';
import { toast } from '../ui.js';
import { app, go } from '../app.js';

export default {
  render() {
    return `<div class="welcome">
      <h1>Belanja</h1>
      <p class="muted" style="margin:0">Your own money app: accounts, budgets and reports, plus payments read straight from your bank and e-wallet notifications. Everything stays on this phone unless you turn on cloud backup.</p>
      <button type="button" class="choice" data-act="import">${icon('upload', 22)}<span><b>Bring in my Bluecoins history</b><span>Sets up your accounts (RHB, CIMB, TnG, SETEL…) and Malaysian categories, then imports your Bluecoins CSV export.</span></span></button>
      <button type="button" class="choice" data-act="fresh">${icon('plus', 22)}<span><b>Start fresh</b><span>Your accounts and a Malaysian category list, ready to use. Set each balance and go.</span></span></button>
      <button type="button" class="choice" data-act="sample">${icon('spark', 22)}<span><b>Try it with example data</b><span>Three months of made-up spending to look around. Remove it any time in Import & export.</span></span></button>
    </div>`;
  },
  actions: {
    import: async () => { await st.startFresh(); go('#data'); },
    fresh: async () => { await st.startFresh(); toast('Ready. Set your balances in Accounts.'); go('#accounts'); },
    sample: async () => { await st.loadSample(app.today); go('#home'); },
  },
};
