// popup.js — berkomunikasi dengan content script di tab threads.com.
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const delayInput = document.getElementById('delay');
const idleScrollInput = document.getElementById('idleScroll');
const modeInputs = [...document.querySelectorAll('input[name="mode"]')];
const statusText = document.getElementById('statusText');
const statusDot = document.getElementById('statusDot');
const countEl = document.getElementById('count');
const logBox = document.getElementById('logBox');
const clearLogBtn = document.getElementById('clearLogBtn');
const diagBtn = document.getElementById('diagnoseBtn');
const dumpBtn = document.getElementById('dumpBtn');
const pinBtn = document.getElementById('pinBtn');
const verifyBtn = document.getElementById('verifyBtn');
const failedNote = document.getElementById('failedNote');
const skipNote = document.getElementById('skipNote');
const patternsBox = document.getElementById('patternsBox');
const patternFields = document.getElementById('patternFields');
const savePatternsBtn = document.getElementById('savePatternsBtn');
const resetPatternsBtn = document.getElementById('resetPatternsBtn');
const patternsStatus = document.getElementById('patternsStatus');
const versionEl = document.getElementById('versionText');
const csVersionEl = document.getElementById('csVersionText');

let running = false;

const OLD_SCRIPT_NOTE =
  '(content script versi lama tanpa log — reload extension di chrome://extensions lalu REFRESH tab threads.com)';
const NO_SCRIPT_NOTE =
  '(tidak ada content script — reload extension di chrome://extensions lalu refresh tab threads.com)';

// ---------------------------------------------------------------------------
// Versi — dibaca langsung dari manifest.json (chrome.runtime.getManifest()),
// jadi badge tidak perlu di-update manual: cukup naikkan "version" di
// manifest.json dan popup otomatis menampilkan versi baru.
// ---------------------------------------------------------------------------
const EXT_VERSION = (() => {
  try { return chrome.runtime.getManifest().version; } catch (e) { return null; }
})();

function renderExtVersion() {
  versionEl.textContent = EXT_VERSION ? 'v' + EXT_VERSION : 'v?';
  versionEl.title = EXT_VERSION
    ? 'Versi extension ini (dari manifest.json): ' + EXT_VERSION
    : 'Versi extension tidak terbaca';
}

// Versi content script yang jalan di tab aktif. Bila berbeda dengan versi
// extension (atau content script lama belum mengirim versi), badge diberi
// peringatan: extension di-reload tapi tab belum di-refresh.
function renderContentVersion(v) {
  const mismatch = !v || (!!EXT_VERSION && v !== EXT_VERSION);
  csVersionEl.textContent = v ? 'content v' + v : 'content v?';
  csVersionEl.classList.toggle('muted', !mismatch);
  csVersionEl.classList.toggle('warn', mismatch);
  csVersionEl.title = !v
    ? 'Content script di tab ini belum mengirim versi (versi lama) — reload extension di chrome://extensions lalu refresh tab threads.com'
    : mismatch
      ? 'Content script di tab ini v' + v + ', extension v' + EXT_VERSION +
        ' — reload extension di chrome://extensions lalu refresh tab threads.com'
      : 'Content script di tab ini sesuai dengan versi extension (v' + v + ')';
}

function renderNoContentScript() {
  csVersionEl.textContent = 'content v—';
  csVersionEl.classList.add('muted');
  csVersionEl.classList.remove('warn');
  csVersionEl.title = 'Content script tidak terdeteksi di tab aktif';
}

renderExtVersion();

// ---------------------------------------------------------------------------
// Pola teks (regex) — panel "Patterns".
// Default: TFR_DEFAULT_PATTERNS di patterns.js. Nilai tersimpan di
// chrome.storage.local (key TFR_STORAGE_KEY) + dikirim ke content script lewat
// pesan SET_PATTERNS, jadi perubahan langsung dipakai tab Threads.
// ---------------------------------------------------------------------------
function storageAvailable() {
  return typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;
}

function buildPatternFields() {
  patternFields.textContent = '';
  TFR_PATTERN_FIELDS.forEach(({ key, label, hint }) => {
    const wrap = document.createElement('div');
    wrap.className = 'pattern-field';

    const lab = document.createElement('label');
    lab.setAttribute('for', 'pat_' + key);
    lab.textContent = label;

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'pat_' + key;
    input.dataset.key = key;
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.dataset.hint = hint || '';
    if (hint) input.title = hint;

    const note = document.createElement('p');
    note.className = 'pattern-hint';
    note.textContent = hint || '';

    wrap.append(lab, input, note);
    patternFields.appendChild(wrap);
  });
}

function patternInputs() {
  return [...patternFields.querySelectorAll('input[data-key]')];
}

function collectPatterns() {
  const out = {};
  patternInputs().forEach((i) => { out[i.dataset.key] = i.value; });
  return out;
}

function fillPatternFields(cfg) {
  const values = tfrNormalizePatterns(cfg);
  patternInputs().forEach((i) => { i.value = values[i.dataset.key] || ''; });
  markInvalidPatterns({});
}

function markInvalidPatterns(errors) {
  patternInputs().forEach((i) => {
    const bad = !!errors[i.dataset.key];
    i.classList.toggle('invalid', bad);
    i.title = bad ? errors[i.dataset.key] : (i.dataset.hint || '');
  });
}

function setPatternsStatus(text, cls = '') {
  patternsStatus.textContent = text;
  patternsStatus.className = 'patterns-status ' + cls;
}

// Kirim pola ke content script di tab aktif (gagal = tab Threads tidak aktif).
async function pushPatternsToTab(cfg) {
  try {
    return await sendToTab('SET_PATTERNS', { patterns: cfg });
  } catch (e) {
    return { ok: false, offline: true };
  }
}

async function savePatterns() {
  const cfg = collectPatterns();
  const check = tfrValidatePatterns(cfg);
  if (!check.ok) {
    patternsBox.open = true; // buka panel supaya field bermasalah kelihatan
    markInvalidPatterns(check.errors);
    setPatternsStatus('✖ ' + (Object.values(check.errors)[0] || 'pola tidak valid'), 'error');
    return false;
  }
  markInvalidPatterns({});
  if (storageAvailable()) {
    try { await chrome.storage.local.set({ [TFR_STORAGE_KEY]: cfg }); } catch (e) { /* ignore */ }
  }
  const resp = await pushPatternsToTab(cfg);
  if (resp && resp.ok) setPatternsStatus('✔ tersimpan & aktif', 'ok');
  else if (resp && resp.offline) setPatternsStatus('✔ tersimpan (buka tab threads.com agar aktif)', 'ok');
  else setPatternsStatus('✖ ditolak content script — cek Debug log', 'error');
  return true;
}

// Muat pola tersimpan, tampilkan di form, lalu dorong ke tab aktif.
async function initPatterns() {
  buildPatternFields();
  let stored = null;
  if (storageAvailable()) {
    try {
      const res = await chrome.storage.local.get(TFR_STORAGE_KEY);
      stored = res && res[TFR_STORAGE_KEY];
    } catch (e) { /* ignore */ }
  }
  fillPatternFields(stored);
  const resp = await pushPatternsToTab(tfrNormalizePatterns(stored));
  if (resp && resp.ok) setPatternsStatus('✔ aktif di tab ini', 'ok');
  else if (resp && resp.offline) setPatternsStatus(stored ? '✔ tersimpan' : 'default', 'ok');
  else setPatternsStatus('✖ ditolak content script', 'error');
}

savePatternsBtn.addEventListener('click', savePatterns);

resetPatternsBtn.addEventListener('click', async () => {
  fillPatternFields(null); // kembali ke default patterns.js
  const ok = await savePatterns();
  if (ok) setPatternsStatus('✔ default dipulihkan', 'ok');
});

initPatterns(); // muat pola tersimpan + dorong ke tab aktif saat popup dibuka

function setStatus(runningNow, text, cls = '') {
  running = runningNow;
  statusText.textContent = text;
  statusDot.className = 'dot ' + cls;
  startBtn.disabled = runningNow;
  stopBtn.disabled = !runningNow;
}

async function sendToTab(type, payload = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) throw new Error('No active tab found.');
  return chrome.tabs.sendMessage(tab.id, { type, ...payload });
}

function renderLog(logs, extraLine = null) {
  if (!Array.isArray(logs)) { logBox.textContent = OLD_SCRIPT_NOTE; return; }
  logBox.textContent =
    logs
      .map((e) => `[${e.t}] ${e.msg}${e.data ? ' ' + JSON.stringify(e.data) : ''}`)
      .join('\n') + (extraLine ? '\n' + extraLine : '');
  logBox.scrollTop = logBox.scrollHeight;
}

function note(msg) { logBox.textContent = msg; }

function selectedMode() {
  const checked = modeInputs.find((i) => i.checked);
  return checked ? checked.value : 'followers';
}

startBtn.addEventListener('click', async () => {
  const delay = Math.max(500, parseInt(delayInput.value, 10) || 1000);
  const idleScrollSecs = Math.max(0, parseInt(idleScrollInput.value, 10) || 0);
  try {
    await sendToTab('START', { delay, mode: selectedMode(), idleScrollSecs, patterns: collectPatterns() });
    setStatus(true, `Removing ${selectedMode() === 'following' ? 'following' : 'followers'}…`, 'running');
    countEl.textContent = '0';
    failedNote.textContent = '';
    skipNote.textContent = '';
  } catch (e) {
    setStatus(false, 'Unable to start — open a Threads tab', 'error');
    note(NO_SCRIPT_NOTE);
  }
});

stopBtn.addEventListener('click', async () => {
  try { await sendToTab('STOP'); } catch (e) { /* ignore */ }
  setStatus(false, 'Idle');
});

clearLogBtn.addEventListener('click', () => { logBox.textContent = ''; });

diagBtn.addEventListener('click', async () => {
  try {
    const resp = await sendToTab('DIAGNOSE');
    renderLog(resp.logs, '[diagnosa] ' + JSON.stringify(resp.diag));
  } catch (e) {
    note(NO_SCRIPT_NOTE);
  }
});

// Dump HTML baris pertama ke log — untuk kalibrasi selector bila masih gagal.
dumpBtn.addEventListener('click', async () => {
  try {
    const resp = await sendToTab('DUMP');
    renderLog(resp.logs, '[dump] cek log di atas untuk HTML baris pertama');
  } catch (e) {
    note(NO_SCRIPT_NOTE);
  }
});

// Recheck — bandingkan angka Removed dengan isi daftar Threads saat ini.
verifyBtn.addEventListener('click', async () => {
  try {
    const resp = await sendToTab('VERIFY');
    renderLog(resp.logs, '[recheck] ' + JSON.stringify(resp.report));
  } catch (e) {
    note(NO_SCRIPT_NOTE);
  }
});

// 📌 Buka popup sebagai jendela terpisah yang tetap terbuka (pinned).
pinBtn.addEventListener('click', async () => {
  const url = chrome.runtime.getURL('popup.html');
  await chrome.windows.create({
    url,
    type: 'popup',
    width: 340,
    height: 620,
    focused: true,
  });
  // Tutup popup-as-popup (jendela baru akan tetap terbuka).
  window.close();
});

// Poll setiap detik selama popup terbuka — log selalu tampil (juga saat idle).
async function poll() {
  try {
    const resp = await sendToTab('STATUS');
    countEl.textContent = resp.count ?? countEl.textContent;
    // Aksi yang diklaim sukses tapi tidak terverifikasi di daftar — tidak dihitung.
    failedNote.textContent = resp.failed ? '· tidak terverifikasi: ' + resp.failed : '';
    // Baris yang sengaja dilewati karena bukan target (tombolnya sudah "Follow").
    skipNote.textContent = resp.notTarget ? '· dilewati (bukan target): ' + resp.notTarget : '';
    if (resp.running) setStatus(true, `Removing ${resp.mode === 'following' ? 'following' : 'followers'}… (${resp.count} done)`, 'running');
    else setStatus(false, 'Idle');
    renderContentVersion(typeof resp.version === 'string' ? resp.version : null);
    renderLog(resp.logs);
  } catch (e) {
    renderNoContentScript();
    if (!running) setStatus(false, 'No Threads tab detected');
  }
  setTimeout(poll, 1000);
}

poll();