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

let running = false;

const OLD_SCRIPT_NOTE =
  '(content script versi lama tanpa log — reload extension di chrome://extensions lalu REFRESH tab threads.com)';
const NO_SCRIPT_NOTE =
  '(tidak ada content script — reload extension di chrome://extensions lalu refresh tab threads.com)';

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
    await sendToTab('START', { delay, mode: selectedMode(), idleScrollSecs });
    setStatus(true, `Removing ${selectedMode() === 'following' ? 'following' : 'followers'}…`, 'running');
    countEl.textContent = '0';
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
    if (resp.running) setStatus(true, `Removing ${resp.mode === 'following' ? 'following' : 'followers'}… (${resp.count} done)`, 'running');
    else setStatus(false, 'Idle');
    renderLog(resp.logs);
  } catch (e) {
    if (!running) setStatus(false, 'No Threads tab detected');
  }
  setTimeout(poll, 1000);
}

poll();