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
  pageLoadWait: 4000,   // tunggu SPA pindah halaman (profil ↔ daftar followers)
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
// Tombol "…" di header profil orang lain (mode 'profile').
let PROFILE_MORE_RE = PATTERNS_READY ? tfrBuildRegex(TFR_DEFAULT_PATTERNS.profileMoreLabel) : /(?!)/;
// Selektor CSS persis untuk tombol "…" profil (escape hatch bila deteksi otomatis salah).
// Kosong = deteksi otomatis. Contoh: [aria-label="More"] atau div[role="button"].
let PROFILE_MORE_SELECTOR = PATTERNS_READY ? String(TFR_DEFAULT_PATTERNS.profileMoreSelector || '') : '';
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
    profileMoreLabel: PROFILE_MORE_RE.source,
    profileMoreSelector: PROFILE_MORE_SELECTOR,
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
  PROFILE_MORE_RE = tfrBuildRegex(next.profileMoreLabel);
  PROFILE_MORE_SELECTOR =
    typeof next.profileMoreSelector === 'string' ? next.profileMoreSelector.trim() : '';
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
  followersPath: '',    // path halaman Followers milik sendiri (mode 'profile')
  followersHref: '',    // URL lengkap saat Start (mode 'profile')
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

// ---------------------------------------------------------------------------
// Mode 'profile' — hapus follower lewat profil masing-masing orang.
// Dipakai bila di modal Followers tombolnya hanya "Follow back" (menu "…" di
// modal tidak menawarkan "Remove follower"), sehingga langkahnya per orang:
// buka profilnya → tombol "…" → "Remove follower" → konfirmasi → kembali ke
// daftar Followers → lanjut ke orang berikutnya.
// ---------------------------------------------------------------------------
// Polling kondisi sampai benar atau timeout. Mengembalikan nilai fn() (truthy)
// atau null bila waktu habis.
function waitFor(fn, timeout) {
  const step = 120;
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      let v = null;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return resolve(v);
      if (Date.now() - t0 >= timeout) return resolve(null);
      setTimeout(tick, step);
    };
    tick();
  });
}

// Tombol "…" di header profil (bukan "…" milik thread/post).
// Mengembalikan daftar kandidat, diurutkan dari yang paling atas di halaman
// (header profil selalu di atas daftar thread) — pemanggil mencoba satu per satu
// sampai menu "Remove follower" muncul.
function dialogsOf(root) {
  return [...(root || document).querySelectorAll('[role="dialog"], [role="alertdialog"]')];
}

function moreLabelOf(el) {
  if (!el) return '';
  let label = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || '';
  if (!label && el.querySelector) {
    const child = el.querySelector('[aria-label], title, svg');
    if (child) {
      label = child.getAttribute('aria-label') || child.getAttribute('title') || child.textContent || '';
    }
  }
  return String(label || '').trim();
}

function linkHrefOf(el) {
  return (el.getAttribute('href') || '').trim();
}

function hasClickableChild(el) {
  if (!el || !el.querySelectorAll) return false;
  return el.querySelectorAll('[role="button"], button, a[href], [tabindex], input, select, textarea').length > 0;
}

// Cek apakah elemen atau anaknya adalah tombol titik tiga (More / options)
function isMoreButtonOrIcon(el) {
  if (!el) return false;
  const label = moreLabelOf(el);
  const text = norm(el).trim();
  if (whichMoreHitKind(label, text)) return true;

  // Cek apakah SVG memiliki 3 circle (ikon horizontal dots khas Meta/Threads)
  const svg = el.tagName && el.tagName.toLowerCase() === 'svg' ? el : (el.querySelector ? el.querySelector('svg') : null);
  if (svg) {
    const svgLabel = (svg.getAttribute('aria-label') || svg.getAttribute('title') || '').trim();
    if (PROFILE_MORE_RE.test(svgLabel) || /more|option|menu|lain|opsi|titik|three\s*dots/i.test(svgLabel)) {
      return true;
    }
    const circles = svg.querySelectorAll('circle');
    if (circles.length === 3) return true; // Ikon horizontal 3-dots
  }
  return false;
}

// aria → cocok pola di aria/title; bare → cuma teks "…"; '' → bukan kandidat.
function whichMoreHitKind(label, text) {
  if (PROFILE_MORE_RE.test(label) || /more|option|menu|lain|opsi|titik|three\s*dots/i.test(label)) return 'aria';
  if (PROFILE_MORE_RE.test(text)) return 'text';
  const t = text.trim();
  if (t === '…' || t === '···' || t === '...') return 'bare';
  return '';
}

function topOf(el) {
  try {
    const r = el.getBoundingClientRect();
    return typeof r.top === 'number' ? r.top : 0;
  } catch (e) { return 0; }
}

function depthOf(el) {
  let depth = 0;
  let cur = el;
  while (cur && cur.parentElement) { depth += 1; cur = cur.parentElement; }
  return depth;
}

// Memeriksa tab bar profil (Threads, Replies, Media, Reposts)
function findProfileTabBar() {
  const tablist = document.querySelector('[role="tablist"]');
  if (tablist && isVisible(tablist)) return tablist;
  const tabs = [...document.querySelectorAll('a, button, [role="tab"], div, span')]
    .filter(isVisible)
    .filter((el) => /^(threads|replies|balasan|utas)$/i.test(norm(el).trim()));
  if (tabs.length) {
    const candidate = tabs.find((t) => topOf(t) > 80);
    if (candidate) return candidate.closest('div[style*="flex"], div') || candidate;
  }
  return null;
}

// Deteksi apakah sebuah elemen berada di dalam card post/feed, BUKAN di header profil.
function isInsidePost(el) {
  if (!el) return false;
  // 1. Tag standar / role
  if (el.closest('article, [role="article"]')) return true;

  // 2. Berada di bawah Tab Bar profil (Threads / Replies / Media)
  const tabBar = findProfileTabBar();
  if (tabBar) {
    const tabBottom = tabBar.getBoundingClientRect().bottom;
    if (tabBottom > 0 && topOf(el) >= tabBottom - 5) {
      return true; // Berada di area konten tab / feed postingan!
    }
  }

  // 3. Ancestor memuat tombol engagement postingan (Like/Suka, Reply/Balas, Repost, Share)
  let cur = el;
  for (let i = 0; i < 9 && cur && cur !== document.body; i++) {
    if (cur.querySelector) {
      const hasEngagement = cur.querySelector(
        '[aria-label*="Like" i], [aria-label*="Suka" i], [aria-label*="Reply" i], [aria-label*="Balas" i], [aria-label*="Repost" i]'
      );
      if (hasEngagement && hasEngagement !== el && !el.contains(hasEngagement)) {
        return true;
      }
    }
    cur = cur.parentElement;
  }
  return false;
}

function moreCandidateScore(el) {
  const label = moreLabelOf(el);
  const text = norm(el).trim();
  let kind = whichMoreHitKind(label, text);
  if (el.getAttribute && el.getAttribute('data-tfr-descended')) kind = 'descended';
  const base = kind === 'aria' ? 0 : kind === 'text' ? 100 : kind === 'descended' ? 150 : 200;
  return base * 10000 + Math.max(0, Math.round(topOf(el)));
}

function profileMoreDescribe(el) {
  if (!el) return '';
  const r = el.getBoundingClientRect ? el.getBoundingClientRect() : { top: 0, left: 0 };
  return {
    tag: (el.tagName || '').toLowerCase(),
    role: el.getAttribute ? (el.getAttribute('role') || '') : '',
    label: (moreLabelOf(el) || '').slice(0, 60),
    text: norm(el).slice(0, 60),
    cls: (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 3).join(' '),
    href: linkHrefOf(el).slice(0, 80),
    top: Math.round(r.top),
    left: Math.round(r.left),
  };
}

function profileMoreCandidates(explain) {
  const pick = typeof explain === 'object' ? explain : null;
  if (pick) pick.used = 'auto';

  // Escape hatch: selektor CSS persis dari panel Patterns (contoh: [aria-label="More"]).
  if (PROFILE_MORE_SELECTOR) {
    try {
      const picked = [...document.querySelectorAll(PROFILE_MORE_SELECTOR)]
        .filter(isVisible)
        .filter((b) => !dialogsOf(document).some((d) => d.contains(b)))[0] || null;
      if (picked) {
        if (pick) { pick.used = 'selector'; pick.chosen = profileMoreDescribe(picked); }
        log('Tombol "…" profil: selektor custom dipakai', { selector: PROFILE_MORE_SELECTOR, chosen: profileMoreDescribe(picked) });
        return [picked];
      }
      if (pick) pick.chosen = '';
    } catch (e) {
      log('Selektor profileMoreSelector tidak valid — pakai deteksi otomatis', {
        selector: PROFILE_MORE_SELECTOR,
        pesan: String((e && e.message) || e),
      });
    }
  }

  const dialogs = dialogsOf(document);
  const noDialogs = !dialogs.length;

  // ── PASS 0: Sidik Jari SVG Tombol "…" Header Profil Threads (Exact Match) ──
  // Tombol "…" di header profil Threads memiliki SVG More unik dengan 3 titik (path 10.75C) + 1 lingkaran luar (M12 1C).
  const allSvgs = [...document.querySelectorAll('svg')].filter(isVisible);
  const profileCircleSvg = allSvgs.find((s) => {
    if (isInsidePost(s) || topOf(s) < 55) return false;
    // MUTLAK BUKAN IKON INSTAGRAM
    if (s.closest('a[href*="instagram.com"]') || s.closest('a[href*="instagram"]')) return false;

    const paths = [...s.querySelectorAll('path')];
    // Memiliki path titik tiga di dalam (koordinat 10.75C khas titik horizontal Threads)
    const hasThreeDots = paths.some((p) => (p.getAttribute('d') || '').includes('10.75C'));
    // Memiliki path lingkaran luar khas tombol profil Threads (d="M12 1C...")
    const hasOuterCircle = paths.some((p) => {
      const d = p.getAttribute('d') || '';
      return d.startsWith('M12 1C') || d.includes('M12 1C18');
    });

    const aria = (s.getAttribute('aria-label') || '').toLowerCase();
    const title = (s.querySelector('title') ? s.querySelector('title').textContent : '').toLowerCase();
    const isMoreLabeled = /more|opsi|lainnya/i.test(aria) || /more|opsi|lainnya/i.test(title);

    // Kriteria 1: Berlabel More DAN memiliki outer circle atau 4 path
    if (isMoreLabeled && (hasOuterCircle || paths.length === 4 || hasThreeDots)) return true;
    // Kriteria 2: Memiliki path 3 titik (10.75C) DAN outer circle
    if (hasThreeDots && hasOuterCircle) return true;

    return false;
  });

  if (profileCircleSvg) {
    const clickable = profileCircleSvg.closest('[role="button"], button, [tabindex="0"]') || profileCircleSvg.parentElement || profileCircleSvg;
    if (pick) {
      pick.used = 'svg-profile-fingerprint';
      pick.chosen = profileMoreDescribe(clickable);
      pick.candidates = [profileMoreDescribe(clickable)];
    }
    log('Tombol "…" profil: DITEMUKAN via sidik jari SVG profil', {
      dipilih: profileMoreDescribe(clickable),
    });
    return [clickable];
  }

  // ── PASS 1: Deteksi via Ikon Instagram di Header Profil (Paling Presisi) ──────
  // Di Threads web, di baris followers/header ada ikon Instagram, lonceng, dan titik tiga.
  // Titik tiga adalah ikon PALING KANAN di baris tersebut.
  const igLink = document.querySelector('a[href*="instagram.com"]');
  if (igLink && isVisible(igLink)) {
    const igRect = igLink.getBoundingClientRect();
    const igTop = igRect.top;
    const igLeft = igRect.left;

    const rowElements = [...document.querySelectorAll(
      '[role="button"], button, [tabindex="0"], div, svg'
    )]
      .filter(isVisible)
      .filter((b) => noDialogs || !dialogs.some((d) => d.contains(b)))
      // MUTLAK BUKAN LINK INSTAGRAM ATAU ANGGOTA DARI LINK INSTAGRAM
      .filter((b) => b !== igLink && !igLink.contains(b) && !b.closest('a[href*="instagram"]'))
      .filter((b) => !isInsidePost(b))
      .filter((b) => !isRowActionText(b))
      .filter((b) => {
        const r = b.getBoundingClientRect();
        const yDiff = Math.abs(r.top - igTop);
        // Sejajar horizontal dengan IG link (yDiff <= 25px) dan ukuran wajar untuk tombol icon
        return yDiff <= 25 && r.width >= 10 && r.width <= 90 && r.height >= 10 && r.height <= 90;
      })
      .filter((b) => b.getBoundingClientRect().left > igLeft + 10);

    if (rowElements.length) {
      // Cari yang cocok isMoreButtonOrIcon, atau ambil elemen yang paling kanan
      const explicitMore = rowElements.filter((el) => isMoreButtonOrIcon(el));
      const candidates = explicitMore.length ? explicitMore : rowElements;
      // Urutkan dari posisi left paling besar (paling kanan)
      const sorted = candidates
        .map((el) => el.closest('[role="button"], button, [tabindex="0"]') || el)
        .filter((el, idx, arr) => arr.indexOf(el) === idx)
        .sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left);

      if (sorted.length) {
        if (pick) {
          pick.used = 'instagram-row-rightmost';
          pick.candidates = sorted.slice(0, 3).map(profileMoreDescribe);
          pick.chosen = profileMoreDescribe(sorted[0]);
        }
        log('Tombol "…" profil: ditemukan di sebelah kanan ikon Instagram', {
          jumlah: sorted.length,
          dipilih: profileMoreDescribe(sorted[0]),
        });
        return sorted;
      }
    }
  }

  // ── PASS 2: Di Atas atau Sejajar Tombol Follow back / Message di Header ─────
  // Tombol titik tiga profil berada di antara navbar (top >= 60) dan tombol Follow (top <= anchorTop + 10)
  const profileAnchorRe = /^(follow back|follow|unfollow|following|message|ikuti balik|ikuti|mengikuti|pesan|batalkan)\b/i;
  const anchorBtn = [...document.querySelectorAll('[role="button"], button')]
    .filter(isVisible)
    .find((b) => profileAnchorRe.test(norm(b)));

  if (anchorBtn) {
    const anchorTop = topOf(anchorBtn);
    const headerBtns = [...document.querySelectorAll(
      '[role="button"], button, [tabindex="0"], div, svg'
    )]
      .filter(isVisible)
      .filter((b) => noDialogs || !dialogs.some((d) => d.contains(b)))
      .filter((b) => topOf(b) >= 60 && topOf(b) <= anchorTop + 10)
      .filter((b) => !isInsidePost(b))
      .filter((b) => !isRowActionText(b))
      .filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width >= 10 && r.width <= 90 && r.height >= 10 && r.height <= 90;
      })
      .filter((b) => isMoreButtonOrIcon(b) || b.getBoundingClientRect().left >= window.innerWidth * 0.35);

    if (headerBtns.length) {
      const explicitMore = headerBtns.filter((b) => isMoreButtonOrIcon(b));
      const candidates = explicitMore.length ? explicitMore : headerBtns;
      const sorted = candidates
        .map((b) => b.closest('[role="button"], button, [tabindex="0"]') || b)
        .filter((b, idx, arr) => arr.indexOf(b) === idx)
        .sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left);

      if (sorted.length) {
        if (pick) {
          pick.used = 'above-anchor-header';
          pick.candidates = sorted.slice(0, 3).map(profileMoreDescribe);
          pick.chosen = profileMoreDescribe(sorted[0]);
        }
        log('Tombol "…" profil: ditemukan di header di atas tombol aksi', {
          anchor: norm(anchorBtn).slice(0, 30),
          jumlah: sorted.length,
          dipilih: profileMoreDescribe(sorted[0]),
        });
        return sorted;
      }
    }
  }

  // ── PASS 3: Di Atas Tab Bar Profil (Threads / Replies) ────────────────────────
  const tabBar = findProfileTabBar();
  if (tabBar) {
    const tabTop = topOf(tabBar);
    const tabCandidates = [...document.querySelectorAll(
      '[role="button"], button, a[href], [tabindex], div, span'
    )]
      .filter(isVisible)
      .filter((b) => noDialogs || !dialogs.some((d) => d.contains(b)))
      .filter((b) => topOf(b) >= 60 && topOf(b) < tabTop - 5)
      .filter((b) => !isInsidePost(b))
      .filter((b) => isMoreButtonOrIcon(b))
      .filter((b) => !isRowActionText(b));

    if (tabCandidates.length) {
      const ranked = tabCandidates
        .map((el) => el.closest('[role="button"], button, [tabindex="0"]') || el)
        .filter((el, idx, arr) => arr.indexOf(el) === idx)
        .map((el) => ({ el, score: moreCandidateScore(el) }))
        .sort((a, b) => a.score - b.score || topOf(a.el) - topOf(b.el))
        .map((o) => o.el);
      if (pick) {
        pick.used = 'above-tabbar';
        pick.candidates = ranked.slice(0, 5).map(profileMoreDescribe);
        pick.chosen = profileMoreDescribe(ranked[0] || null);
      }
      log('Tombol "…" profil: ditemukan di atas tab bar profil', {
        jumlah: ranked.length,
        dipilih: profileMoreDescribe(ranked[0] || null),
      });
      return ranked;
    }
  }

  // ── PASS 4: Full document search (dengan filter keras anti-post) ─────────────
  const linkHits = [], ariaHits = [], bareHits = [];
  const found = [...document.querySelectorAll(
    '[role="button"], button, a[href], [tabindex], div, span, li, section'
  )]
    .filter(isVisible)
    .filter((b) => noDialogs || !dialogs.some((d) => d.contains(b)))
    .filter((b) => topOf(b) >= 60)
    .filter((b) => !isInsidePost(b))
    .filter((b) => {
      const isMore = isMoreButtonOrIcon(b);
      const label = moreLabelOf(b);
      const text = norm(b);
      const hit = whichMoreHitKind(label, text);
      if (hit === 'aria') ariaHits.push(profileMoreDescribe(b));
      else if (hit === 'bare' && !hasClickableChild(b)) bareHits.push(profileMoreDescribe(b));
      return isMore || (!!hit && (hit !== 'bare' || !hasClickableChild(b)));
    })
    .filter((b) => !isRowActionText(b));

  let leaves = found;
  if (!found.length) {
    const descended = [];
    [...document.querySelectorAll('div, span, li, section')]
      .filter(isVisible)
      .filter((b) => noDialogs || !dialogs.some((d) => d.contains(b)))
      .filter((b) => topOf(b) >= 60)
      .filter((b) => !isInsidePost(b))
      .filter((b) => isMoreButtonOrIcon(b))
      .forEach((wrap) => {
        const inner = [...wrap.querySelectorAll('[role="button"], button, a[href], [tabindex]')]
          .filter(isVisible)
          .filter((b) => !isRowActionText(b))[0];
        if (inner && !inner.hasAttribute('data-tfr-descended')) {
          inner.setAttribute('data-tfr-descended', norm(wrap).slice(0, 30));
          descended.push(inner);
        }
      });
    leaves = descended;
  }
  found.forEach((b) => {
    if (linkHrefOf(b)) linkHits.push(profileMoreDescribe(b));
  });
  const ranked = leaves
    .map((el) => el.closest('[role="button"], button, [tabindex="0"]') || el)
    .filter((el, idx, arr) => arr.indexOf(el) === idx)
    .map((el) => ({ el, score: moreCandidateScore(el) }))
    .sort((a, b) => a.score - b.score || topOf(a.el) - topOf(b.el))
    .map((o) => o.el);
  if (pick) {
    pick.used = pick.used || 'auto';
    pick.candidates = ranked.slice(0, 5).map(profileMoreDescribe);
    pick.ariaHits = ariaHits.slice(0, 8);
    pick.linkHits = linkHits.slice(0, 8);
    pick.bareHits = bareHits.slice(0, 8);
    pick.chosen = profileMoreDescribe(ranked[0] || null);
  }
  return ranked;
}

function findProfileMoreButton() {
  return profileMoreCandidates()[0] || null;
}

function profileMoreLabel(el) {
  if (!el) return '';
  return moreLabelOf(el) || norm(el) || '(tanpa label)';
}

// Klik satu elemen SEKALI seperti interaksi pengguna.
// PENTING (v1.4.8): hanya SATU event klik yang dikirim. Menu/popover Threads
// bersifat toggle — versi lama mengirim beberapa klik berurutan (events +
// .click() ke elemen, parent, dan SVG) sehingga menu terbuka lalu LANGSUNG
// tertutup lagi; gejalanya: "tombol '…' tidak bisa diklik".
// Mesin klik bertingkat + verifikasi ada di openMenuFrom() (bagian bawah file).
function realClick(el) {
  return activateOnce(el, 'pointer');
}

// Ringkaskan percobaan tombol "…" untuk log kalibrasi.
function explainMorePick() {
  const pick = {};
  profileMoreCandidates(pick);
  log('Kalibrasi tombol "…" profil', pick);
  return pick;
}

// Ringkasan tombol terlihat untuk diagnostik: label yang tersedia untuk kalibrasi pola.
function visibleButtonLabels(limit = 12) {
  const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')];
  return [...document.querySelectorAll('[role="button"], button, a[href], [tabindex]')]
    .filter(isVisible)
    .filter((b) => !dialogs.some((d) => d.contains(b)))
    .map((b) => (b.getAttribute('aria-label') || b.getAttribute('title') || norm(b)).slice(0, 40))
    .filter(Boolean)
    .slice(0, limit);
}

async function backToFollowers() {
  try { history.back(); } catch (e) { /* ignore */ }
  // Beri SPA waktu untuk mulai navigasi sebelum polling modal.
  await sleep(600);
  await waitFor(() => findModal(), 6000);
  if (!findModal() && state.followersPath) {
    // Modal tidak dibuka ulang otomatis → tunggu halaman profil render, lalu
    // klik link "Followers" di profil sendiri.
    await sleep(800);
    const link = [...document.querySelectorAll(`a[href="${state.followersPath}"]`)]
      .filter(isVisible)[0];
    if (link) {
      log('Modal tidak terbuka otomatis — klik link Followers lagi');
      link.click();
      await waitFor(() => findModal(), 6000);
    }
  }
  return !!findModal();
}

// Satu orang lewat profil: buka profil → menu "…" → "Remove follower" → kembali.
async function tryRemoveViaProfile(row, user) {
  // 1) Buka profil orang tersebut lewat link di baris (navigasi SPA, tanpa reload —
  //    penting: reload akan mematikan content script beserta hitungannya).
  const link = row.querySelector('a[href*="/@"]');
  if (!link) {
    log('Link profil tidak ditemukan di baris', { user });
    return false;
  }
  // Ambil username dari href link (lebih akurat dari usernameOf yang bisa return img.alt).
  const hrefUsername = ((link.getAttribute('href') || '').match(/@([^/?#]+)/) || [])[1] || user;
  const targetPath = '/@' + hrefUsername.toLowerCase();
  log('Buka profil untuk remove follower', { user, href: link.getAttribute('href') });
  link.click();
  // Tunggu sampai URL berubah ke profil target — timeout 6000ms agar SPA punya waktu.
  const onProfile = await waitFor(
    () => location.pathname.toLowerCase().includes(targetPath),
    6000
  );
  if (!onProfile) {
    log('Halaman profil tidak terbuka (navigasi gagal)', { user, targetPath, pathname: location.pathname });
    await backToFollowers();
    return false;
  }
  // Beri waktu SPA untuk render header profil sebelum mencari tombol "…".
  await sleep(1000);

  // 2) Tombol "…" profil → menu. Coba tiap kandidat (paling atas dulu) sampai menu
  // "Remove follower" muncul — satu klik sintetis kadang tidak direspons UI SPA.
  const morePick = {};
  const moreList = await waitFor(
    () => { const c = profileMoreCandidates(morePick); return c.length ? c : null; },
    CONFIG.pageLoadWait
  );
  if (!moreList) {
    const pickInfo = explainMorePick();
    log('Tombol "…" profil tidak ditemukan', {
      user,
      tombolTerlihat: visibleButtonLabels(),
      autoAtauSelector: pickInfo.used,
      kandidatAria: pickInfo.ariaHits,
      kandidatLink: pickInfo.linkHits,
      kandidatTeksSaja: pickInfo.bareHits,
      saran: 'Kirim log ini / tekan Dump HTML di halaman profil, lalu isi pola "Profile … selector" di panel Patterns bila perlu',
    });
    await backToFollowers();
    return false;
  }
  log('Kandidat tombol "…" profil', {
    user,
    dipakai: morePick.used,
    urutan: (morePick.candidates || []).map((c) => (c.tag + (c.role ? '[' + c.role + ']' : '') + ' ' + (c.label || c.text || '').slice(0, 30)).trim()),
  });
  let item = null;
  let menuTanpaOpsi = null;
  for (const more of moreList.slice(0, 3)) {
    log('Klik tombol "…" profil', {
      user,
      label: profileMoreLabel(more),
      detail: profileMoreDescribe(more),
    });
    // Satu aktivasi + verifikasi: menu harus benar-benar terbuka (dan opsi
    // remove harus ada) sebelum lanjut — kalau tidak, naik ke strategi klik
    // berikutnya. Ini mencegah "klik dobel" yang menutup menu lagi.
    const res = await openMenuFrom(more);
    log('Hasil klik tombol "…" profil', {
      user,
      strategiBerhasil: res.strategy || '-',
      jumlahPercobaan: res.tries,
      riwayat: res.detail,
      menuTerbuka: res.opened,
      opsiRemoveDitemukan: !!res.item,
      isiMenu: res.labels,
      menuTertutupLagi: res.closedAgain,
    });
    if (res.item) { item = res.item; break; }
    if (res.opened && res.labels.length) menuTanpaOpsi = res.labels;
    pressEscape();
    await sleep(250);
  }
  if (!item) {
    log('Menu "Remove follower" tidak muncul dari tombol "…" mana pun', {
      user,
      tombolDicoba: moreList.slice(0, 3).map(profileMoreLabel),
      menuTerbukaTapiTanpaOpsi: menuTanpaOpsi || null,
      saran: menuTanpaOpsi
        ? 'Menu TERBUKA tapi opsi remove tidak ada di dalamnya → tambahkan kata kunci opsinya di panel Patterns (Remove option / Extra keywords)'
        : 'Menu tidak terbuka sama sekali → buka halaman profil orang itu, tekan tombol "Test …" lalu kirim log ini',
    });
    pressEscape();
    await backToFollowers();
    return false;
  }

  // 4) Klik opsi + konfirmasi ("Remove follower?" → tombol Remove follower).
  const confirmed = await clickRemoveItem(item, user);
  if (!confirmed) {
    log('Konfirmasi remove follower tidak ditemukan', { user });
  } else {
    log('Klik "Remove follower" terkirim', { user });
  }

  // 5) Kembali ke daftar Followers (verifikasi lanjutan dilakukan runLoop di sana).
  const reopened = await backToFollowers();
  if (!reopened) log('Gagal kembali ke daftar Followers — akan dicoba dibuka ulang', { user });
  return confirmed;
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

  // Mode "profile": hapus follower lewat profil orang tersebut (dipakai bila di
  // modal Followers menu "…" hanya menawarkan "Follow back").
  if (state.mode === 'profile') {
    return await tryRemoveViaProfile(row, user);
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

// Mode 'profile' tujuannya *Remove follower*. Bila menu menawarkan dua opsi
// sekaligus ("Unfollow" DAN "Remove follower"), yang benar adalah "Remove
// follower" — kalau salah pilih, orangnya cuma di-unfollow (tetap follower).
// Ini hanya mengubah URUTAN pilihan, bukan filter: pola utama tetap dipakai.
const REMOVE_FOLLOWER_PREF_RE = /remove\s+follower|hapus\s+pengikut/i;

function findRemoveOptionInDoc() {
  // Kata kunci dari pengaturan popup (default: unfollow / remove follower / ...).
  const terms = REMOVE_TERMS;
  const matches = (el) => {
    const t = norm(el).toLowerCase();
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    if (terms.some((term) => t.includes(term) || aria.includes(term))) return true;
    return REMOVE_ITEM_RE.test(t) || REMOVE_ITEM_RE.test(aria);
  };

  // 1. Cek elemen clickable standar
  const cands = [...document.querySelectorAll(CLICKABLE_SEL)].filter(isVisible).filter(matches);
  if (cands.length) {
    const byLen = cands.slice().sort((a, b) => norm(a).length - norm(b).length);
    if (state.mode === 'profile') {
      const pref = byLen.find((el) => {
        const aria = el.getAttribute('aria-label') || '';
        return REMOVE_FOLLOWER_PREF_RE.test(norm(el)) || REMOVE_FOLLOWER_PREF_RE.test(aria);
      });
      if (pref) return pref;
    }
    return byLen[0];
  }

  // 2. Fallback: Cari di container popover/menu/dialog (portal React)
  const containers = [...document.querySelectorAll(
    '[role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"], div[style*="position: fixed"], div[style*="position: absolute"]'
  )].filter(isVisible);

  for (const c of containers) {
    const hits = [...c.querySelectorAll('div, span, p, [role="button"], button')]
      .filter(isVisible)
      .filter((el) => {
        const t = norm(el);
        return t && t.length <= 45 && matches(el);
      });
    if (hits.length) {
      // Pilih teks terpendek dan ambil clickable container-nya jika ada
      const hit = hits.sort((a, b) => norm(a).length - norm(b).length)[0];
      return hit.closest('[role="menuitem"], [role="button"], button, [tabindex]') || hit;
    }
  }

  return null;
}



// ---------------------------------------------------------------------------
// Mesin klik tombol "…" (satu aktivasi + verifikasi)
// ---------------------------------------------------------------------------
// Kenapa perlu? Popover Threads/Meta bersifat TOGGLE: satu aktivasi membuka,
// aktivasi berikutnya menutup. Versi lama mengirim beberapa klik berurutan
// (event pointer/mouse + .click() ke elemen, parent, dan SVG) sehingga menu
// terbuka lalu langsung tertutup — terlihat seperti "tombol '…' tidak bisa
// diklik oleh extension".
// Aturan di sini: SATU aktivasi → VERIFIKASI (menu terbuka? opsi remove ada?)
// → bila belum berhasil baru naik ke strategi berikutnya (klik node teratas di
// titik tombol, parent clickable, Enter, Space, press-only, mouse-only).

// Safety Lock Mutlak: node ini (atau leluhurnya) adalah link Instagram → jangan
// pernah diklik otomatis.
function isInstagramNode(el) {
  if (!el || !el.closest) return false;
  return !!(el.closest('a[href*="instagram"]') || el.closest('a[href*="instagram.com"]'));
}

// Ringkasan popover/menu yang sedang TERBUKA di dokumen. Modal daftar follower
// (banyak avatar) sengaja TIDAK dihitung supaya tidak dianggap "menu".
function menuSnapshot() {
  const containers = [...document.querySelectorAll(
    '[role="menu"], [role="listbox"], [role="alertdialog"], [role="dialog"]'
  )]
    .filter(isVisible)
    .filter((c) => c.querySelectorAll('img').length < 5);

  let items = 0;
  const labels = [];
  containers.forEach((c) => {
    [...c.querySelectorAll(CLICKABLE_SEL)].filter(isVisible).forEach((el) => {
      items += 1;
      if (labels.length < 12) {
        const t = (norm(el) || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
        if (t && labels.indexOf(t) === -1) labels.push(t.slice(0, 40));
      }
    });
  });
  return { containers: containers.length, items, labels };
}

// Elemen TERATAS pada titik tengah `el` — menangani kasus elemen yang kita pilih
// (wrapper/div) bukan node yang benar-benar menerima klik pengguna.
function nodeAtCenterOf(el) {
  try {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const x = Math.max(1, Math.min(window.innerWidth - 2, r.left + r.width / 2));
    const y = Math.max(1, Math.min(window.innerHeight - 2, r.top + r.height / 2));
    return document.elementFromPoint(x, y);
  } catch (e) { return null; }
}

// Node yang paling mungkin memegang handler klik (naik dari elemen apa pun).
function closestClickable(el) {
  if (!el) return null;
  if (!el.closest) return el;
  return el.closest('[role="button"], button, [tabindex], a[href]') || el;
}

function eventPointOpts(el) {
  let clientX = 0;
  let clientY = 0;
  try {
    const r = el.getBoundingClientRect();
    clientX = r.left + r.width / 2;
    clientY = r.top + r.height / 2;
  } catch (e) { /* ignore */ }
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    detail: 1,
    button: 0,
    clientX,
    clientY,
  };
}

// SATU aktivasi saja (jangan pernah dua klik — menu akan tertutup lagi).
// mode: 'pointer' | 'mouse' | 'press' | 'native' | 'enter' | 'space'.
function activateOnce(el, mode = 'pointer') {
  if (!el) return false;
  if (isInstagramNode(el)) {
    log('Pencegahan: klik ke link Instagram dibatalkan (safety lock)');
    return false;
  }
  try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* ignore */ }
  try { if (typeof el.focus === 'function') el.focus({ preventScroll: true }); } catch (e) { /* ignore */ }

  const opts = eventPointOpts(el);
  // Realistis: tombol turun membawa buttons=1, tombol naik/klik buttons=0
  // (ini penting untuk UI yang memeriksa e.buttons).
  const down = Object.assign({}, opts, { buttons: 1 });
  const up = Object.assign({}, opts, { buttons: 0 });
  const ptrDown = Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1, pressure: 0.5 }, down);
  const ptrUp = Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1, pressure: 0 }, up);
  const ptrOver = Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1, pressure: 0 }, up);

  try {
    switch (mode) {
      case 'pointer':
        el.dispatchEvent(new PointerEvent('pointerover', ptrOver));
        el.dispatchEvent(new MouseEvent('mouseover', up));
        el.dispatchEvent(new PointerEvent('pointerdown', ptrDown));
        el.dispatchEvent(new MouseEvent('mousedown', down));
        el.dispatchEvent(new PointerEvent('pointerup', ptrUp));
        el.dispatchEvent(new MouseEvent('mouseup', up));
        el.dispatchEvent(new MouseEvent('click', up));
        return true;
      case 'mouse':
        el.dispatchEvent(new MouseEvent('mouseover', up));
        el.dispatchEvent(new MouseEvent('mousedown', down));
        el.dispatchEvent(new MouseEvent('mouseup', up));
        el.dispatchEvent(new MouseEvent('click', up));
        return true;
      case 'press':
        el.dispatchEvent(new PointerEvent('pointerdown', ptrDown));
        el.dispatchEvent(new MouseEvent('mousedown', down));
        return true;
      case 'native':
        el.click();
        return true;
      case 'enter':
      case 'space': {
        const key = mode === 'enter' ? 'Enter' : ' ';
        const code = mode === 'enter' ? 'Enter' : 'Space';
        const keyOpts = { key, code, bubbles: true, cancelable: true, composed: true };
        el.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
        el.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
        return true;
      }
      default:
        return false;
    }
  } catch (e) {
    try { el.click(); return true; } catch (ignored) { return false; }
  }
}

// Pantau hasil aktivasi: apakah menu muncul, apakah opsi remove ada di dalamnya,
// dan apakah menu sempat terbuka lalu tertutup lagi (indikasi perilaku toggle).
async function observeMenu(baseItems, timeout) {
  const t0 = Date.now();
  let everOpened = false;
  let labels = [];
  let item = null;
  while (Date.now() - t0 < timeout) {
    item = findRemoveOptionInDoc();
    const snap = menuSnapshot();
    if (snap.items > baseItems) {
      everOpened = true;
      if (snap.labels.length) labels = snap.labels;
    }
    if (item) return { item, opened: true, closedAgain: false, labels };
    await sleep(120);
  }
  const now = menuSnapshot();
  return {
    item: null,
    opened: everOpened,
    closedAgain: everOpened && now.items <= baseItems,
    labels,
  };
}

// Daftar strategi klik untuk satu kandidat tombol "…" (satu aktivasi per
// percobaan, dari yang paling "normal" ke yang paling darurat).
function clickStrategiesFor(el) {
  const out = [];
  const push = (name, target, mode) => {
    if (!target || isInstagramNode(target)) return;
    if (out.some((s) => s.target === target && s.mode === mode)) return;
    out.push({ name, target, mode });
  };

  push('pointer', el, 'pointer');            // interaksi normal (satu klik)
  push('native', el, 'native');              // .click() bawaan browser
  const top = nodeAtCenterOf(el);
  if (top && top !== el) {
    push('topmost', top, 'pointer');         // node yang benar-benar ada di titik itu
    const topC = closestClickable(top);
    if (topC && topC !== top && topC !== el) push('topmost-parent', topC, 'pointer');
  }
  const parentC = closestClickable(el.parentElement);
  if (parentC && parentC !== el) push('parent', parentC, 'pointer');
  push('enter', el, 'enter');                // aktivasi keyboard (Enter)
  push('space', el, 'space');                // aktivasi keyboard (Space)
  push('press', el, 'press');                // menu dibuka saat mousedown
  push('mouse', el, 'mouse');                // UI yang tidak memakai PointerEvent
  return out;
}

// Buka menu dari `el`: satu aktivasi → verifikasi → eskalasi bila perlu.
// Mengembalikan { opened, item, labels, closedAgain, strategy, tries, detail[] }.
async function openMenuFrom(el, opts = {}) {
  const timeout = Math.max(1200, opts.timeout || CONFIG.menuOpenDelay + 1200);
  const result = {
    opened: false, item: null, labels: [], closedAgain: false,
    strategy: '', tries: 0, detail: [],
  };

  // Bila sudah ada menu terbuka, aktivasi kita justru MENUTUPnya (toggle).
  if (menuSnapshot().items) {
    pressEscape();
    await sleep(200);
  }

  const baseItems = menuSnapshot().items;
  let firstTry = true;

  for (const st of clickStrategiesFor(el)) {
    if (!st.target || !st.target.isConnected) {
      result.detail.push(st.name + ':hilang-dari-DOM');
      continue;
    }
    result.tries += 1;
    // Percobaan pertama dapat jendela tunggu penuh (menu bisa lambat render);
    // percobaan berikutnya lebih singkat supaya kegagalan tidak menggantung —
    // UI yang responsif membuka menu jauh di bawah 1 detik.
    const wait = firstTry ? timeout : Math.max(600, Math.round(timeout * 0.45));
    firstTry = false;

    activateOnce(st.target, st.mode);
    const seen = await observeMenu(baseItems, wait);
    result.detail.push(
      st.name + ':' +
      (seen.item ? 'menu+opsi'
        : seen.opened ? 'menu-tanpa-opsi'
          : seen.closedAgain ? 'terbuka-lalu-tertutup'
            : 'tidak-ada-menu')
    );

    if (seen.item) {
      result.opened = true;
      result.item = seen.item;
      result.labels = seen.labels;
      result.strategy = st.name;
      return result;
    }
    if (seen.opened) {
      // Menu TERBUKA tapi tanpa opsi remove → jangan klik lagi (toggle).
      // Pemanggil bisa memakai `labels` untuk mengkalibrasi pola.
      result.opened = true;
      result.labels = seen.labels;
      result.strategy = st.name;
      pressEscape();
      await sleep(200);
      return result;
    }
    if (seen.closedAgain) result.closedAgain = true;

    // Menu bisa muncul sedikit lebih lambat dari jendela tunggu: kalau sekarang
    // terbuka, JANGAN aktivasi lagi (toggle) — laporkan apa adanya.
    const nowSnap = menuSnapshot();
    if (nowSnap.items > baseItems) {
      result.opened = true;
      result.labels = nowSnap.labels;
      result.strategy = st.name;
      pressEscape();
      await sleep(200);
      return result;
    }
  }
  return result;
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
  // Mode 'profile': setelah kembali dari profil, cek apakah username masih ada
  // di daftar Followers. Ini verifikasi paling akurat untuk mode ini.
  if (state.mode === 'profile') {
    // Tunggu modal Followers terbuka DAN daftar baris termuat (max 5 detik).
    // Tanpa ini, findRows() bisa kosong bukan karena user sudah dihapus,
    // melainkan karena list belum selesai render — semua aksi akan terhitung
    // terverifikasi secara keliru.
    const modalReady = await waitFor(() => {
      const m = findModalCached();
      if (!m) return null;
      const rs = findRows(m);
      // Anggap siap bila ada ≥1 baris, ATAU modal sudah ada tapi memang 0 baris
      // (list habis) — beri batas 3 detik lagi di luar sini.
      return rs.length > 0 ? { modal: m, rows: rs } : null;
    }, 5000);

    if (!modalReady) {
      // Modal tidak terbuka atau kosong setelah 5 detik.
      const m = findModalCached();
      if (!m) {
        return { verified: false, reason: 'modal Followers tidak terbuka setelah kembali dari profil' };
      }
      // Modal ada tapi 0 baris — bisa jadi list habis atau user memang sudah dihapus.
      // Anggap terverifikasi bila memang kita baru saja beraksi.
      return acted
        ? { verified: true, reason: 'modal terbuka tapi 0 baris (list habis / user sudah terhapus)' }
        : { verified: false, reason: 'modal terbuka tapi 0 baris dan tidak ada aksi' };
    }

    const masih = modalReady.rows.filter((r) => usernameOf(r) === user);
    return masih.length
      ? { verified: false, reason: 'username masih ada di daftar Followers' }
      : { verified: true, reason: 'username sudah tidak ada di daftar Followers' };
  }
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
    // Mode 'profile': baris diproses lewat profil, jadi daftar Followers harus
    // dibuka ulang secara otomatis sebelum mencoba lagi.
    if (state.mode === 'profile' && state.followersPath) {
      const kembali = await backToFollowers();
      log(kembali ? 'Daftar Followers dibuka ulang' : 'Gagal membuka ulang daftar Followers', {
        path: state.followersPath,
      });
    }
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
      state.mode = msg.mode === 'profile' ? 'profile'
        : msg.mode === 'following' ? 'following' : 'followers';
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
      // Mode 'profile': simpan halaman Followers sekarang sebagai titik kembali.
      if (state.mode === 'profile') {
        state.followersPath = location.pathname;
        state.followersHref = location.href;
        log('Titik kembali: ' + state.followersPath +
            (/\/followers/i.test(state.followersPath)
              ? ''
              : ' (PERHATIAN: URL ini bukan halaman /followers — buka profil kamu lalu klik Followers)'));
      }
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
    case 'TEST_MORE': {
      // Uji klik tombol "…" pada halaman yang SEDANG terbuka (tanpa menjalankan
      // loop): buka halaman profil orang yang bermasalah → tekan "Test …".
      // Berguna untuk memastikan klik benar-benar membuka menu, sekaligus
      // melihat isi menu untuk kalibrasi pola.
      (async () => {
        const pick = {};
        const list = profileMoreCandidates(pick);
        if (!list.length) {
          log('Test "…": tombol tidak ditemukan di halaman ini', { url: location.href, deteksi: pick });
          sendResponse({ ok: false, found: false, pick, logs: state.logs });
          return;
        }
        const more = list[0];
        log('Test "…": mencoba klik tombol', {
          url: location.href,
          deteksi: pick.used,
          jumlahKandidat: list.length,
          dipilih: profileMoreDescribe(more),
        });
        const res = await openMenuFrom(more);
        log('Test "…": hasil klik', {
          strategiBerhasil: res.strategy || '-',
          jumlahPercobaan: res.tries,
          riwayat: res.detail,
          menuTerbuka: res.opened,
          opsiRemoveDitemukan: !!res.item,
          isiMenu: res.labels,
          menuTertutupLagi: res.closedAgain,
        });
        log(res.item
          ? 'Test "…": BERHASIL — menu terbuka dan opsi remove ditemukan'
          : res.opened
            ? 'Test "…": menu terbuka tapi opsi remove tidak ada — kalibrasi pola (Remove option / Extra keywords)'
            : 'Test "…": menu tidak terbuka — tekan Dump HTML di halaman ini lalu kirim lognya');
        pressEscape();
        sendResponse({
          ok: true,
          found: true,
          strategy: res.strategy || null,
          opened: res.opened,
          itemFound: !!res.item,
          labels: res.labels,
          detail: res.detail,
          logs: state.logs,
        });
      })();
      return true; // respons asinkron — channel pesan tetap terbuka
    }
    case 'DIAGNOSE': {
      const info = diagnose();
      sendResponse({ ok: true, diag: info, logs: state.logs });
      break;
    }
    case 'DUMP': {
      const modal = findModalCached();
      if (modal) {
        const rows = findRows(modal);
        const row = rows[0] || modal;
        const htmlFull = (row.outerHTML || '').replace(/\s+/g, ' ');
        log('DUMP baris pertama modal Followers', {
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
      } else {
        // Sedang di halaman profil (bukan di modal) — dump semua elemen interaktif header profil
        const headerElements = [...document.querySelectorAll('[role="button"], button, a[href*="instagram"], svg, [tabindex="0"]')]
          .filter(isVisible)
          .filter((b) => topOf(b) < 450);
        log('DUMP elemen halaman profil (top < 450px)', {
          url: location.href,
          jumlahElemen: headerElements.length,
          elemen: headerElements.slice(0, 20).map((el) => ({
            tag: el.tagName.toLowerCase(),
            role: el.getAttribute('role') || '',
            aria: el.getAttribute('aria-label') || '',
            title: el.getAttribute('title') || '',
            text: norm(el).slice(0, 30),
            href: (el.getAttribute('href') || '').slice(0, 50),
            top: Math.round(topOf(el)),
            left: Math.round(el.getBoundingClientRect().left),
            w: Math.round(el.getBoundingClientRect().width),
            h: Math.round(el.getBoundingClientRect().height),
            html: el.outerHTML.slice(0, 150),
          })),
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