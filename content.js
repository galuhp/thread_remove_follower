/*
 * content.js — otomasi hapus follower & remove following di threads.com.
 *
 * Dua mode (pilih di popup):
 *   - 'followers' : daftar modal "Followers" — hapus orang yang mengikuti kamu.
 *   - 'following' : daftar modal "Following" — unfollow orang yang kamu ikuti.
 *
 * PENTING: di Threads, tombol remove follower / unfollow = "Unfollow".
 * Flow: klik tombol aksi ("Following" / "Follow back") di baris → dialog
 * "Unfollow X?" muncul → klik tombol "Unfollow" = aksi dijalankan.
 * Alternatif: hover → tombol "…" (More) → klik → menu "Unfollow" → konfirmasi.
 * Semua langkah dicatat ke log (popup + console prefix [TFR]).
 */

const CONFIG = {
  menuOpenDelay: 700,   // tunggu menu terbuka setelah klik tombol baris
  removeWait: 700,      // tunggu setelah klik "Remove follower"
  confirmWait: 500,     // tunggu setelah klik konfirmasi
  retryDelay: 2500,     // ulangi scan bila modal tidak terbuka/kosong
};

// Regex pencocokan — sesuaikan bila UI Threads berubah teks/bahasa.
// PENTING: di Threads, tombol remove follower = "Unfollow" (bukan "Remove follower").
const REMOVE_ITEM_RE = /unfollow|remove\s+follower|hapus\s+pengikut/i;
const REMOVE_FALLBACK_RE = /^unfollow$|^remove$|remove\s+follower|hapus/i;
const ACTION_TEXT_RE =
  /^(following|follow back|follows you|follow|mengikuti|ikuti balik|ikuti)$/i;
const MORE_LABEL_RE = /more|titik tiga|three dots|opsi/i;

// Judul modal sesuai mode aktif — followers (hapus pengikut) atau following (unfollow).
const FOLLOWERS_TITLE_RE = /^followers$|^pengikut$/i;
const FOLLOWING_TITLE_RE = /^following$|^mengikuti$/i;

function modalTitleRe() {
  return state.mode === 'following' ? FOLLOWING_TITLE_RE : FOLLOWERS_TITLE_RE;
}
function modalTitle() {
  return state.mode === 'following' ? 'Following' : 'Followers';
}

const state = {
  running: false,
  mode: 'followers', // 'followers' (hapus follower) | 'following' (remove/unfollow yang diikuti)
  delay: 1000,
  count: 0,
  detected: 0,
  logs: [],
  modalMode: '-',
  attempted: new Set(), // username baris yang sudah dicoba (hindari loop)
  idleScrollSecs: 10,   // auto-scroll bila count tidak bertambah dalam N detik (0 = mati)
  lastProgressAt: 0,    // timestamp terakhir count bertambah (untuk watchdog idle)
  watchdogTimer: null,  // interval watchdog stall
  scrollEl: null,       // cache elemen scrollable di modal
};

// Log helper — ring buffer 200 entri, mirror ke console, dikirim ke popup.
function log(msg, data = null) {
  let payload = null;
  if (data !== null) {
    try { payload = JSON.parse(JSON.stringify(data)); }
    catch (e) { payload = { note: 'unserializable' }; }
  }
  state.logs.push({ t: new Date().toLocaleTimeString(), msg, data: payload });
  if (state.logs.length > 200) state.logs.splice(0, state.logs.length - 200);
  try { console.log('%c[TFR] ' + msg, 'color:#2563eb;font-weight:bold', payload ?? ''); } catch (e) {}
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// Scroll modal daftar ke bawah agar baris baru termuat (list Threads virtual).
// ---------------------------------------------------------------------------
function scrollModal(modal) {
  // Pakai elemen scrollable yang di-cache bila masih tersambung di DOM.
  let el = state.scrollEl;
  if (el && !el.isConnected) el = null;
  if (!el) {
    const candidates = [modal, ...[...modal.querySelectorAll('div, section, ul')].filter(isVisible)];
    el = candidates.find((c) => {
      const cs = window.getComputedStyle(c);
      return /auto|scroll|overlay/.test(cs.overflowY) && c.scrollHeight > c.clientHeight + 5;
    }) || null;
    state.scrollEl = el;
  }
  if (!el) return false;
  const before = el.scrollTop;
  el.scrollTop += Math.max(300, Math.round(el.clientHeight)); // turun ±1 layar
  return el.scrollTop !== before;
}

// ---------------------------------------------------------------------------
// Watchdog idle: bila jumlah unfollow tidak bertambah dalam idleScrollSecs
// detik, scroll modal daftar agar baris baru termuat. 0 = mati.
// ---------------------------------------------------------------------------
function startWatchdog() {
  stopWatchdog();
  state.lastProgressAt = Date.now();
  state.watchdogTimer = setInterval(() => {
    if (!state.running || !state.idleScrollSecs) return;
    const idleMs = Date.now() - state.lastProgressAt;
    if (idleMs < state.idleScrollSecs * 1000) return;
    state.lastProgressAt = Date.now(); // tunggu N detik berikutnya sebelum scroll lagi
    const modal = findModal();
    if (!modal) {
      log('Watchdog: modal tidak terbuka — tidak bisa scroll');
      return;
    }
    log('Watchdog: tidak ada unfollow baru dalam ' + state.idleScrollSecs + ' detik — auto-scroll');
    if (!scrollModal(modal)) log('Watchdog: modal tidak bisa discroll (mungkin sudah di dasar list)');
  }, 1000);
}

function stopWatchdog() {
  if (state.watchdogTimer) {
    clearInterval(state.watchdogTimer);
    state.watchdogTimer = null;
  }
}

function isVisible(el) {
  if (!el) return false;
  const cs = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return cs.display !== 'none' && cs.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}

function norm(el) { return ((el && el.textContent) || '').replace(/\s+/g, ' ').trim(); }

// Tutup menu/popover dengan Escape (pemulihan bila menu remove tidak ditemukan).
function pressEscape() {
  const targets = [document.activeElement, document.body, document].filter(Boolean);
  for (const type of ['keydown', 'keyup']) {
    for (const el of targets) {
      el.dispatchEvent(
        new KeyboardEvent(type, { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Deteksi modal Followers & baris
// ---------------------------------------------------------------------------
function findModal() {
  const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')]
    .filter(isVisible);
  for (const d of dialogs) {
    const t = norm(d);
    const imgs = d.querySelectorAll('img').length;
    if (imgs < 2) continue;
    if (state.mode === 'following') {
      // Modal daftar "Following": cari heading berjudul "Following" di dalamnya.
      if (hasHeading(d, FOLLOWING_TITLE_RE)) {
        state.modalMode = 'dialog-baris';
        return d;
      }
    } else if (/followers|pengikut/i.test(t) || imgs >= 5) {
      state.modalMode = imgs >= 5 ? 'dialog-baris' : 'dialog-tab';
      return d;
    }
  }
  // Fallback: container yang memuat heading "Followers"/"Following" (bila role="dialog" tidak ada).
  const h = [...document.querySelectorAll('h1, h2, h3, div, span')]
    .filter(isVisible)
    .find((el) => modalTitleRe().test(norm(el)));
  if (h) {
    let c = h.parentElement;
    while (c && c !== document.body) {
      if (c.querySelectorAll('img').length >= 5) {
        state.modalMode = state.mode === 'following' ? 'heading-following' : 'heading-fallback';
        return c;
      }
      c = c.parentElement;
    }
  }
  state.modalMode = '-';
  return null;
}

// Cek apakah dalam container ada sebuah elemen yang seluruh teksnya sama dengan judul mode.
function hasHeading(container, re) {
  return [...container.querySelectorAll('h1, h2, h3, [role="heading"], div, span')]
    .some((el) => {
      const t = norm(el);
      return t && t.length <= 60 && re.test(t);
    });
}

function findActionButtonsInRow(row) {
  return [...row.querySelectorAll('[role="button"], button')]
    .filter(isVisible)
    .filter((b) => ACTION_TEXT_RE.test(norm(b)))[0] || null;
}

function findRowMoreButton(row, includeHidden = false) {
  const btns = [...row.querySelectorAll('[role="button"], button')];
  const pick = (list) => list.filter((b) => {
    const label = b.getAttribute('aria-label') || '';
    const txt = norm(b);
    return MORE_LABEL_RE.test(label) || txt === '…' || txt === '···' || txt === '...';
  })[0] || null;
  const vis = pick(btns.filter(isVisible));
  if (vis) return vis;
  return includeHidden ? pick(btns) : null;
}

// Ambil baris-baris (container berisi avatar + tombol aksi) DI DALAM modal.
function findRows(modal) {
  const btns = [...modal.querySelectorAll('[role="button"], button')]
    .filter(isVisible)
    .filter((b) => ACTION_TEXT_RE.test(norm(b)));
  const rows = [];
  for (const b of btns) {
    let row = b.closest('[role="listitem"], [role="row"], li') || b.parentElement;
    while (row && row !== document.body && !row.querySelector('img')) row = row.parentElement;
    if (row && row !== document.body && !rows.includes(row) && modal.contains(row)) rows.push(row);
  }
  return rows;
}

function usernameOf(row) {
  const link = row.querySelector('a[href*="/@"]');
  if (link) {
    const m = (link.getAttribute('href') || '').match(/@([^/?#]+)/);
    if (m) return m[1];
  }
  const img = row.querySelector('img[alt]');
  if (img && img.alt) return img.alt;
  return (norm(row).split(' ')[0] || '?').slice(0, 24);
}

// ---------------------------------------------------------------------------
// Diagnosa DOM (dikirim ke tombol Diagnose di popup)
// ---------------------------------------------------------------------------
function diagnose() {
  const modal = findModal();
  const info = {
    modalFollowers: !!modal,
    modeModal: state.modalMode,
    dialogTerlihat: [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')]
      .filter(isVisible).length,
    menuitemDiDokumen: document.querySelectorAll('[role="menuitem"]').length,
  };
  if (modal) {
    info.imgDiModal = modal.querySelectorAll('img').length;
    const rows = findRows(modal);
    info.barisTerlihat = rows.length;
    info.teksTombolAksi = [...modal.querySelectorAll('[role="button"], button')]
      .filter(isVisible).map(norm).filter((t) => t && t.length <= 20).slice(0, 8);
        if (rows.length) {
      const more = findRowMoreButton(rows[0], true);
      info.tombolMoreDiBaris1 = more ? (more.getAttribute('aria-label') || 'teks:…') : null;
      info.usernameBaris1 = usernameOf(rows[0]);
      // Semua tombol di baris 1 — termasuk yang tersembunyi (display:none/visibility:hidden).
      info.tombolDiBaris1 = [...rows[0].querySelectorAll('[role="button"], button')].map((b) => {
        const cs = window.getComputedStyle(b);
        return {
          label: (b.getAttribute('aria-label') || norm(b) || '(kosong)').slice(0, 30),
          display: cs.display,
          visibility: cs.visibility,
          opacity: cs.opacity,
          w: Math.round(parseFloat(cs.width) || 0),
          h: Math.round(parseFloat(cs.height) || 0),
          svg: !!b.querySelector('svg'),
        };
      });
      // Cari elemen tersembunyi di baris (mungkin tombol "…" yang display:none).
      const hidden = [...rows[0].querySelectorAll('[role="button"], button, [aria-label*="more"], [aria-label*="…"]')]
        .filter((b) => {
          const cs = window.getComputedStyle(b);
          return cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0;
        });
      info.elemenTersembunyi = hidden.map((b) => ({
        text: norm(b).slice(0, 30),
        aria: b.getAttribute('aria-label') || '',
        class: (b.getAttribute('class') || '').slice(0, 60),
      }));
    }
    // Semua elemen button visible di dokumen (untuk melihat jika ada tombol di luar modal).
    info.semuaButtonDiDokumen = [...document.querySelectorAll('[role="button"], button')]
      .filter(isVisible)
      .map((b) => (b.getAttribute('aria-label') || norm(b) || '').slice(0, 30));
  }
  log('Diagnosa DOM', info);
  return info;
}

// ---------------------------------------------------------------------------
// Alur remove
// ---------------------------------------------------------------------------
// Cari item menu "Remove follower" di LUAR modal follower (menu muncul via portal).
function findRemoveItem(modal) {
  let hit = [...document.querySelectorAll('[role="menuitem"]')]
    .filter(isVisible)
    .find((el) => REMOVE_ITEM_RE.test(norm(el)));
  if (hit) return hit;

  const containers = [...document.querySelectorAll(
    '[role="menu"], [role="listbox"], [role="popover"], [role="dialog"], [role="alertdialog"]'
  )].filter(isVisible);
  for (const c of containers) {
    if (modal && (c === modal || modal.contains(c))) continue;
    const cands = [...c.querySelectorAll('[role="menuitem"], [role="button"], button, div, span')]
      .filter(isVisible);
    hit = cands.find((el) => {
      const t = norm(el);
      return t && t.length <= 45 && REMOVE_FALLBACK_RE.test(t);
    });
    if (hit) return hit;
  }
  return null;
}

// Dialog konfirmasi "Remove follower?" — klik tombol konfirmasinya bila ada.
async function confirmRemoval() {
  for (const d of [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')]
    .filter(isVisible)) {
    const t = norm(d);
    // Lewati modal list follower (banyak avatar) dan elemen teks panjang.
    if (d.querySelectorAll('img').length >= 5 || t.length >= 400) continue;
    if (!/unfollow|remove|follower|hapus|pengikut/i.test(t)) continue;
    const ok = [...d.querySelectorAll('[role="button"], button')]
      .filter(isVisible)
      .find((b) => {
        const x = norm(b);
        // Tombol "Unfollow" atau "Remove" — bukan "Cancel" / "Batal".
        return x && x.length <= 30 && /^unfollow$|^remove$|remove\s+follower|hapus/i.test(x) && !/^cancel$|^batal$/i.test(x);
      });
    if (ok) {
      log('Klik konfirmasi', { teks: norm(ok) });
      ok.click();
      await sleep(CONFIG.confirmWait);
      return true;
    }
  }
  log('Dialog konfirmasi tidak ditemukan (mungkin tidak perlu konfirmasi)');
  return false;
}

async function clickRemoveItem(item, user) {
  log('Klik menu remove', { user, teks: norm(item).slice(0, 40) });
  item.click();
  await sleep(CONFIG.removeWait);
  await confirmRemoval();
  return true;
}

// Hover baris — tombol "…" di Threads sering hanya tampil saat hover.
function hoverRow(row) {
  const rect = row.getBoundingClientRect();
  const opts = {
    bubbles: true, cancelable: true, view: window,
    clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
  };
  for (const type of ['pointerover', 'mouseover', 'mouseenter']) {
    row.dispatchEvent(new MouseEvent(type, opts));
  }
  // Hover juga avatar/username di dalam baris.
  const inner = row.querySelector('a[href*="/@"], [role="link"], img');
  if (inner) {
    for (const type of ['pointerover', 'mouseover']) {
      inner.dispatchEvent(new MouseEvent(type, opts));
    }
  }
}


// Mode "following": tinggal klik tombol aksi "Following" pada baris → dialog
// "Unfollow X?" → klik tombol "Unfollow". Tidak perlu menu "Remove follower".
async function tryUnfollowFollowing(row, user) {
  const actionBtn = findActionButtonsInRow(row);
  if (actionBtn) {
    log('Klik tombol aksi (remove following)', { user, teks: norm(actionBtn) });
    actionBtn.click();
    await sleep(1000);

    // Dialog "Unfollow X?" muncul → klik tombol "Unfollow".
    const confirmed = await confirmRemoval();
    if (confirmed) {
      log('✔ Berhasil unfollow (remove following)', { user });
      return true;
    }

    // Tidak ada dialog — coba opsi "Unfollow" di menu popover, lalu Escape.
    const item = findRemoveOptionInDoc();
    if (item) return await clickRemoveItem(item, user);
    log('Klik tombol aksi — tidak ada dialog/menu "Unfollow" — Escape', { user });
    pressEscape();
    await sleep(300);
    return false;
  }

  // Tombol aksi tidak terlihat — coba lewat menu "…" (More) seperti mode followers.
  hoverRow(row);
  await sleep(300);
  const more = findRowMoreButton(row, true);
  if (more) {
    log('Klik tombol "…" baris (remove following)', { user });
    more.click();
    await sleep(CONFIG.menuOpenDelay);
    const item = findRemoveOptionInDoc() || findRemoveItem(findModal());
    if (item) return await clickRemoveItem(item, user);
    pressEscape();
    await sleep(250);
  }
  log('Tombol aksi tidak ditemukan untuk remove following', { user });
  return false;
}

async function tryRemoveRow(row) {
  const user = usernameOf(row);

  // Mode "following" punya alur lebih sederhana.
  if (state.mode === 'following') {
    return await tryUnfollowFollowing(row, user);
  }

  // ==================================================================
  // Strategi 1 (utama): hover → cari tombol "…" (More) → klik → cari
  // opsi "Unfollow" di menu → klik → konfirmasi dialog "Unfollow X?".
  // ==================================================================

  // Hover baris — tombol "…" di Threads sering hanya tampil saat hover.
  hoverRow(row);
  await sleep(350);

  // Cari tombol "More" (…, aria-label mengandung "more"), termasuk yang
  // tersembunyi via CSS — klik tetap memicu handler React-nya.
  let more = findRowMoreButton(row, true);

  if (more) {
    const label = (more.getAttribute('aria-label') || norm(more)).replace(/\s+/g, ' ').trim();
    log('Klik tombol "…" baris', { user, label });
    more.click();
    await sleep(CONFIG.menuOpenDelay);

    // Menu bisa muncul di luar modal (React portal) — cari di SELURUH dokumen.
    let item = findRemoveOptionInDoc() || findRemoveItem(findModal());
    if (item) return await clickRemoveItem(item, user);

    // Tunggu lebih lama — menu bisa lambat merender.
    await sleep(600);
    item = findRemoveOptionInDoc();
    if (item) return await clickRemoveItem(item, user);

    // Safety: jika dialog "Unfollow X?" muncul, klik "Unfollow" (remove follower).
    const confirmed = await confirmRemoval();
    if (confirmed) {
      log('Berhasil klik "Unfollow" via menu "…"', { user });
      return true;
    }

    log('Menu "Unfollow" tidak ditemukan setelah klik "…" — Escape', { user });
    pressEscape();
    await sleep(250);
    return false;
  }

  // ==================================================================
  // Strategi 2: klik tombol "Following" → muncul dialog "Unfollow X?"
  // → klik tombol "Unfollow" di dialog (ini = remove follower).
  // ==================================================================
  const followingBtn = row.querySelector('[role="button"]');
  if (followingBtn && /^following$/i.test(norm(followingBtn))) {
    log('Klik tombol "Following" — mencari dialog "Unfollow"', { user });
    followingBtn.click();
    await sleep(1000);

    // Dialog "Unfollow X?" muncul — klik tombol "Unfollow" (remove follower).
    const confirmed = await confirmRemoval();
    if (confirmed) {
      log('Berhasil klik "Unfollow" (remove follower)', { user });
      return true;
    }

    // Jika tidak ada dialog, cari opsi "Unfollow" di menu popover.
    const poItem = findRemoveOptionInDoc();
    if (poItem) {
      log('Ditemukan opsi "Unfollow" di menu popover', { user });
      return await clickRemoveItem(poItem, user);
    }

    // Tunggu lebih lama — menu/dialog bisa lambat merender.
    await sleep(800);
    const poItem2 = findRemoveOptionInDoc();
    if (poItem2) {
      log('Ditemukan opsi "Unfollow" di menu popover (retry)', { user });
      return await clickRemoveItem(poItem2, user);
    }

    log('Klik "Following" — tidak ada dialog atau menu "Unfollow" — Escape', { user });
    pressEscape();
    await sleep(400);
    return false;
  }

  // ==================================================================
  // Strategi 3: klik area kanan baris — tombol "More" mungkin muncul
  // atau ada elemen lain yang bisa diklik.
  // ==================================================================
  log('Coba klik area kanan baris', { user });
  const rect = row.getBoundingClientRect();
  const x = rect.left + rect.width - 12;
  const y = rect.top + rect.height / 2;
  const el = document.elementFromPoint(x, y);
  if (el && el !== row && el.closest('[role="button"]')) {
    const moreRight = el.closest('[role="button"]');
    const label = (moreRight.getAttribute('aria-label') || norm(moreRight)).slice(0, 30);
    log('Klik tombol aksi area kanan baris', { user, label });
    moreRight.click();
    await sleep(CONFIG.menuOpenDelay);
    const item = findRemoveOptionInDoc();
    if (item) return await clickRemoveItem(item, user);
    log('Menu tidak muncul setelah klik area kanan — Escape', { user });
    pressEscape();
    await sleep(250);
    return false;
  }

  // ==================================================================
  // Gagal sepenuhnya — minta dump HTML untuk kalibrasi selector.
  // ==================================================================
  log('Tombol aksi tidak ditemukan di baris (juga setelah hover) — tekan Dump HTML', { user });
  return false;
}

// ==++== Cari opsi "Unfollow" / "Remove follower" di seluruh dokumen (popup/menu popover/dialog) ==++==
function findRemoveOptionInDoc() {
  // Di Threads, tombol remove follower = "Unfollow" (bukan "Remove follower").
  const terms = ['unfollow', 'remove follower', 'hapus pengikut', 'remove from followers', 'hapus follower'];
  // Lintasi semua elemen visible — termasuk di luar modal (portal menu).
  const candidates = [...document.querySelectorAll(
    '[role="menuitem"], [role="button"], button, [role="menuitemradio"], div, span'
  )].filter(isVisible);
  for (const el of candidates) {
    const t = norm(el).toLowerCase();
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    for (const term of terms) {
      if (t.includes(term)) return el;
      if (aria.includes(term)) return el;
    }
    if (REMOVE_ITEM_RE.test(t) || REMOVE_ITEM_RE.test(aria)) return el;
  }
  return null;
}



// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
async function runLoop() {
  if (!state.running) return;
  const modal = findModal();
  if (!modal) {
    log('Modal ' + modalTitle() + ' tidak terbuka — buka dulu daftar ' + modalTitle() + ' di profil');
    setTimeout(runLoop, CONFIG.retryDelay);
    return;
  }
  const rows = findRows(modal);
  state.detected = rows.length;
  // Pilih baris pertama yang BELUM pernah dicoba (hindari loop pada baris yang sama).
  const row = rows.find((r) => !state.attempted.has(usernameOf(r))) || null;
  log('Scan modal', {
    mode: state.modalMode,
    barisTerlihat: rows.length,
    tercoba: state.attempted.size,
    target: row ? usernameOf(row) : null,
  });
  if (!row) {
    if (rows.length > 0) log('Semua baris terlihat sudah dicoba — menunggu baris baru / auto-scroll idle');
    else log('Tidak ada baris terlihat — menunggu scroll agar baris termuat');
    setTimeout(runLoop, CONFIG.retryDelay);
    return;
  }
  try {
    const u = usernameOf(row);
    if (await tryRemoveRow(row)) {
      state.count += 1;
      state.lastProgressAt = Date.now();
      log('✔ Proses remove dikirim (total ' + state.count + ')', { user: u });
    } else {
      log('✖ Remove tidak dikonfirm — skip, coba baris lain', { user: u });
    }
    // Semua baris ditandai "tercoba" — supaya loop tidak stuck di baris yang sama,
    // bahkan bila remove "sukses" tetapi baris belum hilang dari DOM.
    state.attempted.add(u);
    if (state.attempted.size > 300) state.attempted.clear();
  } catch (e) {
    log('Error pada baris', { user: usernameOf(row), pesan: String((e && e.message) || e) });
    state.attempted.add(usernameOf(row));
  }
  await sleep(state.delay);
  if (state.running) runLoop();
}

// ---------------------------------------------------------------------------
// Messaging dari popup
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.type) {
    case 'START': {
      state.running = true;
      state.mode = msg.mode === 'following' ? 'following' : 'followers';
      state.delay = Math.max(500, msg.delay || 1000);
      state.idleScrollSecs = Math.max(0, parseInt(msg.idleScrollSecs, 10) || 0);
      state.lastProgressAt = Date.now();
      state.scrollEl = null;
      state.count = 0;
      state.logs = [];
      state.attempted = new Set();
      log('Mulai — mode ' + state.mode + ', delay ' + state.delay + ' ms' +
          (state.idleScrollSecs ? ', auto-scroll idle ' + state.idleScrollSecs + ' dtk' : ', auto-scroll mati'));
      startWatchdog();
      diagnose();
      runLoop();
      sendResponse({ ok: true, running: true, delay: state.delay });
      break;
    }
    case 'STOP':
      state.running = false;
      stopWatchdog();
      log('Dihentikan oleh pengguna');
      sendResponse({ ok: true, running: false });
      break;
    case 'STATUS':
      sendResponse({
        running: state.running,
        mode: state.mode,
        count: state.count,
        detected: state.detected,
        logs: state.logs,
      });
      break;
    case 'DIAGNOSE': {
      const info = diagnose();
      sendResponse({ ok: true, diag: info, logs: state.logs });
      break;
    }
    case 'DUMP': {
      const modal = findModal();
      if (!modal) {
        log('DUMP: modal Followers tidak terbuka');
      } else {
                const rows = findRows(modal);
        const row = rows[0] || modal;
        const htmlFull = (row.outerHTML || '').replace(/\s+/g, ' ');
        log('DUMP baris pertama', {
          mode: state.modalMode,
          chars: htmlFull.length,
          html: htmlFull.slice(0, 5000),
          semuaTombol: [...row.querySelectorAll('[role="button"], button')].map((b) => {
            const cs = window.getComputedStyle(b);
            return {
              text: norm(b).slice(0, 30),
              aria: b.getAttribute('aria-label') || '',
              display: cs.display,
              visibility: cs.visibility,
              opacity: cs.opacity,
              w: Math.round(parseFloat(cs.width) || 0),
              h: Math.round(parseFloat(cs.height) || 0),
              svg: !!b.querySelector('svg'),
            };
          }),
        });
      }
      sendResponse({ ok: true, logs: state.logs });
      break;
    }
    default:
      sendResponse({ ok: false });
  }
  return false;
});

log('Content script dimuat di threads.com');
diagnose();