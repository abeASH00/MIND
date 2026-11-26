// Belanja: reads bank and e-wallet notifications and guesses the transaction.
// Plain rules first (free and instant); the AI only helps with messages the rules can't read.

import { parseAmount, tidyName, money, todayISO, nowHM } from './util.js';

const SECURITY = /\b(TAC|OTP)\b|one[- ]time (pin|password|code)|verification code|do not share|jangan kongsi|kod pengesahan|\blog(ged)? ?in\b|new device|password|kata laluan/i;
const PROMO = /\bpromo|voucher|flash sale|\bsale\b|% ?off\b|\bT&C|terms (and|&) conditions|lucky draw|\bcontest\b|\bwin\b|\bdeals?\b|\boffer\b|up to RM|min(imum)?\.? spend|\benjoy\b|\bredeem|free gift|limited time|percuma|tawaran/i;
const DELIVERY = /out for delivery|\bparcel\b|\bshipped\b|has been delivered|order (is|has been) (confirmed|packed)|rider is on the way|penghantaran/i;
const REMINDER = /statement is (now )?ready|e-?statement|bill is (now )?ready|penyata|amount due|due date|payment due|minimum payment|bill reminder|peringatan bil/i;
const CARD_PAID = /received your payment|payment (has been )?received|thank you for your payment|terima kasih atas bayaran/i;

const EXPENSE = /\b(paid|pay|payment|payments|purchase|purchased|spent|charged|debited|deducted|transaction of|you made|pembayaran|dibayar|bayaran|belian)\b/i;
const INCOME = /\b(received|receive|credited|incoming|refund|refunded|deposited|salary|gaji|dikreditkan|diterima|cashback of|cashback received|rebate)\b/i;
const TRANSFER = /\b(transfer|transferred|reload|reloaded|top[- ]?up|topped up|duitnow|pindahan|tambah nilai)\b/i;
const RELOAD = /\b(reload|reloaded|top[- ]?up|topped up|tambah nilai)\b/i;

const AMOUNT = /(?:RM|MYR)\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i;
const CARD4 = /(?:ending(?: with)?|ends? with|card|kad|\*{2,}|x{3,})\s*[:#]?\s*(?:[*x]+)?\s*(\d{4})\b/i;
const MERCHANT = /\b(?:to|at|@|from|merchant:?)\s+([A-Za-z0-9][\w&'’.\-/ ]{1,48}?)(?=\s+(?:on|via|for|using|with|at|ref|reference|is|was|has|dated|txn|trx|\d{1,2}[/-]\d)\b|[.,;!\n]|$)/i;

/* What a merchant name says about the category.
   key: the default category's key; names: fallbacks for categories imported from Bluecoins. */
const KEYWORDS = [
  { key: 'trans.fuel', what: 'a fuel purchase', names: ['Fuel', 'Petrol', 'Gas', 'Minyak'], rx: /petron|shell|petronas|caltex|\bbhp\b|five ?star|\bfuel\b|minyak|petrol/i },
  { key: 'trans.toll', what: 'a toll charge', names: ['Toll', 'Tol'], rx: /\btoll?\b|plus (malaysia|highway)|lebuhraya|\bldp\b|\bnpe\b|\bsprint\b|\bduke\b|smart ?tag|\brfid\b|\bakleh\b|\bkesas\b|\bsilk\b|\bguthrie\b/i },
  { key: 'trans.parking', what: 'parking', names: ['Parking'], rx: /parking|parkir|flexi ?parking|smart selangor|ezpark|jom ?parking/i },
  { key: 'food.takeaway', what: 'food delivery', names: ['Take Away', 'Takeaway', 'Food Delivery'], rx: /grab ?food|food ?panda|shopee ?food|airasia food/i },
  { key: 'trans.ehailing', what: 'an e-hailing ride', names: ['E-hailing', 'Taxi', 'E-hailing & Taxi', 'Grab'], rx: /\bgrab\b(?! ?(food|mart|pay))|airasia ride|\bmaxim\b|\bindrive\b/i },
  { key: 'trans.transit', what: 'public transport', names: ['Public Transport', 'Transit', 'Train'], rx: /\bmrt\b|\blrt\b|rapid ?(kl|bus)|\bktm\b|monorail|\bets\b/i },
  { key: 'food.coffee', what: 'coffee or a snack', names: ['Coffee & Snacks', 'Coffee', 'Snacks'], rx: /starbucks|\bzus\b|tealive|chagee|bask bear|coffee|\bkopi\b|\bcafe|kopitiam|gigi coffee|mixue|chatime/i },
  { key: 'food.dining', what: 'a meal out', names: ['Dining Out', 'Restaurant', 'Restaurants', 'Eating Out', 'Food'], rx: /restoran|restaurant|mamak|\bnasi\b|kedai makan|\bkfc\b|mcdonald|\bmcd\b|burger|pizza|domino|sushi|secret recipe|marrybrown|texas chicken|subway|tomyam|warung|gerai|\bmee\b|\broti\b|food court|selera/i },
  { key: 'food.grocery', what: 'groceries', names: ['Grocery', 'Groceries'], rx: /lotus|tesco|aeon|giant|mydin|jaya grocer|99 ?speed ?mart|kk ?mart|econsave|village grocer|\bnsk\b|hero market|pasar|grocer|lulu|cold storage|speedmart|family ?mart|7-?eleven/i },
  { key: 'util.electricity', what: 'the electricity bill', names: ['Electricity', 'Electric'], rx: /\btnb\b|tenaga|mytnb/i },
  { key: 'util.water', what: 'the water bill', names: ['Water'], rx: /air selangor|syabas|ranhill|indah water|\bsaj\b/i },
  { key: 'util.phone', what: 'a phone or internet bill', names: ['Phone & Internet', 'Internet', 'Phone', 'Mobile'], rx: /unifi|maxis|celcom|\bdigi\b|u ?mobile|time internet|hotlink|tune talk|\bxox\b|redone|astro/i },
  { key: 'util.subs', what: 'a subscription', names: ['Subscriptions', 'Subscription', 'Streaming'], rx: /netflix|spotify|youtube|disney|apple\.com|icloud|google (one|play)|\bviu\b|iqiyi|chatgpt|canva/i },
  { key: 'shop.online', what: 'online shopping', names: ['Online Shopping', 'Online'], rx: /shopee(?! ?food)|lazada|zalora|tiktok shop|taobao|\btemu\b|amazon/i },
  { key: 'shop.household', what: 'household things', names: ['Household', 'Home'], rx: /mr ?diy|ikea|eco ?shop|daiso|harvey norman|courts|senheng/i },
  { key: 'health.pharmacy', what: 'a pharmacy purchase', names: ['Pharmacy', 'Medicine'], rx: /guardian|watsons|caring|big pharmacy|aa pharmacy|alpro|farmasi|pharmacy/i },
  { key: 'health.clinic', what: 'a clinic visit', names: ['Clinic', 'Medical', 'Doctor'], rx: /klinik|clinic|hospital|dental|pergigian|medical/i },
  { key: 'health.insurance', what: 'insurance', names: ['Insurance', 'Takaful'], rx: /takaful|insurance|prudential|great eastern|\baia\b|allianz|etiqa|zurich/i },
  { key: 'personal.donation', what: 'a donation', names: ['Gifts & Donations', 'Donation', 'Charity', 'Zakat', 'Sedekah'], rx: /zakat|derma|sedekah|infaq|masjid|surau|mosque|donat/i },
];
const INCOME_KEYWORDS = [
  { key: 'inc.salary', what: 'salary', names: ['Salary', 'Gaji'], rx: /salary|gaji|payroll/i },
  { key: 'inc.refund', what: 'a refund or cashback', names: ['Refunds & Cashback', 'Refund', 'Cashback'], rx: /refund|cashback|rebate/i },
  { key: 'inc.interest', what: 'interest or dividends', names: ['Interest & Dividends', 'Interest', 'Dividend'], rx: /interest|dividen|profit paid|hibah/i },
];

const liveAccounts = (accounts) => accounts.filter((a) => !a.deleted && !a.archived);
const names = (a) => [a.name, ...(a.aliases || [])].filter(Boolean).map((x) => x.toLowerCase());
const mentions = (a, lowerText) => names(a).some((n) => n.length > 1 && lowerText.includes(n));

export const normMerchant = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ');

export function categoryByKey(categories, entry) {
  const live = categories.filter((c) => !c.deleted && !c.archived);
  return live.find((c) => c.key === entry.key) || live.find((c) => c.parentId && entry.names.some((n) => n.toLowerCase() === c.name.toLowerCase())) || null;
}

export function guessCategory(text, categories, kind = 'expense') {
  const list = kind === 'income' ? INCOME_KEYWORDS : KEYWORDS;
  for (const k of list) {
    if (!k.rx.test(text)) continue;
    const c = categoryByKey(categories, k);
    if (c) return { category: c, what: k.what };
  }
  return null;
}

export function findAccount(accounts, n) {
  const live = liveAccounts(accounts);
  const text = `${n.title || ''} ${n.text || ''}`;
  const app = String(n.app || '').toLowerCase();
  const card = CARD4.exec(text);
  if (card) {
    const a = live.find((x) => String(x.cardDigits || '').split(/[\s,]+/).includes(card[1]));
    if (a) return a;
  }
  const fromApp = live.filter((a) => (a.notifApps || []).some((x) => x && app.includes(x.toLowerCase())));
  if (fromApp.length === 1) return fromApp[0];
  if (fromApp.length > 1) {
    const cardy = /\b(card|kad|visa|mastercard|credit)\b/i.test(text);
    return fromApp.find((a) => (cardy ? a.type === 'credit' : a.type !== 'credit')) || fromApp[0];
  }
  const lower = text.toLowerCase();
  return live.find((a) => mentions(a, lower)) || null;
}

const junk = (reason) => ({ kind: 'junk', amount: null, merchant: '', accountId: null, toAccountId: null, categoryId: null, confidence: 'high', reason });

// n: { app, title, text, receivedAt }. ctx: { accounts, categories, memory: [{id, name, categoryId, accountId, count}] }
export function parseNotification(n, ctx) {
  const text = [n.title, n.text].filter(Boolean).join(' — ');
  if (SECURITY.test(text)) return junk('Security code or login alert');
  const am = AMOUNT.exec(text);
  if (!am) {
    if (DELIVERY.test(text)) return junk('Delivery update');
    if (PROMO.test(text)) return junk('Promotion, no money moved');
    return junk('No amount in the message');
  }
  if (REMINDER.test(text)) return junk('Bill or statement reminder');
  const amount = Math.abs(parseAmount(am[1]));
  const isE = EXPENSE.test(text);
  const isI = INCOME.test(text);
  const isT = TRANSFER.test(text);
  if (PROMO.test(text) && !(isE || isI || isT)) return junk('Promotion, no money moved');
  if (/up to RM|min(imum)?\.? spend|% ?off/i.test(text) && !/\b(paid|charged|debited|credited|received|transferred)\b/i.test(text)) return junk('Promotion, no money moved');

  const live = liveAccounts(ctx.accounts);
  const src = findAccount(ctx.accounts, n);
  const merchantRaw = (MERCHANT.exec(text.slice(am.index)) || MERCHANT.exec(text) || [])[1] || '';
  const merchant = tidyName(merchantRaw);
  const out = { kind: 'unknown', amount, merchant, accountId: src ? src.id : null, toAccountId: null, categoryId: null, confidence: 'low', reason: '' };

  // Money moving between the user's own accounts.
  const dest = merchantRaw ? live.find((a) => a.id !== (src && src.id) && mentions(a, merchantRaw.toLowerCase())) : null;
  if (CARD_PAID.test(text) && src && src.type === 'credit') {
    Object.assign(out, { kind: 'transfer', accountId: null, toAccountId: src.id, merchant: merchant || 'Card payment' });
    out.reason = 'A payment into your credit card. Pick the account it came from, or skip it if you already saved it from your bank.';
  } else if (isT && dest) {
    Object.assign(out, { kind: 'transfer', toAccountId: dest.id, merchant: merchant || dest.name });
    out.reason = "Money moving between your own accounts, so it isn't counted as spending.";
  } else if (RELOAD.test(text) && src && src.type === 'ewallet') {
    Object.assign(out, { kind: 'transfer', accountId: null, toAccountId: src.id, merchant: merchant || `${src.name} reload` });
    out.reason = `A reload into ${src.name}. Pick the account the money came from.`;
  } else if (isI && !isE) out.kind = 'income';
  else if (isE) out.kind = 'expense';
  else if (isI) out.kind = 'income';

  if (out.kind === 'expense' || out.kind === 'income') {
    const memo = merchant && out.kind === 'expense' ? (ctx.memory || []).find((m) => m.id === normMerchant(merchant)) : null;
    const memoCat = memo && ctx.categories.find((c) => c.id === memo.categoryId && !c.deleted);
    if (memoCat) {
      out.categoryId = memoCat.id;
      if (!out.accountId && memo.accountId) out.accountId = memo.accountId;
      out.reason = `You put ${merchant} under ${memoCat.name} ${memo.count > 1 ? `the last ${memo.count} times` : 'last time'}.`;
      out.fromMemory = true;
    } else {
      const g = guessCategory(`${merchant} ${text}`, ctx.categories, out.kind);
      if (g) {
        out.categoryId = g.category.id;
        out.reason = `Looks like ${g.what}.`;
      } else out.reason = out.kind === 'income' ? 'Money coming in.' : "A payment, but the shop isn't one Belanja knows yet. Pick a category.";
    }
  }
  if (out.kind === 'unknown') out.reason = "Couldn't tell what this is. Check it before saving.";

  let score = 1;
  if (out.kind !== 'unknown') score++;
  if (out.accountId || out.toAccountId) score++;
  if (out.categoryId || out.kind === 'transfer') score++;
  if (out.fromMemory) score++;
  out.confidence = score >= 5 ? 'high' : score >= 4 ? 'medium' : 'low';
  if (!out.accountId && out.kind !== 'transfer') out.reason += ' Pick the account.';
  return out;
}

const dayOf = (ms) => todayISO(new Date(ms));

// Is this the same money showing up twice, or already saved by hand?
export function findDuplicate(item, others, txs) {
  const p = item.parsed;
  if (!p || p.kind === 'junk' || !p.amount) return null;
  const win = 10 * 60 * 1000;
  const twin = others.find(
    (o) => o.id !== item.id && o.parsed && o.parsed.kind !== 'junk' && o.parsed.amount === p.amount &&
      o.receivedAt <= item.receivedAt && item.receivedAt - o.receivedAt <= win,
  );
  if (twin) {
    const mins = Math.max(1, Math.round((item.receivedAt - twin.receivedAt) / 60000));
    return { dupOf: twin.id, reason: `Same ${money(p.amount)} within ${mins} minute${mins > 1 ? 's' : ''} of the ${twin.app || 'other'} message. Probably one purchase showing up twice.` };
  }
  const day = dayOf(item.receivedAt);
  const tx = txs.find((t) => !t.deleted && t.amount === p.amount && t.date === day && t.inboxId !== item.id && (!p.accountId || t.accountId === p.accountId || t.toAccountId === p.accountId));
  if (tx) return { dupTx: tx.id, reason: `You already saved ${money(tx.amount)}${tx.title ? ` for ${tx.title}` : ''} on this day.` };
  return null;
}

// Remember what the user chose for a shop, so next time is automatic.
export function learn(memory, merchant, categoryId, accountId, now = Date.now()) {
  const id = normMerchant(merchant);
  if (!id || !categoryId) return null;
  const old = memory.find((m) => m.id === id);
  const same = old && old.categoryId === categoryId;
  return { id, name: merchant, categoryId, accountId: accountId || (old && old.accountId) || null, count: same ? old.count + 1 : 1, updatedAt: now };
}

// Turns the AI's answer (names) into ids the app uses.
export function catByPath(categories, path) {
  if (!path) return null;
  const [pName, cName] = String(path).split('>').map((s) => s.trim().toLowerCase());
  const live = categories.filter((c) => !c.deleted);
  const parent = live.find((c) => !c.parentId && c.name.toLowerCase() === pName);
  if (cName && parent) return live.find((c) => c.parentId === parent.id && c.name.toLowerCase() === cName) || null;
  return live.find((c) => c.parentId && c.name.toLowerCase() === (cName || pName)) || null;
}
export const accByName = (accounts, name) => (name ? liveAccounts(accounts).find((a) => a.name.toLowerCase() === String(name).toLowerCase()) || null : null);

export function applyAI(parsed, ai, ctx) {
  if (!ai) return parsed;
  if (ai.kind === 'ignore') return { ...junk(ai.reason || 'Not a payment'), byAI: true };
  const kind = ai.kind === 'expense' || ai.kind === 'income' || ai.kind === 'transfer' ? ai.kind : parsed.kind;
  const amount = ai.amount != null ? Math.round(ai.amount * 100) : parsed.amount;
  const acc = accByName(ctx.accounts, ai.account);
  const to = accByName(ctx.accounts, ai.to_account);
  const cat = kind === 'transfer' ? null : catByPath(ctx.categories, ai.category);
  return {
    ...parsed, kind, amount,
    merchant: ai.merchant ? tidyName(ai.merchant) : parsed.merchant,
    accountId: acc ? acc.id : parsed.accountId,
    toAccountId: kind === 'transfer' ? (to ? to.id : parsed.toAccountId) : null,
    categoryId: cat ? cat.id : parsed.categoryId,
    reason: ai.reason ? ai.reason + ' (read by AI)' : parsed.reason,
    confidence: 'medium', byAI: true,
  };
}

// The AI's reading of a receipt photo, as a form the user can check.
export function receiptDraft(ai, ctx) {
  const toSen = (v) => (v == null || isNaN(v) ? 0 : Math.round(Number(v) * 100));
  const items = (ai.items || []).map((it) => ({ name: it.name || '', amount: toSen(it.amount), categoryId: catByPath(ctx.categories, it.category)?.id || null }));
  const acc = accByName(ctx.accounts, ai.account);
  return {
    title: tidyName(ai.merchant || ''),
    date: /^\d{4}-\d{2}-\d{2}$/.test(ai.date || '') ? ai.date : todayISO(),
    time: /^\d{2}:\d{2}$/.test(ai.time || '') ? ai.time : nowHM(),
    amount: toSen(ai.total),
    accountId: acc ? acc.id : null,
    categoryId: catByPath(ctx.categories, ai.category)?.id || items[0]?.categoryId || null,
    items,
    notes: ai.notes || '',
  };
}
