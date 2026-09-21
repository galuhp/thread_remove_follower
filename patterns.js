/*
 * patterns.js — pola teks (regex) yang dipakai content.js untuk mengenali UI Threads.
 *
 * Semua nilai di bawah ini adalah DEFAULT dan sekarang bisa diubah dari popup
 * (panel "Patterns"). Perubahan disimpan di chrome.storage.local (key
 * TFR_STORAGE_KEY) lalu dikirim ke content script lewat pesan SET_PATTERNS —
 * jadi tidak perlu lagi mengedit file ini saat Threads mengubah teks/bahasa UI.
 *
 * File ini dimuat DUA tempat (lihat manifest.json content_scripts dan popup.html),
 * jadi jangan menaruh kode yang mengakses DOM di sini.
 */

// Versi skema config (naikkan bila struktur field berubah).
const TFR_PATTERNS_VERSION = 1;

const TFR_STORAGE_KEY = 'tfrPatterns';

// Nilai default setiap pola. Kunci di sini = kunci di storage & pesan SET_PATTERNS.
const TFR_DEFAULT_PATTERNS = {
  // Mode "Remove following": hanya tombol ini yang boleh diklik.
  // "follow|follow back|follows you" TIDAK termasuk — kliknya akan follow ulang.
  actionFollowing: '^(following|mengikuti)$',
  // Mode "Remove followers": teks tombol aksi di baris daftar followers.
  actionFollowers: '^(following|follow back|follows you|follow|mengikuti|ikuti balik|ikuti)$',
  // Teks menu/opsi remove. Di Threads tombolnya "Unfollow" (bukan "Remove follower").
  removeItem: 'unfollow|remove\\s+follower|hapus\\s+pengikut',
  // Cadangan bila pola removeItem tidak kena.
  removeFallback: '^unfollow$|^remove$|remove\\s+follower|hapus',
  // Kata kunci tambahan (dipisah koma) saat mencari menu remove.
  removeTerms: 'unfollow, remove follower, hapus pengikut, remove from followers, hapus follower',
  // aria-label tombol "…" (More) di baris.
  moreLabel: 'more|titik tiga|three dots|opsi',
  // Judul modal daftar sesuai mode.
  followersTitle: '^followers$|^pengikut$',
  followingTitle: '^following$|^mengikuti$',
};

// Metadata untuk form di popup (urutan tampil = urutan array).
const TFR_PATTERN_FIELDS = [
  { key: 'actionFollowing', label: 'Action button — Following mode',
    hint: 'Teks tombol baris yang berarti masih following. Hanya tombol ini yang diklik di mode "Remove following".' },
  { key: 'actionFollowers', label: 'Action button — Followers mode',
    hint: 'Teks tombol aksi di baris daftar Followers (mode "Remove followers").' },
  { key: 'removeItem', label: 'Remove option',
    hint: 'Teks menu/dialog untuk remove. Di Threads tombolnya "Unfollow".' },
  { key: 'removeFallback', label: 'Remove option — fallback',
    hint: 'Cadangan pencocokan menu bila pola utama tidak kena.' },
  { key: 'removeTerms', label: 'Extra keywords (comma separated)',
    hint: 'Kata kunci tambahan saat mencari menu remove (bukan regex).' },
  { key: 'moreLabel', label: 'More button label',
    hint: 'aria-label tombol "…" (More) di baris.' },
  { key: 'followersTitle', label: 'Modal title — Followers',
    hint: 'Judul modal daftar Followers.' },
  { key: 'followingTitle', label: 'Modal title — Following',
    hint: 'Judul modal daftar Following.' },
];

// Kompilasi pola dengan flag 'i' (case-insensitive). null = pola tidak valid.
function tfrBuildRegex(src) {
  try { return new RegExp(String(src), 'i'); } catch (e) { return null; }
}

// Salinan default (supaya default tidak pernah ikut berubah).
function tfrDefaultPatterns() {
  const out = {};
  Object.keys(TFR_DEFAULT_PATTERNS).forEach((k) => { out[k] = TFR_DEFAULT_PATTERNS[k]; });
  return out;
}

// Gabung config tersimpan dengan default — hanya field string yang dipakai.
function tfrNormalizePatterns(cfg) {
  const out = tfrDefaultPatterns();
  if (cfg && typeof cfg === 'object') {
    Object.keys(out).forEach((k) => {
      if (typeof cfg[k] === 'string' && cfg[k].trim()) out[k] = cfg[k];
    });
  }
  return out;
}

// Validasi semua field regex (removeTerms = kata kunci, bukan regex).
// Mengembalikan { ok, errors: { key: pesan } }.
function tfrValidatePatterns(cfg) {
  const errors = {};
  TFR_PATTERN_FIELDS.forEach(({ key, label }) => {
    const value = cfg[key];
    if (typeof value !== 'string' || !value.trim()) { errors[key] = label + ': kosong'; return; }
    if (key === 'removeTerms') {
      if (!value.split(',').map((s) => s.trim()).filter(Boolean).length) {
        errors[key] = label + ': minimal 1 kata kunci';
      }
      return;
    }
    if (!tfrBuildRegex(value)) errors[key] = label + ': regex tidak valid';
  });
  return { ok: !Object.keys(errors).length, errors };
}
