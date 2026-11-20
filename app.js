'use strict';
/* Endo Log — Phase 1 (logging). All data stays on this device in IndexedDB. */

const APP_VERSION = '1.0.0';
const DB_NAME = 'endo-log';
const DB_VERSION = 1;

/* ---------- Defaults ---------- */
const DEFAULT_SYMPTOMS = [
  'Bloating ("endo belly")', 'Fatigue', 'Nausea', 'Diarrhea', 'Constipation',
  'Painful bowel movements', 'Painful urination', 'Painful sex', 'Heavy bleeding',
  'Spotting between periods', 'Headache or migraine', 'Brain fog', 'Low mood',
  'Anxiety', 'Leg or back pain flare'
];
const DEFAULT_TAGS = [
  'Gluten', 'Dairy', 'Red meat', 'Processed meat', 'Fried food', 'Added sugar', 'Alcohol',
  'Caffeine', 'Soy', 'High-FODMAP', 'Spicy', 'Ultra-processed', 'Oily fish', 'Leafy greens',
  'Whole grains', 'Legumes', 'Fruit', 'Nuts and seeds'
];
const BODY_AREAS = [
  ['pelvis_l', 'Pelvis left'], ['pelvis_c', 'Pelvis center'], ['pelvis_r', 'Pelvis right'],
  ['abdomen', 'Lower abdomen'], ['bladder', 'Bladder'], ['legs', 'Legs'], ['shoulder', 'Shoulder'],
  ['back', 'Lower back'], ['rectum', 'Rectum'], ['other', 'Other']
];
const AREA_LABEL = Object.fromEntries(BODY_AREAS);
const PAIN_TYPES = ['Cramping', 'Stabbing', 'Aching', 'Burning', 'Throbbing', 'Pressure'];
const MEALS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snack'], ['drink', 'Drink']];
const FLOWS = [['none', 'None'], ['spotting', 'Spotting'], ['light', 'Light'], ['medium', 'Medium'], ['heavy', 'Heavy']];
const ACTIVITY = [['none', 'None'], ['light', 'Light'], ['moderate', 'Moderate'], ['hard', 'Hard']];
const REASONS = [['pain', 'Pain'], ['hormonal', 'Hormonal'], ['supplement', 'Supplement'], ['other', 'Other']];
const HELPED = [['0', 'No'], ['1', 'A little'], ['2', 'Some'], ['3', 'A lot']];
const DAILY_TYPES = ['symptoms', 'lifestyle', 'cycle'];

const DEFAULT_SETTINGS = {
  symptoms: DEFAULT_SYMPTOMS.slice(),
  tags: DEFAULT_TAGS.slice(),
  meds: [],
  cycleTracking: false,
  reminderTime: '20:00',
  lastBackup: null,
  installDismissed: false
};

/* ---------- State ---------- */
const state = {
  tab: 'today',
  day: todayKey(),
  calMonth: todayKey().slice(0, 7),
  settings: { ...DEFAULT_SETTINGS },
  entries: []
};
let db;
let sheetCtx = null;

/* ---------- Utils ---------- */
function pad(n) { return String(n).padStart(2, '0'); }
function keyOf(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayKey() { return keyOf(new Date()); }
function parseKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(k, n) { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); }
function nowTime() { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? 'am' : 'pm'}`;
}
function fmtDay(k, opts = { weekday: 'long', month: 'long', day: 'numeric' }) {
  return parseKey(k).toLocaleDateString(undefined, opts);
}
function relDay(k) {
  const t = todayKey();
  if (k === t) return 'Today';
  if (k === addDays(t, -1)) return 'Yesterday';
  return fmtDay(k, { weekday: 'long' });
}
function painColor(v) { return `hsl(${Math.round(130 - 13 * v)} 52% ${v >= 5 ? 45 : 38}%)`; }
function painWord(v) {
  if (v === 0) return 'No pain';
  if (v <= 3) return 'Mild';
  if (v <= 6) return 'Moderate';
  if (v <= 9) return 'Severe';
  return 'Worst possible';
}
function labelOf(list, v) { const f = list.find(x => x[0] === v); return f ? f[1] : v; }
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}
function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}
function appUrl() { return location.origin + location.pathname.replace(/index\.html$/, ''); }

/* ---------- Storage ---------- */
function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('entries')) {
        const s = d.createObjectStore('entries', { keyPath: 'id' });
        s.createIndex('date', 'date');
      }
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function idb(storeName, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    let result;
    const r = fn(store);
    if (r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
async function loadAll() {
  state.entries = (await idb('entries', 'readonly', s => s.getAll())) || [];
  const saved = await idb('kv', 'readonly', s => s.get('settings'));
  state.settings = { ...DEFAULT_SETTINGS, ...(saved || {}) };
}
async function saveSettings() { await idb('kv', 'readwrite', s => s.put(state.settings, 'settings')); }
async function putEntry(e) {
  e.updatedAt = new Date().toISOString();
  if (!e.createdAt) e.createdAt = e.updatedAt;
  await idb('entries', 'readwrite', s => s.put(e));
  const i = state.entries.findIndex(x => x.id === e.id);
  if (i >= 0) state.entries[i] = e; else state.entries.push(e);
}
async function deleteEntry(id) {
  await idb('entries', 'readwrite', s => s.delete(id));
  state.entries = state.entries.filter(x => x.id !== id);
}
async function replaceAll(entries, settings) {
  await idb('entries', 'readwrite', s => { s.clear(); entries.forEach(e => s.put(e)); });
  state.entries = entries.slice();
  state.settings = { ...DEFAULT_SETTINGS, ...settings };
  await saveSettings();
}

/* ---------- Queries ---------- */
function entriesOn(day, type) {
  return state.entries
    .filter(e => e.date === day && (!type || e.type === type))
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
}
function loggedDays() { return new Set(state.entries.map(e => e.date)); }
function maxPain(day) {
  const ps = state.entries.filter(e => e.date === day && (e.type === 'pain'));
  return ps.length ? Math.max(...ps.map(p => p.score)) : null;
}
function streak() {
  const days = loggedDays();
  let k = todayKey();
  if (!days.has(k)) k = addDays(k, -1);
  let n = 0;
  while (days.has(k)) { n++; k = addDays(k, -1); }
  return n;
}
function daysSinceBackup() {
  if (!state.settings.lastBackup) return Infinity;
  return (Date.now() - new Date(state.settings.lastBackup).getTime()) / 864e5;
}

/* ---------- Summaries ---------- */
function summarize(e) {
  switch (e.type) {
    case 'pain': {
      const areas = (e.areas || []).map(a => AREA_LABEL[a] || a).join(', ');
      const types = (e.painTypes || []).join(', ').toLowerCase();
      return `<span class="score" style="background:${painColor(e.score)}">${e.score}</span>
        <span>${esc([areas, types].filter(Boolean).join(' · ') || painWord(e.score))}${e.note ? `<br><span class="muted">${esc(e.note)}</span>` : ''}</span>`;
    }
    case 'symptoms': {
      const on = Object.entries(e.ratings || {}).filter(([, v]) => v > 0);
      if (!on.length) return `<span>No symptoms</span>`;
      const w = ['', 'mild', 'moderate', 'severe'];
      return `<span>${on.map(([k, v]) => `<span class="pill">${esc(k)} · ${w[v]}</span>`).join('')}</span>`;
    }
    case 'food':
      return `<span><b>${esc(labelOf(MEALS, e.meal))}</b>${e.text ? ` — ${esc(e.text)}` : ''}<br>${(e.tags || []).map(t => `<span class="pill">${esc(t)}</span>`).join('')}</span>`;
    case 'lifestyle': {
      const p = [];
      if (e.sleepHours != null && e.sleepHours !== '') p.push(`Sleep ${e.sleepHours} h${e.sleepQuality ? ` (${e.sleepQuality}/5)` : ''}`);
      if (e.stress) p.push(`Stress ${e.stress}/5`);
      if (e.activity) p.push(`${labelOf(ACTIVITY, e.activity)} activity${e.activityMin ? ` ${e.activityMin} min` : ''}`);
      return `<span>${esc(p.join(' · ') || 'Logged')}</span>`;
    }
    case 'med':
      return `<span><b>${esc(e.name)}</b>${e.dose ? ` ${esc(e.dose)}` : ''}${e.reason ? ` · ${esc(labelOf(REASONS, e.reason))}` : ''}${e.helped != null && e.helped !== '' ? ` · helped: ${esc(labelOf(HELPED, String(e.helped)).toLowerCase())}` : ''}</span>`;
    case 'bb': {
      const p = [e.kind === 'bowel' ? 'Bowel movement' : 'Urination'];
      if (e.pain) p.push(`pain ${e.pain}/10`);
      if (e.kind === 'bowel' && e.bristol) p.push(`Bristol ${e.bristol}`);
      if (e.urgency) p.push('urgency');
      if (e.blood) p.push('blood seen');
      return `<span>${esc(p.join(' · '))}</span>`;
    }
    case 'cycle':
      return `<span>${esc(labelOf(FLOWS, e.flow))} flow${e.periodStart ? ' · period started' : ''}</span>`;
  }
  return '';
}

/* ---------- Rendering ---------- */
const view = () => document.getElementById('view');
function setTitle(t) { document.getElementById('title').textContent = t; }
function render() {
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
  ({ today: renderToday, history: renderHistory, insights: renderInsights, guide: renderGuide, settings: renderSettings }[state.tab])();
}

const CARDS = [
  { type: 'pain', title: 'Pain', add: 'Add' },
  { type: 'symptoms', title: 'Symptoms check-in', daily: true },
  { type: 'food', title: 'Food & drink', add: 'Add' },
  { type: 'lifestyle', title: 'Sleep, stress, activity', daily: true },
  { type: 'med', title: 'Meds & supplements', add: 'Add' },
  { type: 'bb', title: 'Bowel & bladder', add: 'Add' },
  { type: 'cycle', title: 'Cycle', daily: true, cycleOnly: true }
];

function renderToday() {
  const d = state.day, t = todayKey();
  setTitle(d === t ? 'Today' : 'Log');
  const dayEntries = entriesOn(d);
  const banners = [];
  if (!isStandalone() && !state.settings.installDismissed) {
    banners.push(`<div class="banner"><span>Install: tap <b>Share</b> → <b>Add to Home Screen</b> in Safari.</span><button class="btn small" data-action="dismiss-install">OK</button></div>`);
  }
  if (state.entries.length && daysSinceBackup() > 7) {
    const msg = state.settings.lastBackup ? `Last backup was ${Math.floor(daysSinceBackup())} days ago.` : 'No backup yet.';
    banners.push(`<div class="banner warn"><span>${msg} Save one to iCloud Drive.</span><button class="btn small primary" data-action="backup">Back up</button></div>`);
  }
  if (d === t && dayEntries.length === 0) {
    banners.push(`<div class="banner"><span><b>Not logged yet today.</b> A quick check-in takes a minute.</span></div>`);
  }
  const mp = maxPain(d);
  const s = streak();
  const cards = CARDS.filter(c => !c.cycleOnly || state.settings.cycleTracking).map(c => {
    const list = entriesOn(d, c.type);
    const done = list.length > 0;
    const missing = c.daily && !done && d === t;
    let action;
    if (c.daily) action = done ? `<button class="btn small" data-action="edit" data-id="${list[0].id}">Edit</button>`
      : `<button class="btn small primary" data-action="new" data-type="${c.type}">Log</button>`;
    else action = `<button class="btn small${done ? '' : ' primary'}" data-action="new" data-type="${c.type}">+ ${c.add}</button>`;
    const items = list.map(e => `<li><button data-action="edit" data-id="${e.id}">
        ${c.daily ? '' : `<span class="t">${esc(fmtTime(e.time))}</span>`}${summarize(e)}</button></li>`).join('');
    return `<section class="card${missing ? ' missing' : ''}">
      <div class="card-head"><h3><span class="check${done ? ' done' : ''}">${done ? '✓' : ''}</span>${c.title}</h3>${action}</div>
      ${items ? `<ul class="entries">${items}</ul>` : ''}
    </section>`;
  }).join('');

  view().innerHTML = `
    <div class="daynav">
      <button data-action="day" data-n="-1" aria-label="Previous day">‹</button>
      <div class="dlabel"><strong>${esc(relDay(d))}</strong><span>${esc(fmtDay(d, { month: 'long', day: 'numeric', year: 'numeric' }))}</span></div>
      <button data-action="day" data-n="1" aria-label="Next day" ${d >= t ? 'disabled' : ''}>›</button>
    </div>
    ${banners.join('')}
    <div class="streak">
      <div class="stat"><b>${s}</b><span>day streak</span></div>
      <div class="stat"><b>${loggedDays().size}</b><span>days logged</span></div>
      <div class="stat"><b>${mp == null ? '–' : mp}</b><span>max pain ${d === t ? 'today' : 'this day'}</span></div>
    </div>
    <button class="bigbtn" data-action="new" data-type="pain">+ Log pain ${d === t ? 'now' : ''}</button>
    ${cards}`;
}

function renderHistory() {
  setTitle('History');
  const [y, m] = state.calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const daysIn = new Date(y, m, 0).getDate();
  const lead = first.getDay();
  const t = todayKey();
  const logged = loggedDays();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<button class="blank" tabindex="-1" aria-hidden="true"></button>');
  let monthPain = [], monthLogged = 0;
  for (let d = 1; d <= daysIn; d++) {
    const k = `${y}-${pad(m)}-${pad(d)}`;
    const mp = maxPain(k);
    const has = logged.has(k);
    if (has) monthLogged++;
    if (mp != null) monthPain.push(mp);
    const cyc = state.settings.cycleTracking && entriesOn(k, 'cycle').some(e => e.flow && e.flow !== 'none');
    const cls = [k === t ? 'today' : '', k > t ? 'future' : '', cyc ? 'period' : ''].join(' ');
    const dot = mp != null ? `<span class="dot" style="background:${painColor(mp)}"></span>`
      : has ? `<span class="dot" style="background:var(--muted);opacity:.5"></span>` : `<span class="dot none"></span>`;
    cells.push(`<button class="${cls}" data-action="open-day" data-day="${k}" ${k > t ? 'disabled' : ''} aria-label="${esc(fmtDay(k))}${mp != null ? `, max pain ${mp}` : ''}">${d}${dot}</button>`);
  }
  const avg = monthPain.length ? (monthPain.reduce((a, b) => a + b, 0) / monthPain.length).toFixed(1) : '–';
  const nextDisabled = state.calMonth >= t.slice(0, 7);
  view().innerHTML = `
    <div class="cal-head">
      <button class="btn small" data-action="month" data-n="-1" aria-label="Previous month">‹</button>
      <strong>${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
      <button class="btn small" data-action="month" data-n="1" aria-label="Next month" ${nextDisabled ? 'disabled' : ''}>›</button>
    </div>
    <div class="cal">
      ${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(x => `<div class="dow">${x}</div>`).join('')}
      ${cells.join('')}
    </div>
    <div class="legend">
      <span><i style="background:${painColor(1)}"></i>low pain</span>
      <span><i style="background:${painColor(5)}"></i>moderate</span>
      <span><i style="background:${painColor(9)}"></i>severe</span>
      <span><i style="background:var(--muted);opacity:.5"></i>logged, no pain entry</span>
      ${state.settings.cycleTracking ? '<span><i style="background:var(--period);border-radius:3px"></i>period</span>' : ''}
    </div>
    <div class="streak" style="margin-top:16px">
      <div class="stat"><b>${monthLogged}</b><span>days logged this month</span></div>
      <div class="stat"><b>${avg}</b><span>avg daily max pain</span></div>
    </div>
    <p class="muted small">Tap a day to view or edit it.</p>`;
}

function renderInsights() {
  setTitle('Insights');
  const n = loggedDays().size;
  const goal = 28;
  const t = todayKey();
  const bars = [];
  for (let i = 13; i >= 0; i--) {
    const k = addDays(t, -i);
    const mp = maxPain(k);
    const h = mp == null ? 4 : 8 + mp * 9;
    bars.push(`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
      <div style="height:100px;display:flex;align-items:flex-end;width:100%"><div title="${esc(fmtDay(k))}: ${mp ?? 'no pain logged'}" style="width:100%;height:${h}px;border-radius:5px;background:${mp == null ? 'var(--surface-2)' : painColor(mp)}"></div></div>
      <span class="small muted">${parseKey(k).getDate()}</span></div>`);
  }
  view().innerHTML = `
    <section class="card">
      <div class="card-head"><h3>Pattern finding</h3><span class="muted small">${Math.min(n, goal)} / ${goal} days</span></div>
      <div class="progress"><div style="width:${Math.min(100, n / goal * 100)}%"></div></div>
      <p class="small muted" style="margin:0">${n >= goal ? 'Enough data collected. Food and symptom patterns arrive in the next app update.' : `Keep logging. After about ${goal} days the app can start comparing foods, sleep and stress against pain.`}</p>
    </section>
    <section class="card">
      <div class="card-head"><h3>Max pain, last 14 days</h3></div>
      <div style="display:flex;gap:4px;margin-top:12px">${bars.join('')}</div>
    </section>`;
}

function renderGuide() {
  setTitle('Guide');
  view().innerHTML = `
    <section class="card">
      <h3 style="margin:0 0 6px">Coming in a later update</h3>
      <p class="small" style="margin:0 0 8px">A research-backed list of foods to eat more of and to limit for endometriosis, each with its sources and strength of evidence.</p>
      <p class="small" style="margin:0 0 8px">Once enough days are logged, each item will also show whether her own data agrees, and supplement ideas will be suggested from her patterns.</p>
      <p class="small muted" style="margin:0">Talk with a doctor or dietitian before major diet changes or starting supplements.</p>
    </section>`;
}

function editableList(key, title, placeholder) {
  return `<div class="section-title">${title}</div>
    <div class="list-edit">${state.settings[key].map((v, i) => `<span class="chip">${esc(v)}<button class="link" style="padding:0" data-action="list-remove" data-key="${key}" data-i="${i}" aria-label="Remove ${esc(v)}"><b>×</b></button></span>`).join('') || '<span class="muted small">None yet</span>'}</div>
    <div class="row"><input class="input" id="add-${key}" placeholder="${placeholder}"><button class="btn" style="flex:none" data-action="list-add" data-key="${key}">Add</button></div>`;
}

function renderSettings() {
  setTitle('Settings');
  const s = state.settings;
  const url = appUrl();
  view().innerHTML = `
    ${isStandalone() ? '' : `<section class="card">
      <h3 style="margin:0 0 6px">Install on iPhone</h3>
      <ol class="steps small"><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button.</li><li>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol>
    </section>`}
    <section class="card">
      <h3 style="margin:0 0 6px">Daily reminder</h3>
      <div class="row" style="align-items:center;margin-bottom:8px"><span class="small">Reminder time</span><input type="time" class="input" id="remTime" value="${esc(s.reminderTime)}" style="max-width:140px"></div>
      <ol class="steps small">
        <li>Open the iPhone <b>Reminders</b> app and add a reminder called <b>Log symptoms</b>.</li>
        <li>Tap ⓘ, turn on <b>Date</b> and <b>Time</b>, set it to <b>${esc(fmtTime(s.reminderTime))}</b>, and set <b>Repeat</b> to <b>Daily</b>.</li>
        <li>Paste the app link into the <b>URL</b> field. Tapping it opens the app.</li>
      </ol>
      <button class="btn small" data-action="copy-link">Copy app link</button>
      <p class="small muted" style="margin:8px 0 0;word-break:break-all">${esc(url)}</p>
    </section>
    <section class="card">
      <div class="toggle"><div><b>Cycle tracking</b><div class="small muted">Off while there is no period. Turn on to log flow and see cycle patterns.</div></div>
      <label class="switch"><input type="checkbox" id="cycleToggle" ${s.cycleTracking ? 'checked' : ''}><span></span></label></div>
    </section>
    <section class="card">
      ${editableList('symptoms', 'Symptom checklist', 'Add a symptom')}
      ${editableList('tags', 'Food tags', 'Add a food tag')}
      ${editableList('meds', 'Saved meds & supplements', 'Add a med or supplement')}
    </section>
    <section class="card">
      <h3 style="margin:0 0 6px">Backup & data</h3>
      <p class="small muted" style="margin:0 0 10px">Everything is stored only on this phone. Save backups to iCloud Drive so nothing is lost if the phone is replaced. Last backup: <b>${s.lastBackup ? esc(new Date(s.lastBackup).toLocaleString()) : 'never'}</b>.</p>
      <div class="chips">
        <button class="btn primary" data-action="backup">Back up now</button>
        <button class="btn" data-action="restore">Restore backup</button>
        <button class="btn" data-action="csv">Export CSV</button>
      </div>
      <input type="file" id="restoreFile" accept=".json,application/json" hidden>
      <div class="delete-row" style="text-align:left;margin-top:16px"><button class="btn danger small" data-action="wipe">Delete all data</button></div>
    </section>
    <p class="small muted" style="text-align:center">Endo Log v${APP_VERSION} · ${state.entries.length} entries · Not medical advice.</p>`;
}

/* ---------- Form helpers ---------- */
function seg(name, options, current) {
  return `<div class="seg" data-name="${name}" data-single>${options.map(([v, l]) =>
    `<button type="button" data-val="${esc(v)}" aria-pressed="${String(current) === String(v)}">${esc(l)}</button>`).join('')}</div>`;
}
function chips(name, options, selected = []) {
  return `<div class="chips" data-name="${name}">${options.map(o => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return `<button type="button" class="chip" data-val="${esc(v)}" aria-pressed="${selected.includes(v)}">${esc(l)}</button>`;
  }).join('')}</div>`;
}
const body = () => document.getElementById('sheetBody');
function getSeg(name) { return body().querySelector(`[data-name="${name}"] [aria-pressed="true"]`)?.dataset.val ?? null; }
function getChips(name) { return [...body().querySelectorAll(`[data-name="${name}"] [aria-pressed="true"]`)].map(b => b.dataset.val); }
function val(id) { return body().querySelector('#' + id)?.value ?? ''; }
function timeField(t) { return `<div class="field"><label for="f-time">Time</label><input type="time" class="input" id="f-time" value="${esc(t || nowTime())}"></div>`; }
function noteField(n) { return `<div class="field"><label for="f-note">Note</label><textarea class="input" id="f-note" placeholder="Optional">${esc(n || '')}</textarea></div>`; }
function slider(id, v) {
  return `<div class="painval"><output id="${id}-out" style="background:${painColor(v)}">${v}</output><span class="desc" id="${id}-desc">${painWord(v)}</span></div>
    <input type="range" min="0" max="10" step="1" id="${id}" value="${v}" data-slider aria-label="Pain from 0 to 10">
    <div class="scale-ends"><span>0 none</span><span>10 worst</span></div>`;
}
function bodyMap(sel) {
  const z = (id, shape) => shape.replace('<', `<`).replace(/^<(\w+)/, `<$1 class="zone${sel.includes(id) ? ' on' : ''}" data-zone="${id}"`);
  return `<div class="bodymap">
    <svg viewBox="0 0 150 270" aria-hidden="true">
      <circle class="outline" cx="75" cy="24" r="16"/>
      <path class="outline" d="M58 44 Q75 50 92 44 L118 56 Q124 60 122 70 L112 120 L108 190 L96 262 L80 262 L76 200 L74 200 L70 262 L54 262 L42 190 L38 120 L28 70 Q26 60 32 56 Z"/>
      ${z('shoulder', '<ellipse cx="38" cy="62" rx="11" ry="8"/>')}
      ${z('shoulder', '<ellipse cx="112" cy="62" rx="11" ry="8"/>')}
      ${z('abdomen', '<rect x="46" y="112" width="58" height="26" rx="8"/>')}
      ${z('pelvis_r', '<rect x="44" y="142" width="19" height="26" rx="7"/>')}
      ${z('pelvis_c', '<rect x="65.5" y="142" width="19" height="26" rx="7"/>')}
      ${z('pelvis_l', '<rect x="87" y="142" width="19" height="26" rx="7"/>')}
      ${z('bladder', '<ellipse cx="75" cy="180" rx="11" ry="8"/>')}
      ${z('legs', '<rect x="52" y="200" width="18" height="56" rx="8"/>')}
      ${z('legs', '<rect x="80" y="200" width="18" height="56" rx="8"/>')}
    </svg>
    ${chips('areas', BODY_AREAS, sel)}
  </div>
  <p class="small muted" style="margin:6px 0 0">Front view: her left is on the right side of the picture. Back and rectum are in the list.</p>`;
}
function syncBodyMap() {
  const sel = getChips('areas');
  body().querySelectorAll('[data-zone]').forEach(el => el.classList.toggle('on', sel.includes(el.dataset.zone)));
}

/* ---------- Forms ---------- */
const FORMS = {
  pain: {
    title: 'Pain',
    html: e => `
      <div class="field"><span class="lbl">How bad is the pain?</span>${slider('f-score', e.score ?? 0)}</div>
      <div class="field"><span class="lbl">Where?</span>${bodyMap(e.areas || [])}</div>
      <div class="field"><span class="lbl">What kind?</span>${chips('painTypes', PAIN_TYPES, e.painTypes || [])}</div>
      ${timeField(e.time)}${noteField(e.note)}`,
    collect: () => ({ score: Number(val('f-score')), areas: getChips('areas'), painTypes: getChips('painTypes'), time: val('f-time'), note: val('f-note').trim() })
  },
  symptoms: {
    title: 'Symptoms check-in',
    html: e => {
      const r = e.ratings || {};
      return `<p class="small muted" style="margin:0 0 6px">0 none · 1 mild · 2 moderate · 3 severe</p>
        ${state.settings.symptoms.map((s, i) => `<div class="symrow"><span>${esc(s)}</span>${seg('sym' + i, [['0', '0'], ['1', '1'], ['2', '2'], ['3', '3']], r[s] ?? 0)}</div>`).join('')}
        <div style="height:14px"></div>${noteField(e.note)}`;
    },
    collect: () => {
      const ratings = {};
      state.settings.symptoms.forEach((s, i) => { ratings[s] = Number(getSeg('sym' + i) || 0); });
      return { ratings, note: val('f-note').trim() };
    }
  },
  food: {
    title: 'Food & drink',
    html: e => {
      const h = new Date().getHours();
      const guess = h < 10 ? 'breakfast' : h < 15 ? 'lunch' : h >= 17 && h < 21 ? 'dinner' : 'snack';
      return `<div class="field"><span class="lbl">Meal</span>${seg('meal', MEALS, e.meal || guess)}</div>
        <div class="field"><label for="f-text">What was it?</label><textarea class="input" id="f-text" placeholder="e.g. chicken burrito with cheese, iced coffee">${esc(e.text || '')}</textarea></div>
        <div class="field"><span class="lbl">Tags</span>${chips('tags', state.settings.tags, e.tags || [])}</div>
        ${timeField(e.time)}`;
    },
    collect: () => ({ meal: getSeg('meal') || 'snack', text: val('f-text').trim(), tags: getChips('tags'), time: val('f-time') })
  },
  lifestyle: {
    title: 'Sleep, stress, activity',
    html: e => `
      <div class="field"><label for="f-sleep">Hours slept last night</label><input class="input" id="f-sleep" type="number" inputmode="decimal" min="0" max="24" step="0.5" value="${esc(e.sleepHours ?? '')}" placeholder="e.g. 7.5"></div>
      <div class="field"><span class="lbl">Sleep quality (1 poor – 5 great)</span>${seg('sleepQ', [1, 2, 3, 4, 5].map(n => [String(n), String(n)]), e.sleepQuality ?? '')}</div>
      <div class="field"><span class="lbl">Stress today (1 low – 5 high)</span>${seg('stress', [1, 2, 3, 4, 5].map(n => [String(n), String(n)]), e.stress ?? '')}</div>
      <div class="field"><span class="lbl">Activity</span>${seg('activity', ACTIVITY, e.activity || '')}</div>
      <div class="field"><label for="f-min">Activity minutes</label><input class="input" id="f-min" type="number" inputmode="numeric" min="0" step="5" value="${esc(e.activityMin ?? '')}" placeholder="Optional"></div>
      ${noteField(e.note)}`,
    collect: () => ({
      sleepHours: val('f-sleep') === '' ? null : Number(val('f-sleep')),
      sleepQuality: getSeg('sleepQ') ? Number(getSeg('sleepQ')) : null,
      stress: getSeg('stress') ? Number(getSeg('stress')) : null,
      activity: getSeg('activity'),
      activityMin: val('f-min') === '' ? null : Number(val('f-min')),
      note: val('f-note').trim()
    })
  },
  med: {
    title: 'Med or supplement',
    html: e => `
      <div class="field"><label for="f-name">Name</label><input class="input" id="f-name" list="medlist" value="${esc(e.name || '')}" placeholder="e.g. ibuprofen" autocomplete="off">
        <datalist id="medlist">${state.settings.meds.map(m => `<option value="${esc(m)}">`).join('')}</datalist>
        ${state.settings.meds.length ? `<div style="margin-top:8px">${chips('quickmed', state.settings.meds, [])}</div>` : ''}</div>
      <div class="field"><label for="f-dose">Dose</label><input class="input" id="f-dose" value="${esc(e.dose || '')}" placeholder="e.g. 400 mg"></div>
      <div class="field"><span class="lbl">Taken for</span>${seg('reason', REASONS, e.reason || '')}</div>
      <div class="field"><span class="lbl">Did it help?</span>${seg('helped', HELPED, e.helped ?? '')}</div>
      ${timeField(e.time)}`,
    validate: () => val('f-name').trim() ? null : 'Enter a name',
    collect: () => ({ name: val('f-name').trim(), dose: val('f-dose').trim(), reason: getSeg('reason'), helped: getSeg('helped') == null ? null : Number(getSeg('helped')), time: val('f-time') })
  },
  bb: {
    title: 'Bowel & bladder',
    html: e => `
      <div class="field"><span class="lbl">Type</span>${seg('kind', [['bowel', 'Bowel movement'], ['urine', 'Urination']], e.kind || 'bowel')}</div>
      <div class="field"><span class="lbl">Pain during it</span>${slider('f-bbpain', e.pain ?? 0)}</div>
      <div class="field" id="bristolField"><span class="lbl">Stool type (Bristol 1–7)</span>${seg('bristol', [1, 2, 3, 4, 5, 6, 7].map(n => [String(n), String(n)]), e.bristol ?? '')}
        <p class="small muted" style="margin:6px 0 0">1–2 hard / constipated · 3–4 normal · 5–7 loose / diarrhea</p></div>
      <div class="field"><span class="lbl">Also</span>${chips('flags', [['urgency', 'Urgency'], ['blood', 'Blood seen']], [e.urgency ? 'urgency' : '', e.blood ? 'blood' : ''])}</div>
      ${timeField(e.time)}`,
    collect: () => {
      const f = getChips('flags');
      const kind = getSeg('kind') || 'bowel';
      return { kind, pain: Number(val('f-bbpain')), bristol: kind === 'bowel' && getSeg('bristol') ? Number(getSeg('bristol')) : null, urgency: f.includes('urgency'), blood: f.includes('blood'), time: val('f-time') };
    }
  },
  cycle: {
    title: 'Cycle',
    html: e => `
      <div class="field"><span class="lbl">Flow</span>${seg('flow', FLOWS, e.flow || 'none')}</div>
      <div class="field">${chips('pstart', [['yes', 'Period started today']], e.periodStart ? ['yes'] : [])}</div>`,
    collect: () => ({ flow: getSeg('flow') || 'none', periodStart: getChips('pstart').includes('yes') })
  }
};

/* ---------- Sheet ---------- */
function openSheet(type, entry) {
  const f = FORMS[type];
  const isEdit = !!entry;
  const e = entry || {};
  sheetCtx = { type, entry };
  document.getElementById('sheetTitle').textContent = f.title;
  body().innerHTML = f.html(e) + (isEdit ? `<div class="delete-row"><button type="button" class="btn danger" data-sheet-action="delete">Delete entry</button></div>` : '')
    + `<p class="small muted" style="text-align:center;margin-top:10px">${esc(fmtDay(isEdit ? e.date : state.day))}</p>`;
  const sh = document.getElementById('sheet');
  sh.hidden = false;
  document.body.style.overflow = 'hidden';
  body().scrollTop = 0;
  if (type === 'bb') toggleBristol();
}
function closeSheet() {
  document.getElementById('sheet').hidden = true;
  document.body.style.overflow = '';
  sheetCtx = null;
}
function toggleBristol() {
  const fld = body().querySelector('#bristolField');
  if (fld) fld.hidden = getSeg('kind') !== 'bowel';
}
async function saveSheet() {
  if (!sheetCtx) return;
  const { type, entry } = sheetCtx;
  const f = FORMS[type];
  const err = f.validate && f.validate();
  if (err) { toast(err); return; }
  const data = f.collect();
  const e = entry ? { ...entry, ...data } : { id: uid(), type, date: state.day, ...data };
  await putEntry(e);
  if (type === 'med' && data.name && !state.settings.meds.some(m => m.toLowerCase() === data.name.toLowerCase())) {
    state.settings.meds.push(data.name);
    await saveSettings();
  }
  closeSheet();
  toast('Saved');
  render();
}

/* ---------- Backup / restore / export ---------- */
async function shareOrDownload(filename, text, mime) {
  const file = new File([text], filename, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return true;
    } catch (err) {
      if (err && err.name === 'AbortError') return false;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}
async function backup() {
  const payload = { app: 'endo-log', version: 1, exportedAt: new Date().toISOString(), settings: { ...state.settings, lastBackup: null }, entries: state.entries };
  const ok = await shareOrDownload(`endo-log-backup-${todayKey()}.json`, JSON.stringify(payload, null, 1), 'application/json');
  if (ok) {
    state.settings.lastBackup = new Date().toISOString();
    await saveSettings();
    toast('Backup saved');
    render();
  }
}
async function restoreFromFile(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'endo-log' || !Array.isArray(data.entries)) throw new Error('Not an Endo Log backup');
    const when = data.exportedAt ? new Date(data.exportedAt).toLocaleString() : 'unknown date';
    if (!confirm(`Replace everything on this phone with the backup from ${when} (${data.entries.length} entries)?`)) return;
    const keepBackup = state.settings.lastBackup;
    await replaceAll(data.entries, { ...data.settings, lastBackup: keepBackup || data.exportedAt });
    toast('Backup restored');
    render();
  } catch (err) {
    alert('Could not restore: ' + err.message);
  }
}
function csvCell(v) {
  const s = v == null ? '' : Array.isArray(v) ? v.join('; ') : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
async function exportCsv() {
  const cols = ['date', 'time', 'type', 'pain_score', 'areas', 'pain_types', 'meal', 'food', 'tags', 'symptoms', 'flow', 'period_start',
    'med_name', 'dose', 'reason', 'helped', 'sleep_hours', 'sleep_quality', 'stress', 'activity', 'activity_minutes', 'bb_type', 'bristol', 'urgency', 'blood', 'note'];
  const rows = state.entries.slice().sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''))).map(e => {
    const r = { date: e.date, time: e.time, type: e.type, note: e.note };
    if (e.type === 'pain') Object.assign(r, { pain_score: e.score, areas: (e.areas || []).map(a => AREA_LABEL[a] || a), pain_types: e.painTypes });
    if (e.type === 'food') Object.assign(r, { meal: e.meal, food: e.text, tags: e.tags });
    if (e.type === 'symptoms') r.symptoms = Object.entries(e.ratings || {}).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`);
    if (e.type === 'cycle') Object.assign(r, { flow: e.flow, period_start: e.periodStart ? 'yes' : '' });
    if (e.type === 'med') Object.assign(r, { med_name: e.name, dose: e.dose, reason: e.reason, helped: e.helped });
    if (e.type === 'lifestyle') Object.assign(r, { sleep_hours: e.sleepHours, sleep_quality: e.sleepQuality, stress: e.stress, activity: e.activity, activity_minutes: e.activityMin });
    if (e.type === 'bb') Object.assign(r, { bb_type: e.kind, pain_score: e.pain, bristol: e.bristol, urgency: e.urgency ? 'yes' : '', blood: e.blood ? 'yes' : '' });
    return cols.map(c => csvCell(r[c])).join(',');
  });
  await shareOrDownload(`endo-log-${todayKey()}.csv`, [cols.join(','), ...rows].join('\n'), 'text/csv');
}

/* ---------- Events ---------- */
document.addEventListener('click', async ev => {
  const tabBtn = ev.target.closest('.tabbar button');
  if (tabBtn) {
    state.tab = tabBtn.dataset.tab;
    if (state.tab === 'today') state.day = todayKey();
    render(); window.scrollTo(0, 0); return;
  }
  if (ev.target.closest('#settingsBtn')) { state.tab = 'settings'; render(); window.scrollTo(0, 0); return; }

  // Sheet interactions
  if (ev.target.closest('[data-close]')) { closeSheet(); return; }
  if (ev.target.closest('#sheetSave')) { saveSheet(); return; }
  const zone = ev.target.closest('[data-zone]');
  if (zone) {
    const chip = body().querySelector(`[data-name="areas"] [data-val="${zone.dataset.zone}"]`);
    chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'));
    syncBodyMap(); return;
  }
  const segBtn = ev.target.closest('.seg button');
  if (segBtn) {
    const wasOn = segBtn.getAttribute('aria-pressed') === 'true';
    segBtn.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', 'false'));
    const name = segBtn.parentElement.dataset.name;
    // Optional fields can be cleared by tapping the selected option again
    const required = ['meal', 'kind', 'flow'].includes(name) || name.startsWith('sym');
    segBtn.setAttribute('aria-pressed', String(required ? true : !wasOn));
    if (name === 'kind') toggleBristol();
    return;
  }
  const chipBtn = ev.target.closest('.sheet .chips .chip');
  if (chipBtn) {
    const group = chipBtn.parentElement.dataset.name;
    if (group === 'quickmed') {
      body().querySelector('#f-name').value = chipBtn.dataset.val;
      return;
    }
    chipBtn.setAttribute('aria-pressed', String(chipBtn.getAttribute('aria-pressed') !== 'true'));
    if (group === 'areas') syncBodyMap();
    return;
  }
  if (ev.target.closest('[data-sheet-action="delete"]')) {
    if (sheetCtx?.entry && confirm('Delete this entry?')) {
      await deleteEntry(sheetCtx.entry.id);
      closeSheet(); toast('Deleted'); render();
    }
    return;
  }

  // View actions
  const a = ev.target.closest('[data-action]');
  if (!a) return;
  const act = a.dataset.action;
  if (act === 'new') openSheet(a.dataset.type);
  else if (act === 'edit') { const e = state.entries.find(x => x.id === a.dataset.id); if (e) openSheet(e.type, e); }
  else if (act === 'day') {
    const nd = addDays(state.day, Number(a.dataset.n));
    if (nd <= todayKey()) { state.day = nd; render(); }
  }
  else if (act === 'open-day') { state.day = a.dataset.day; state.tab = 'today'; render(); window.scrollTo(0, 0); }
  else if (act === 'month') {
    const [y, m] = state.calMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + Number(a.dataset.n), 1);
    state.calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    render();
  }
  else if (act === 'dismiss-install') { state.settings.installDismissed = true; await saveSettings(); render(); }
  else if (act === 'backup') backup();
  else if (act === 'restore') document.getElementById('restoreFile').click();
  else if (act === 'csv') exportCsv();
  else if (act === 'copy-link') {
    try { await navigator.clipboard.writeText(appUrl()); toast('Link copied'); }
    catch { prompt('Copy this link:', appUrl()); }
  }
  else if (act === 'list-add') {
    const key = a.dataset.key;
    const input = document.getElementById('add-' + key);
    const v = input.value.trim();
    if (v && !state.settings[key].some(x => x.toLowerCase() === v.toLowerCase())) {
      state.settings[key].push(v); await saveSettings(); render();
    }
  }
  else if (act === 'list-remove') {
    const key = a.dataset.key, i = Number(a.dataset.i);
    const v = state.settings[key][i];
    if (confirm(`Remove "${v}"? Past entries keep it.`)) { state.settings[key].splice(i, 1); await saveSettings(); render(); }
  }
  else if (act === 'wipe') {
    if (confirm('Delete ALL entries and settings on this phone? Make a backup first if unsure.') && confirm('This cannot be undone. Delete everything?')) {
      await replaceAll([], {}); toast('All data deleted'); render();
    }
  }
});

document.addEventListener('input', ev => {
  const s = ev.target.closest('[data-slider]');
  if (s) {
    const v = Number(s.value);
    const out = document.getElementById(s.id + '-out');
    out.textContent = v; out.style.background = painColor(v);
    document.getElementById(s.id + '-desc').textContent = painWord(v);
  }
});
document.addEventListener('change', async ev => {
  if (ev.target.id === 'cycleToggle') { state.settings.cycleTracking = ev.target.checked; await saveSettings(); toast(ev.target.checked ? 'Cycle tracking on' : 'Cycle tracking off'); }
  if (ev.target.id === 'remTime') { state.settings.reminderTime = ev.target.value || '20:00'; await saveSettings(); render(); }
  if (ev.target.id === 'restoreFile' && ev.target.files[0]) { await restoreFromFile(ev.target.files[0]); ev.target.value = ''; }
});
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && sheetCtx) closeSheet();
  if (ev.key === 'Enter' && ev.target.id?.startsWith('add-')) {
    ev.preventDefault();
    document.querySelector(`[data-action="list-add"][data-key="${ev.target.id.slice(4)}"]`)?.click();
  }
});
// When the app is reopened on a new day, jump to today.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.tab === 'today' && !sheetCtx) {
    const t = todayKey();
    if (state.day > t || state._lastToday !== t) { state.day = t; state._lastToday = t; render(); }
  }
});

/* ---------- Boot ---------- */
(async function boot() {
  try {
    db = await openDB();
    await loadAll();
    state._lastToday = todayKey();
    render();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch (err) {
    view().innerHTML = `<div class="card"><b>Could not open storage.</b><p class="small">${esc(err.message || err)}</p><p class="small muted">If this is a private browsing window, open the app normally.</p></div>`;
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
