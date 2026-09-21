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
  verifyWait: 900,      // tunggu re-render daftar sebelum verifikasi hasil
  maxRowAttempts: 2,    // maksimal percobaan "nyata" (ada klik/gagal verifikasi) per baris
  maxSoftAttempts: 6,   // maksimal percobaan "tidak jelas" (tombol/menu belum termuat)
};

// Versi content script — dibaca dari manifest.json saat script di-inject, lalu
// dikirim ke popup (STATUS/DIAGNOSE) supaya popup bisa membandingkan dengan
// versi extension dan mendeteksi content script versi lama yang masih jalan
// di tab (perlu reload extension di chrome://extensions + refresh tab).
const SCRIPT_VERSION = (() => {
  try { return chrome.runtime.getManifest().version; } catch (e) { return null; }
})();

// ---------------------------------------------------------------------------
// Pola teks (regex) pencocokan UI Threads.
// Default-nya ada di patterns.js (dimuat sebelum file ini — lihat manifest.json)
// dan bisa diubah dari popup (panel "Patterns") tanpa mengedit file:
// popup menyimpan ke chrome.storage.local lalu mengirim pesan SET_PATTERNS.
// PENTING: di Threads, tombol remove follower = "Unfollow" (bukan "Remove follower").
// ---------------------------------------------------------------------------
const PATTERNS_READY =
  typeof TFR_DEFAULT_PATTERNS === 'object' && !!TFR_DEFAULT_PATTERNS && typeof tfrBuildRegex === 'function';

// Gagal-tertutup: bila patterns.js tidak termuat, /(?!)/ tidak mencocokkan apa pun
// supaya extension tidak melakukan klik yang salah.
let REMOVE_ITEM_RE = PATTERNS_READY ? tfrBuildRegex(TFR_DEFAULT_PATTERNS.removeItem) : /(?!)/;
let REMOVE_FALLBACK_RE = PATTERNS_READY ? tfrBuildRegex(TFR_DEFAULT_PATTERNS.removeFallback) : /(?!)/;
let ACTION_TEXT_RE = PATTERNS_READY ? tfrBuildRegex(TFR_DEFAULT_PATTERNS.actionFollowers) : /(?!)/;
let MORE_LABEL_RE = PATTERNS_READY ? tfrBuildRegex(TFR_DEFAULT_PATTERNS.moreLabel) : /(?!)/;
// Tombol baris yang berarti "kamu masih following dia" (target mode following).
// Tombol "Follow"/"Follow back" TIDAK boleh diklik di mode ini — itu akan
// menjadikan dia ter-follow kembali.
let STILL_FOLLOWING_RE = PATTERNS_READY ? tfrBuildRegex(TFR_DEFAULT_PATTERNS.actionFollowing) : /(?!)/;

// Judul modal sesuai mode aktif — followers (hapus pengikut) atau following (unfollow).
let FOLLOWERS_TITLE_RE = PATTERNS_READY ? tfrBuildRegex(TFR_DEFAULT_PATTERNS.followersTitle) : /(?!)/;
let FOLLOWING_TITLE_RE = PATTERNS_READY ? tfrBuildRegex(TFR_DEFAULT_PATTERNS.followingTitle) : /(?!)/;

// Kata kunci tambahan saat mencari menu remove (bukan regex).
let REMOVE_TERMS = PATTERNS_READY
  ? TFR_DEFAULT_PATTERNS.removeTerms.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  : [];

// Pola yang sedang aktif (dikirim ke popup & dicatat di log).
function currentPatterns() {
  if (!PATTERNS_READY) return null;
  return {
    actionFollowing: STILL_FOLLOWING_RE.source,
    actionFollowers: ACTION_TEXT_RE.source,
    removeItem: REMOVE_ITEM_RE.source,
    removeFallback: REMOVE_FALLBACK_RE.source,
    removeTerms: REMOVE_TERMS.join(', '),
    moreLabel: MORE_LABEL_RE.source,
    followersTitle: FOLLOWERS_TITLE_RE.source,
    followingTitle: FOLLOWING_TITLE_RE.source,
  };
}

// Terapkan pola dari popup/storage. Pola tidak valid DITOLAK — nilai lama tetap
// dipakai supaya salah ketik tidak membuat extension salah klik.
function applyPatterns(cfg) {
  if (!PATTERNS_READY) {
    return { ok: false, errors: { _: 'patterns.js tidak termuat sebelum content.js' } };
  }
  const next = tfrNormalizePatterns(cfg);
  const check = tfrValidatePatterns(next);
  if (!check.ok) {
    log('Pola DITOLAK — nilai lama tetap dipakai', { errors: check.errors });
    return { ok: false, errors: check.errors };
  }
  REMOVE_ITEM_RE = tfrBuildRegex(next.removeItem);
  REMOVE_FALLBACK_RE = tfrBuildRegex(next.removeFallback);
  ACTION_TEXT_RE = tfrBuildRegex(next.actionFollowers);
  STILL_FOLLOWING_RE = tfrBuildRegex(next.actionFollowing);
  MORE_LABEL_RE = tfrBuildRegex(next.moreLabel);
  FOLLOWERS_TITLE_RE = tfrBuildRegex(next.followersTitle);
  FOLLOWING_TITLE_RE = tfrBuildRegex(next.followingTitle);
  REMOVE_TERMS = next.removeTerms.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  log('Pola teks dipakai', currentPatterns());
  return { ok: true, errors: {} };
}

// Baca pola tersimpan saat content script dimuat — supaya tab ini langsung ikut
// setting terakhir dari popup (tanpa perlu tekan Start dulu).
function loadStoredPatterns() {
  if (!PATTERNS_READY) {
    log('patterns.js tidak termuat — pakai pola gagal-tertutup (tidak ada klik)');
    return;
  }
  try {
    chrome.storage.local.get(TFR_STORAGE_KEY, (res) => {
      if (chrome.runtime.lastError) {
        log('Gagal baca pola dari storage', { pesan: chrome.runtime.lastError.message });
        return;
      }
      const cfg = res && res[TFR_STORAGE_KEY];
      if (!cfg) { log('Pola teks pakai default (belum ada setting tersimpan)'); return; }
      applyPatterns(cfg);
    });
  } catch (e) {
    log('chrome.storage tidak tersedia — pola pakai default', { pesan: String((e && e.message) || e) });
  }
}

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
  count: 0,             // HANYA berisi aksi yang terverifikasi di DOM (lihat verifyRemoved)
  failed: 0,            // aksi yang "diklaim sukses" tetapi tidak terverifikasi di DOM
  detected: 0,
  logs: [],
  modalMode: '-',
  removed: new Set(),   // username yang sudah terverifikasi hilang dari daftar (anti dobel hitung)
  modalEl: null,        // cache elemen modal daftar (lihat findModalCached)
  attempts: new Map(),  // username → percobaan "nyata" (ada aksi / gagal verifikasi)
  softAttempts: new Map(), // username → percobaan "tidak jelas" (tombol/menu belum ada)
  notTarget: new Set(), // baris yang tombolnya sudah bukan "Following" (bukan target)
  runToken: 0,          // token run — loop lama berhenti saat START/STOP baru
  loopActive: false,    // cegah dua loop paralel (dulu bisa dobel-klik / dobel-hitung)
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
    const modal = findModalCached();
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

// Modal daftar dengan CACHE — dipakai loop, verifikasi, dan recheck.
// Cache ini penting: daftar yang hampir kosong (mis. tinggal 1 baris) tidak lagi
// memenuhi syarat findModal() (butuh >= 2 gambar), padahal loop masih perlu
// memverifikasi hasil aksinya. Cache dipakai selama elemennya masih ada di DOM.
function findModalCached() {
  const cached = state.modalEl;
  if (cached && cached.isConnected && isVisible(cached)) return cached;
  const modal = findModal();
  state.modalEl = modal;
  return modal;
}

// Cek apakah dalam container ada sebuah elemen yang seluruh teksnya sama dengan judul mode.
function hasHeading(container, re) {
  return [...container.querySelectorAll('h1, h2, h3, [role="heading"], div, span')]
    .some((el) => {
      const t = norm(el);
      return t && t.length <= 60 && re.test(t);
    });
}

// Teks tombol aksi yang menandai sebuah BARIS daftar — gabungan kedua mode, jadi
// pola custom untuk mode following (STILL_FOLLOWING_RE) juga dipakai saat
// mendeteksi baris, bukan hanya saat memutuskan klik.
function isRowActionText(el) {
  const t = norm(el);
  return ACTION_TEXT_RE.test(t) || STILL_FOLLOWING_RE.test(t);
}

function findActionButtonsInRow(row) {
  return [...row.querySelectorAll('[role="button"], button')]
    .filter(isVisible)
    .filter(isRowActionText)[0] || null;
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
    .filter(isRowActionText);
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
    versi: SCRIPT_VERSION || '?',
    pola: currentPatterns(),
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
  // Jangan klaim sukses sendiri: hasil sebenarnya ditentukan oleh confirmRemoval
  // (dialog konfirmasi) dan verifikasi DOM di runLoop.
  return await confirmRemoval();
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

  // Hanya tombol "Following" yang boleh diklik di mode ini. Bila tombol baris
  // sudah "Follow"/"Follow back", berarti dia sudah tidak kita-follow — klik
  // justru akan membuat dia ter-follow kembali.
  if (actionBtn && !STILL_FOLLOWING_RE.test(norm(actionBtn))) {
    log('⏭ Skip — tombol baris sudah "Follow" (bukan target: dia tidak kamu-follow), tidak diklik', {
      user,
      teks: norm(actionBtn).slice(0, 30),
    });
    state.notTarget.add(user); // dicatat → baris ini dilewati dengan penjelasan (tidak bakar jatah percobaan)
    return false;
  }

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
    const item = findRemoveOptionInDoc() || findRemoveItem(findModalCached());
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
    let item = findRemoveOptionInDoc() || findRemoveItem(findModalCached());
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
// PENTING: hanya elemen yang BENAR-BENAR bisa diklik (menu item / button / link)
// yang dikembalikan. Sebelumnya div/span pembungkus ikut terpilih, kliknya tidak
// melakukan apa pun — tapi tetap dihitung "sukses" (sumber angka dobel).
const CLICKABLE_SEL =
  '[role="menuitem"], [role="menuitemradio"], [role="button"], [role="option"], button, a[href], [tabindex]';

function findRemoveOptionInDoc() {
  // Kata kunci dari pengaturan popup (default: unfollow / remove follower / ...).
  const terms = REMOVE_TERMS;
  const matches = (el) => {
    const t = norm(el).toLowerCase();
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    if (terms.some((term) => t.includes(term) || aria.includes(term))) return true;
    return REMOVE_ITEM_RE.test(t) || REMOVE_ITEM_RE.test(aria);
  };
  const cands = [...document.querySelectorAll(CLICKABLE_SEL)].filter(isVisible).filter(matches);
  if (!cands.length) return null;
  // Pilih teks terpendek (kemungkinan besar tombol/menu item, bukan container besar).
  return cands.sort((a, b) => norm(a).length - norm(b).length)[0];
}



// ---------------------------------------------------------------------------
// Verifikasi & pembatas percobaan
// ---------------------------------------------------------------------------
// Tandai percobaan sebuah baris.
//  'hard' = benar-benar ada aksi/klik (atau error) → dibatasi maxRowAttempts.
//  'soft' = percobaan tidak jelas: tombol aksi / menu belum termuat (mis. baris baru
//           selesai di-render). Ini TIDAK boleh membuat baris ter-skip permanen —
//           dulu baris seperti ini ikut terhitung lalu dilewati (terlihat "lompat").
function markAttempt(user, kind = 'soft') {
  if (!user) return;
  state.attempted.add(user);
  if (state.attempted.size > 300) state.attempted.clear(); // hanya untuk angka di log
  if (kind === 'hard') {
    state.attempts.set(user, (state.attempts.get(user) || 0) + 1);
  } else {
    state.softAttempts.set(user, (state.softAttempts.get(user) || 0) + 1);
  }
}

// Baris masih perlu dicoba? (belum terverifikasi hilang, bukan target yang dilewati,
// dan jatah percobaannya masih ada)
function canTryRow(user) {
  if (!user) return false;
  if (state.removed.has(user)) return false;      // sudah terverifikasi hilang
  if (state.notTarget.has(user)) return false;    // tombolnya "Follow" → bukan target
  if ((state.attempts.get(user) || 0) >= CONFIG.maxRowAttempts) return false;  // gagal nyata
  return (state.softAttempts.get(user) || 0) < CONFIG.maxSoftAttempts;        // belum jelas
}

// Ringkasan alasan baris terlihat TIDAK diproses — dipakai di log supaya jelas
// kenapa daftar seperti "dilompati".
function skipBreakdown(rows) {
  let terverifikasi = 0;
  let bukanTarget = 0;
  let gagal = 0;
  let tidakJelas = 0;
  rows.forEach((r) => {
    const u = usernameOf(r);
    if (state.removed.has(u)) terverifikasi += 1;
    else if (state.notTarget.has(u)) bukanTarget += 1;
    else if ((state.attempts.get(u) || 0) >= CONFIG.maxRowAttempts) gagal += 1;
    else if ((state.softAttempts.get(u) || 0) >= CONFIG.maxSoftAttempts) tidakJelas += 1;
  });
  return { barisTerlihat: rows.length, terverifikasi, bukanTarget, gagal, tidakJelas };
}

// Verifikasi hasil di DOM: aksi baru dihitung bila daftar benar-benar berubah.
// Inilah yang membuat angka "Removed" sama dengan penurunan nyata di Threads —
// bukan sekadar "tombolnya sudah diklik".
// `acted` = apakah kita baru saja mengklik baris ini. Penting: baris yang tombolnya
// memang bukan "Following" (bukan target, mis. "Follow") tidak boleh dihitung
// hanya karena tombolnya "bukan lagi Following".
async function verifyRemoved(user, acted) {
  await sleep(CONFIG.verifyWait);
  const modal = findModalCached();
  if (!modal) return { verified: false, reason: 'modal daftar tidak terbuka saat verifikasi' };
  const rows = findRows(modal).filter((r) => usernameOf(r) === user);
  if (!rows.length) return { verified: true, reason: 'baris sudah hilang dari daftar' };
  if (state.mode === 'following') {
    const masihFollowing = rows.some((r) => {
      const b = findActionButtonsInRow(r);
      return !!b && STILL_FOLLOWING_RE.test(norm(b));
    });
    if (masihFollowing) {
      return { verified: false, reason: 'baris masih ada dengan tombol "Following"' };
    }
    // Baris masih ada tapi tombolnya bukan "Following":
    if (!acted) {
      return {
        verified: false,
        reason: 'tombol baris memang bukan "Following" (bukan target, tidak pernah diklik)',
      };
    }
    return { verified: true, reason: 'tombol baris berubah (bukan lagi "Following")' };
  }
  // Mode followers: selama barisnya masih ada di daftar, dia masih follower.
  return { verified: false, reason: 'baris masih ada di daftar Followers' };
}

// Bandingkan daftar terverifikasi dengan isi daftar SEKARANG (tombol Recheck).
// Berguna untuk memastikan angka Removed cocok dengan kondisi nyata, mis. setelah refresh.
function recheckRemoved() {
  const modal = findModalCached();
  if (!modal) {
    log('Recheck: modal daftar tidak terbuka — buka dulu daftar Followers/Following di profil');
    return { modal: false, terverifikasi: state.removed.size, masihDiDaftar: null };
  }
  const usersInList = new Set(findRows(modal).map(usernameOf));
  const masih = [...state.removed].filter((u) => usersInList.has(u));
  if (masih.length) {
    log('Recheck: ' + masih.length + '/' + state.removed.size + ' akun yang dihitung MASIH ADA di daftar', {
      contoh: masih.slice(0, 10),
    });
  } else {
    log('Recheck: semua ' + state.removed.size + ' akun yang dihitung sudah tidak ada di daftar');
  }
  return {
    modal: true,
    terverifikasi: state.removed.size,
    masihDiDaftar: masih.length,
    contoh: masih.slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
// Satu loop saja: START kedua tidak boleh membuat loop paralel (dua loop paralel
// mengklik baris yang sama dan membuat angka count dobel).
function startLoop() {
  if (state.loopActive) {
    log('Loop sudah berjalan — START kedua diabaikan (mencegah klik & hitung dobel)');
    return;
  }
  state.loopActive = true;
  runLoop();
}

async function runLoop() {
  if (!state.running) { state.loopActive = false; return; }
  const token = state.runToken;
  const modal = findModalCached();
  if (!modal) {
    log('Modal ' + modalTitle() + ' tidak terbuka — buka dulu daftar ' + modalTitle() + ' di profil');
    setTimeout(runLoop, CONFIG.retryDelay);
    return;
  }
  const rows = findRows(modal);
  state.detected = rows.length;
  // Pilih baris yang belum terverifikasi hilang DAN percobaannya belum habis.
  const row = rows.find((r) => canTryRow(usernameOf(r))) || null;
  log('Scan modal', {
    mode: state.modalMode,
    barisTerlihat: rows.length,
    tercoba: state.attempted.size,
    terverifikasi: state.count,
    target: row ? usernameOf(row) : null,
  });
  if (!row) {
    if (rows.length > 0) {
      log('Tidak ada baris baru untuk diproses — rincian baris terlihat', skipBreakdown(rows));
    } else {
      log('Tidak ada baris terlihat — menunggu scroll agar baris termuat');
    }
    setTimeout(runLoop, CONFIG.retryDelay);
    return;
  }
  const u = usernameOf(row);
  try {
    const acted = (await tryRemoveRow(row)) === true; // true = UI mengklaim aksi dikonfirmasi
    if (token !== state.runToken) { state.loopActive = false; return; } // run lama — berhenti
    const check = await verifyRemoved(u, acted);
    if (check.verified) {
      state.removed.add(u);              // unik per akun — tidak mungkin dobel hitung
      state.count = state.removed.size;
      state.lastProgressAt = Date.now();
      markAttempt(u, 'hard');
      log('✔ Terverifikasi (total ' + state.count + ')', { user: u, alasan: check.reason });
    } else if (acted) {
      state.failed += 1;
      markAttempt(u, 'hard');
      log('✖ Diklaim sukses tapi TIDAK terverifikasi — tidak dihitung', {
        user: u,
        alasan: check.reason,
        percobaan: (state.attempts.get(u) || 0) + '/' + CONFIG.maxRowAttempts,
      });
    } else {
      // Tidak ada aksi yang terjadi (tombol/menu belum termuat) → JANGAN bakar jatah
      // percobaan "nyata", cukup catat percobaan "tidak jelas" dan coba lagi nanti.
      markAttempt(u, 'soft');
      log('– Belum ada aksi di baris ini (tombol/menu belum siap) — akan dicoba lagi', {
        user: u,
        alasan: check.reason,
        percobaanTidakJelas: state.softAttempts.get(u) + '/' + CONFIG.maxSoftAttempts,
      });
    }
  } catch (e) {
    log('Error pada baris', { user: u, pesan: String((e && e.message) || e) });
    markAttempt(u, 'hard');
  }
  await sleep(state.delay);
  if (state.running && token === state.runToken) runLoop();
  else state.loopActive = false;
}

// ---------------------------------------------------------------------------
// Messaging dari popup
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.type) {
    case 'START': {
      // Sudah berjalan? ABAIKAN saja — jangan reset counter & jangan buat loop
      // kedua. Dua loop paralel dulu mengklik baris yang sama → angka dobel
      // (kasus "count 89 tapi following cuma turun 44").
      if (state.running) {
        log('START diabaikan — proses sudah berjalan (mencegah dua loop & hitung dobel)');
        sendResponse({ ok: true, running: true, delay: state.delay, ignored: true });
        break;
      }
      state.runToken += 1; // token run baru
      state.running = true;
      // Pola teks terbaru dari popup (bila dikirim) — supaya tab ini ikut setting
      // terakhir walau storage belum sempat terbaca.
      if (msg.patterns) applyPatterns(msg.patterns);
      state.mode = msg.mode === 'following' ? 'following' : 'followers';
      state.delay = Math.max(500, msg.delay || 1000);
      state.idleScrollSecs = Math.max(0, parseInt(msg.idleScrollSecs, 10) || 0);
      state.lastProgressAt = Date.now();
      state.scrollEl = null;
      state.count = 0;
      state.failed = 0;
      state.removed = new Set();
      state.attempts = new Map();
      state.softAttempts = new Map();
      state.notTarget = new Set();
      state.modalEl = null; // deteksi ulang modal pada run berikutnya
      state.logs = [];
      state.attempted = new Set();
      log('Mulai — mode ' + state.mode + ', delay ' + state.delay + ' ms' +
          (state.idleScrollSecs ? ', auto-scroll idle ' + state.idleScrollSecs + ' dtk' : ', auto-scroll mati'));
      log('Angka "Removed" = hasil yang TERVERIFIKASI di daftar (aksi tanpa perubahan daftar tidak dihitung)');
      startWatchdog();
      diagnose();
      startLoop();
      sendResponse({ ok: true, running: true, delay: state.delay });
      break;
    }
    case 'STOP':
      state.running = false;
      state.runToken += 1; // hentikan loop yang sedang jalan
      state.loopActive = false;
      stopWatchdog();
      log('Dihentikan oleh pengguna — terverifikasi ' + state.count +
          (state.failed ? ', tidak terverifikasi ' + state.failed : ''));
      sendResponse({ ok: true, running: false });
      break;
    case 'STATUS':
      sendResponse({
        running: state.running,
        mode: state.mode,
        count: state.count,
        failed: state.failed,
        notTarget: state.notTarget.size,
        detected: state.detected,
        version: SCRIPT_VERSION || null,
        logs: state.logs,
      });
      break;
    case 'VERIFY': {
      // Bandingkan angka Removed dengan isi daftar saat ini (tombol Recheck).
      const report = recheckRemoved();
      sendResponse({ ok: true, report, logs: state.logs });
      break;
    }
    case 'SET_PATTERNS': {
      // Pola teks dikirim dari popup (panel "Patterns") — langsung dipakai di tab ini.
      const res = applyPatterns(msg.patterns || {});
      sendResponse({ ok: res.ok, errors: res.errors, patterns: currentPatterns() });
      break;
    }
    case 'DIAGNOSE': {
      const info = diagnose();
      sendResponse({ ok: true, diag: info, logs: state.logs });
      break;
    }
    case 'DUMP': {
      const modal = findModalCached();
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

log('Content script dimuat di threads.com (v' + (SCRIPT_VERSION || '?') + ')');
loadStoredPatterns(); // pola tersimpan dari popup (bila ada) langsung dipakai
diagnose();