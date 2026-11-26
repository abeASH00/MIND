// Belanja: starting categories, the user's accounts, and example data for the demo.

import { uid, addDays, addMonths, parseISO, ymd, seeded, pad } from './util.js';

// Category colours are palette slots (c1..c8), so each theme can pick its own shade.
export const DEFAULT_CATEGORIES = [
  ['expense', 'Food & Drinks', 'food', 'c2', [['Dining Out', 'dining'], ['Take Away', 'takeaway'], ['Grocery', 'grocery'], ['Coffee & Snacks', 'coffee']]],
  ['expense', 'Transportation', 'trans', 'c1', [['Fuel', 'fuel'], ['Toll', 'toll'], ['Parking', 'parking'], ['E-hailing', 'ehailing'], ['Public Transport', 'transit'], ['Car Service', 'service']]],
  ['expense', 'Shopping', 'shop', 'c5', [['Household', 'household'], ['Clothing', 'clothing'], ['Online Shopping', 'online'], ['Electronics', 'electronics']]],
  ['expense', 'Utilities', 'util', 'c3', [['Electricity', 'electricity'], ['Water', 'water'], ['Phone & Internet', 'phone'], ['Subscriptions', 'subs']]],
  ['expense', 'Housing', 'house', 'c4', [['Rent', 'rent'], ['Maintenance', 'maintenance'], ['Assessment Tax', 'tax']]],
  ['expense', 'Debt', 'debt', 'c8', [['Car Loan', 'car'], ['Personal Loan', 'personal'], ['PTPTN', 'ptptn']]],
  ['expense', 'Health', 'health', 'c6', [['Clinic', 'clinic'], ['Pharmacy', 'pharmacy'], ['Insurance', 'insurance']]],
  ['expense', 'Personal', 'personal', 'c7', [['Gifts & Donations', 'donation'], ['Education', 'education'], ['Entertainment', 'fun'], ['Personal Care', 'care'], ['Other', 'other']]],
  ['income', 'Income', 'inc', 'c1', [['Salary', 'salary'], ['Bonus', 'bonus'], ['Side Income', 'side'], ['Refunds & Cashback', 'refund'], ['Interest & Dividends', 'interest'], ['Other Income', 'other']]],
];

export function defaultCategories(now = Date.now()) {
  const out = [];
  let order = 0;
  for (const [kind, name, key, color, kids] of DEFAULT_CATEGORIES) {
    const parent = { id: uid(), kind, name, key, color, parentId: null, order: order++, createdAt: now, updatedAt: now };
    out.push(parent);
    kids.forEach(([cname, ckey], i) => out.push({ id: uid(), kind, name: cname, key: `${key}.${ckey}`, color, parentId: parent.id, order: i, createdAt: now, updatedAt: now }));
  }
  return out;
}

// The accounts the user already has in Bluecoins. aliases and notifApps help the
// notification reader work out which account a message is about.
export const DEFAULT_ACCOUNTS = [
  { name: 'RHB Bank', type: 'bank', aliases: ['rhb'], notifApps: ['rhb'] },
  { name: 'CIMB Bank', type: 'bank', aliases: ['cimb bank', 'cimb'], notifApps: ['cimb'] },
  { name: 'CIMB Petronas Visa-i', type: 'credit', aliases: ['petronas visa', 'visa-i', 'visa i'], notifApps: ['cimb'] },
  { name: 'Affin Bank', type: 'bank', aliases: ['affin'], notifApps: ['affin'] },
  { name: 'TnG', type: 'ewallet', aliases: ['tng', 'touch n go', "touch 'n go", 'touchngo'], notifApps: ['tng', "touch 'n go", 'touch n go'] },
  { name: 'SETEL', type: 'ewallet', aliases: ['setel'], notifApps: ['setel'] },
  { name: 'Wallet', type: 'cash', aliases: ['cash'], notifApps: [] },
];

export function defaultAccounts(now = Date.now()) {
  return DEFAULT_ACCOUNTS.map((a, i) => ({
    id: uid(), currency: 'MYR', rate: 1, opening: 0, netWorth: true, archived: false, order: i, cardDigits: '',
    createdAt: now, updatedAt: now, ...a,
  }));
}

/* ---------------- Example data ----------------
   About three months of believable Malaysian spending, ending today.
   Every record carries sample: true so "Clear example data" can remove it. */

export function makeSample(today, cats, accs, now = Date.now()) {
  const rnd = seeded(20261127);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const amt = (lo, hi, step = 10) => Math.round((lo + rnd() * (hi - lo)) * 100 / step) * step;
  const cat = (key) => cats.find((c) => c.key === key)?.id || null;
  const acc = (name) => accs.find((a) => a.name === name)?.id || null;
  const txs = [];
  const add = (date, type, amount, key, account, title, extra = {}) => {
    if (date > today) return;
    txs.push({
      id: uid(), type, date, time: extra.time || `${pad(8 + Math.floor(rnd() * 13))}:${pad(Math.floor(rnd() * 60))}`,
      amount, accountId: acc(account), categoryId: type === 't' ? null : cat(key), title, notes: extra.notes || '',
      labels: extra.labels || [], status: 'cleared', source: extra.source || 'manual', sample: true, createdAt: now, updatedAt: now,
      ...(extra.to ? { toAccountId: acc(extra.to) } : {}),
    });
  };
  const start = addDays(today, -95);
  const meals = ['Mamak Ali', 'Nasi Kandar Pelita', 'Restoran Rebung', 'Kedai Makan Kak Yah', 'Ayam Gepuk Pak Gembus', 'Sushi King', 'KFC'];
  const groceries = ["Lotus's Setia Alam", 'Mydin', 'Pasar pagi Seksyen 7', '99 Speedmart', 'Jaya Grocer'];
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const { d: day } = parseISO(d);
    if (rnd() < 0.85) add(d, 'e', amt(7, 16, 50), 'food.dining', pick(['TnG', 'Wallet', 'TnG']), pick(meals), { time: `${pad(12 + Math.floor(rnd() * 2))}:${pad(Math.floor(rnd() * 60))}` });
    if (rnd() < 0.35) add(d, 'e', amt(5, 15, 10), 'food.coffee', 'TnG', pick(['ZUS Coffee', 'Tealive', 'Kopi O Mamak']));
    if (rnd() < 0.5) add(d, 'e', amt(2, 12, 10), 'trans.toll', 'TnG', pick(['Toll, LDP', 'Toll, NPE', 'Toll, PLUS']));
    if (rnd() < 0.18) add(d, 'e', amt(55, 220, 10), 'food.grocery', pick(['CIMB Petronas Visa-i', 'Wallet', 'CIMB Bank']), pick(groceries));
    if (rnd() < 0.15) add(d, 'e', amt(40, 70, 100), 'trans.fuel', 'SETEL', pick(['Petron Jalan Kuching', 'Petronas Batu Tiga', 'Shell Setia Alam']));
    if (rnd() < 0.1) add(d, 'e', amt(15, 40, 10), 'food.takeaway', 'TnG', 'GrabFood');
    if (rnd() < 0.06) add(d, 'e', amt(20, 150, 10), 'shop.online', 'CIMB Petronas Visa-i', 'Shopee', { labels: rnd() < 0.3 ? ['family'] : [] });
    if (rnd() < 0.05) add(d, 'e', amt(3, 15, 100), 'trans.parking', 'Wallet', 'Parking');
    if (rnd() < 0.03) add(d, 'e', amt(35, 90, 10), 'health.clinic', 'CIMB Bank', 'Klinik Mediviron');
    if (new Date(d + 'T00:00:00Z').getUTCDay() === 5) add(d, 'e', 500, 'personal.donation', 'Wallet', 'Sedekah Jumaat', { time: '13:40' });
    if (day === 25) add(d, 'i', 480000, 'inc.salary', 'RHB Bank', 'Salary', { time: '09:00' });
    if (day === 1) add(d, 'e', 120000, 'house.rent', 'RHB Bank', 'Rent', { time: '10:00', source: 'recurring' });
    if (day === 3) add(d, 'e', 65000, 'debt.car', 'RHB Bank', 'Car loan', { time: '10:05' });
    if (day === 5) add(d, 'e', 13900, 'util.phone', 'RHB Bank', 'Unifi', { time: '10:10' });
    if (day === 8) add(d, 'e', amt(85, 140, 10), 'util.electricity', 'RHB Bank', 'TNB', { time: '20:15' });
    if (day === 9) add(d, 'e', amt(18, 32, 10), 'util.water', 'RHB Bank', 'Air Selangor', { time: '20:20' });
    if (day === 28) add(d, 'e', 15000, 'debt.ptptn', 'Affin Bank', 'PTPTN', { time: '11:00' });
    if (day === 3 || day === 12 || day === 24) add(d, 't', 20000, null, 'RHB Bank', 'TnG reload', { to: 'TnG' });
    if (day === 12 || day === 26) add(d, 't', 20000, null, 'RHB Bank', 'Cash withdrawal', { to: 'Wallet' });
    if (day === 15) add(d, 't', amt(200, 400, 1000), null, 'CIMB Petronas Visa-i', 'SETEL top-up', { to: 'SETEL' });
    if (day === 20) add(d, 't', 80000, null, 'RHB Bank', 'Card payment', { to: 'CIMB Petronas Visa-i' });
  }
  const openings = { 'RHB Bank': 520000, 'CIMB Bank': 180000, 'CIMB Petronas Visa-i': -42000, 'Affin Bank': 150000, TnG: 6000, SETEL: 4000, Wallet: 15000 };
  const budgets = [
    [null, 280000], ['food', 90000], ['trans', 50000], ['shop', 30000], ['util', 30000],
  ].map(([pkey, amount]) => ({
    id: uid(), categoryId: pkey ? cats.find((c) => c.key === pkey)?.id : null, amount, sample: true, createdAt: now, updatedAt: now,
  }));
  const monthDay = (dd) => {
    const { y, m } = parseISO(start);
    return ymd(y, m, dd);
  };
  const rule = (title, key, account, amount, dd, mode, type = 'e') => ({
    id: uid(), active: true, mode, freq: 'monthly', interval: 1, startDate: monthDay(dd), endDate: null,
    doneThrough: null, sample: true, createdAt: now, updatedAt: now,
    template: { type, title, amount, accountId: acc(account), categoryId: cat(key), toAccountId: null, notes: '', labels: [] },
  });
  const recurring = [
    rule('Rent', 'house.rent', 'RHB Bank', 120000, 1, 'auto'),
    rule('Salary', 'inc.salary', 'RHB Bank', 480000, 25, 'auto', 'i'),
    rule('Unifi', 'util.phone', 'RHB Bank', 13900, 5, 'remind'),
    rule('PTPTN', 'debt.ptptn', 'Affin Bank', 15000, 28, 'remind'),
  ];
  // Mark rules as done up to today, because the example history already holds them.
  for (const r of recurring) r.doneThrough = today;
  const t0 = Date.parse(today + 'T00:00:00') || now;
  const inbox = [
    ['TnG eWallet', 'You have paid RM12.50 to NASI KANDAR PELITA SS2.', 13.2],
    ['SETEL', 'Payment of RM50.00 at Petron Jalan Kuching was successful.', 8.07],
    ['CIMB OCTO', 'CIMB Petronas Visa-i: RM50.00 charged at SETEL PETRON.', 8.08],
    ['RHB Mobile', 'You have transferred RM200.00 to TOUCH N GO EWALLET.', -4],
    ['RHB Mobile', 'Your TAC is 482913. Do not share this number.', -3.9],
    ['CIMB OCTO', 'Enjoy 0% EPP up to 36 months with your CIMB card. T&C apply.', 10.5],
    ['Shopee', '11.11 is back! Grab vouchers up to RM100 off now.', 11],
  ].map(([app, text, hours]) => ({
    id: uid(), app, title: '', text, receivedAt: Math.round(t0 + hours * 3600000), status: 'new', source: 'sample', sample: true, createdAt: now, updatedAt: now,
  }));
  return { transactions: txs, openings, budgets, recurring, inbox };
}

export const SAMPLE_RECEIPT = {
  merchant: "LOTUS'S SETIA ALAM", date: null, time: null, total: 90.3, account: 'CIMB Petronas Visa-i', category: 'Food & Drinks > Grocery',
  items: [
    { name: 'Beras 5kg', amount: 26.9, category: 'Food & Drinks > Grocery' },
    { name: 'Ayam segar 1.2kg', amount: 14.3, category: 'Food & Drinks > Grocery' },
    { name: 'Telur gred A 30s', amount: 13.5, category: 'Food & Drinks > Grocery' },
    { name: 'Sayur campur', amount: 6.8, category: 'Food & Drinks > Grocery' },
    { name: 'Detergent 2.7kg', amount: 18.9, category: 'Shopping > Household' },
    { name: 'Tisu 10s', amount: 9.9, category: 'Shopping > Household' },
  ],
  notes: 'Example receipt',
};

export { addMonths };
