# Threads Follower Remover (Chrome Extension)

Extension Manifest V3 untuk menghapus follower **dan** remove following (unfollow)
secara otomatis di **threads.com**.

> ⚠️ **Gunakan dengan bijak.** Tool ini menekan tombol yang sama seperti yang
> kamu tekan manual, tapi cepat dan berulang. Jalankan hanya pada akun yang
> memang ingin dihapus, dan gunakan delay yang wajar.

## Dua mode
- **Remove followers** — buka profil → klik **Followers**. Menghapus orang yang
  mengikuti kamu.
- **Remove following** — buka profil → klik **Following**. Unfollow orang yang
  kamu ikuti.

Pilih mode di popup sebelum menekan **Start**.

## How it works (alur modal threads.com)
1. Buka profil → klik **Followers** atau **Following** → **modal** daftar terbuka.
2. Extension mencari modal yang sesuai mode (`[role="dialog"]` berisi judul
   "Followers" / "Following").
3. Di tiap baris, extension klik tombol aksi (**"Following" / "Follow back"**),
   lalu klik tombol **"Unfollow"** di dialog konfirmasi (bila muncul), atau pilih
   **"Remove follower"** di menu "…" bila tersedia.
4. Ulangi otomatis sesuai delay sampai kamu tekan **Stop**.
5. **Watchdog idle**: bila jumlah unfollow tidak bertambah dalam **n detik**
   (input *Auto-scroll after idle*), modal otomatis di-scroll agar baris baru
   termuat. Isi **0** untuk mematikan (scroll manual).

## Files
| File | Purpose |
|------|---------|
| `manifest.json` | Manifest V3, matches `threads.com` + `threads.net` |
| `popup.html` / `.css` / `.js` | UI: mode, start/stop, delay, **Debug log**, **Diagnose** |
| `content.js` | Otomasi + logging (jalan di dalam halaman Threads) |
| `icons/` | Ikon extension (16/48/128) |
| `make_icons.py` | Generator ikon (opsional) |

## Install di Chrome
1. Buka `chrome://extensions`.
2. Aktifkan **Developer mode** (toggle kanan atas).
3. Klik **Load unpacked** → pilih folder ini.
4. **Pin** extension (klik ikon 🧩 → pin 📌) — cukup sekali, Chrome mengingatnya.

## Usage
1. Login **threads.com** → profil → buka tab **Followers** atau **Following**
   (pastikan modal terbuka).
2. Klik ikon extension → pilih **mode**, set **delay** (default 1000 ms) dan
   **auto-scroll idle** (detik, 0 = mati) → **Start**.
3. Pantau **Removed** dan **Debug log** di popup. **Stop** kapan saja.

## Debugging
- **Debug log** menampilkan tiap langkah: scan modal, klik tombol, menu remove, error.
- Tombol **Diagnose** mengirim snapshot DOM: modal terbuka/tidak, jumlah tombol aksi,
  contoh teks tombol, jumlah menuitem — berguna saat selector meleset.
- Popup menampilkan catatan khusus bila content script versi lama masih ter-inject
  (artinya: reload extension **lalu refresh tab**).
- Log juga muncul di console browser (F12) dengan prefix `[TFR]`.
- Jika Threads mengubah teks/bahasa UI, sesuaikan regex di `content.js`:
  `REMOVE_TEXT_RE` (remove/hapus) dan `ACTION_TEXT_RE` (following/follow back).

## Notes / limitations
- Permission `activeTab` saja — tanpa tracking, tanpa network call.
- Modal Threads memuat baris secara virtual — **scroll modal** bila daftar panjang
  agar baris berikutnya termuat (loop akan menunggu dan scan ulang).
