// Belanja: More. Everything that isn't on the tab bar.

import { icon } from '../icons.js';
import { app } from '../app.js';

const ITEMS = [
  ['#accounts', 'wallet', 'Accounts', 'Balances and net worth'],
  ['#reports', 'chart', 'Reports', 'Where the money went'],
  ['#budgets', 'target', 'Budgets', 'Monthly limits'],
  ['#calendar', 'calendar', 'Calendar', 'Spending day by day'],
  ['#bills', 'repeat', 'Bills & repeats', 'Rent, loans, subscriptions'],
  ['#categories', 'tag', 'Categories', 'Add, rename, recolour'],
  ['#receipt', 'receipt', 'Scan a receipt', 'Photo to transaction'],
  ['#data', 'folder', 'Import & export', 'Bluecoins, CSV, backups'],
  ['#prefs', 'sliders', 'Settings', 'Lock, sync, auto-capture'],
];

export default {
  render() {
    return `<header class="top"><div class="top-t"><h1>More</h1>${app.demo ? '<div class="sub">Demo with example data</div>' : ''}</div></header>
      <nav class="menu" aria-label="More">${ITEMS.map(([href, ic, name, sub]) => `<a href="${href}">${icon(ic, 22)}<b>${name}</b><span>${sub}</span></a>`).join('')}</nav>`;
  },
};
