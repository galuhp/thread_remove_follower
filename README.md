# Threads Follower Remover (Chrome Extension)

Extension Manifest V3 untuk menghapus follower **dan** remove following (unfollow)
secara otomatis di **threads.com**.

> ⚠️ **Gunakan dengan bijak.** Tool ini menekan tombol yang sama seperti yang
> kamu tekan manual, tapi cepat dan berulang. Jalankan hanya pada akun yang
> memang ingin dihapus, dan gunakan delay yang wajar.

## Dua mode → tiga mode
- **Remove followers** — buka profil → klik **Followers**. Menghapus orang yang
  mengikuti kamu.
- **Remove following** — buka profil → klik **Following**. Unfollow orang yang
  kamu ikuti.
- **Remove followers — via profil** (v1.4.0+) — dipakai bila di modal Followers
  tombolnya hanya **Follow back** (menu "…" di baris tidak menawarkan
  *Remove follower*). Alurnya per orang: **buka profil orang itu → tombol "…" →
  Remove follower → konfirmasi → kembali ke daftar Followers → lanjut ke
  orang berikutnya**. Navigasinya SPA (tanpa reload) supaya hitungan & log tidak
  hilang; halaman Followers dibuka ulang otomatis setiap kali selesai.

Pilih mode di popup sebelum menekan **Start**. Untuk mode *via profil*: buka
**profil kamu → Followers** dulu (URL berisi `/followers`), lalu tekan **Start** —
URL itu dipakai sebagai titik kembali.

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

## Versi extension
Popup menampilkan dua badge versi tepat di bawah judul:

| Badge | Arti |
|-------|------|
| `v1.1.0` (biru) | Versi extension — dibaca langsung dari `version` di `manifest.json` |
| `content v1.1.0` (abu-abu) | Versi content script yang aktif di tab Threads saat ini |

Badge `content` berubah **oranye** bila content script di tab masih versi lama
(berbeda dari `manifest.json`) — biasanya karena extension sudah di-reload tapi
tab Threads belum di-refresh. Arahkan kursor ke badge untuk melihat detailnya.

Cara update versi: naikkan `version` di `manifest.json` → reload extension di
`chrome://extensions` → refresh tab Threads. Versi juga tampil di **Debug log**
(`Content script dimuat di threads.com (v1.1.0)`) dan di output **Diagnose**
(kunci `versi`), sehingga mudah memastikan perubahan versi sudah terpasang.

### Riwayat versi
| Versi | Perubahan |
|-------|-----------|
| 1.4.8 | **Klik tombol "…" kini terverifikasi (anti klik-dobel)**: (1) mesin klik baru `activateOnce`/`openMenuFrom` — setiap percobaan hanya mengirim **satu** aktivasi, lalu hasilnya diverifikasi (menu benar-benar terbuka? opsi remove ada?); versi lama mengirim beberapa klik berurutan (event pointer/mouse + `.click()` ke elemen, parent, dan SVG) sehingga menu Threads yang bersifat *toggle* terbuka lalu **langsung tertutup lagi** — gejalanya "tombol … tidak bisa diklik"; (2) eskalasi otomatis bila menu belum terbuka: `pointer` → `native .click()` → node teratas di titik tombol (`elementFromPoint`) → parent clickable → `Enter` → `Space` → `press-only` (mousedown) → `mouse-only`; (3) deteksi "menu terbuka tapi tanpa opsi remove" → log menampilkan **isi menu** (label) untuk kalibrasi pola, dan klik tidak diulang (mencegah toggle menutup menu); (4) log baru: `strategiBerhasil`, `jumlahPercobaan`, `riwayat` tiap strategi (`menu+opsi` / `menu-tanpa-opsi` / `terbuka-lalu-tertutup` / `tidak-ada-menu`), `menuTertutupLagi`; (5) tombol **Test …** di popup — menguji klik tombol "…" di halaman yang sedang terbuka (mis. halaman profil teman) tanpa menjalankan loop; (6) safety lock Instagram tetap berlaku di **semua** jalur klik; (7) mode *via profil* kini **mengutamakan opsi "Remove follower"** bila menu memuat "Unfollow" sekaligus (sebelumnya yang terpilih adalah teks terpendek, yaitu "Unfollow" — akibatnya orang itu hanya ter-unfollow dan tetap menjadi follower). |
| 1.4.7 | **Pencegahan mutlak klik akun Instagram**: (1) penyempurnaan PASS 0 — mendeteksi tombol "…" yang secara spesifik memiliki path titik tiga `10.75C` dan berlabel More, serta secara eksplisit mengecualikan link `a[href*="instagram"]` (sebelumnya ikon IG juga memiliki path lingkaran `M12 1C` sehingga ikut terpilih); (2) safety lock mutlak di `realClick` — membatalkan klik otomatis bila target merupakan link Instagram. |
| 1.4.6 | **Deteksi presisi 100% via sidik jari SVG profil**: (1) penambahan PASS 0 — mendeteksi tombol "…" profil secara langsung melalui path lingkaran luar khas Meta Threads (`d="M12 1C..."`) pada SVG; (2) `realClick` kini mendispatch event pointer/mouse dan memicu `.click()` bawaan browser ke seluruh hierarki (parent button, elemen, dan child svg) sehingga event listener React pasti terpicu; (3) perbaikan dump HTML agar bisa men-dump seluruh tombol header profil bila dijalankan di halaman profil. |
| 1.4.5 | **Perbaikan tuntas tombol "…" profil tidak terklik**: (1) `moreLabelOf` diperluas untuk membaca `aria-label`/`title` dari elemen anak (SVG/title), bukan hanya elemen terluar; (2) deteksi ikon SVG horizontal 3-dots khas Meta (`svg.querySelectorAll('circle').length === 3`) sehingga tombol titik tiga tetap dikenali meski tanpa teks/aria-label; (3) Pass 1 (Instagram neighbor) memilih tombol paling kanan di samping ikon Instagram tanpa batasan teks yang kaku; (4) `realClick` kini memanggil `.click()` native browser langsung pada elemen dan tombol pembungkus selain pointer/mouse event dispatch; (5) `findRemoveOptionInDoc` diperluas dengan fallback pencarian pada container popup/portal. |
| 1.4.4 | **Perbaikan tuntas salah klik tombol "…" di post**: (1) perbaikan bug scoring fatal: menghapus `- depthOf(el) * 1000` pada `moreCandidateScore` yang sebelumnya menyebabkan tombol di post (DOM bersarang dalam) mendapat skor paling kecil dan selalu menang atas tombol profil; (2) deteksi presisi via ikon Instagram (pass 1): mencari tombol "…" yang sejajar horizontal di samping kanan link `instagram.com` pada header profil; (3) deteksi ketat via tombol aksi profil (pass 2): membatasi pencarian hanya di area header profil (antara navbar `top >= 65` dan di atas tombol Follow/Message `top <= topOf + 10`); (4) filter anti-post `isInsidePost`: mendeteksi tab bar profil (`Threads`/`Replies`) dan membuang semua elemen di bawah tab bar, serta membuang elemen yang memiliki tombol engagement post (Like/Reply/Repost). |
| 1.4.3 | **Perbaikan tombol "…" profil salah klik ke post**: tambah *anchor-based search* (pass 1) — cari tombol "…" di area header profil berdasarkan posisi tombol "Follow back"/"Message" sebagai titik acuan; exclude semua tombol "…" yang berada di dalam `article` / `[role="article"]` (card post); full search (pass 2) juga mengabaikan "…" di dalam post. Sebelumnya tombol "…" di tiap post ikut jadi kandidat dan sering terpilih karena memiliki `aria-label="More"` yang sama. |
| 1.4.2 | **Perbaikan mode "via profil"**: (1) deteksi navigasi ke profil lebih robust — username diambil dari `href` link (bukan `img.alt`), timeout navigasi naik 4→6 detik; (2) `sleep(1000)` setelah navigasi agar SPA sempat render header profil sebelum mencari tombol "…"; (3) `backToFollowers` — `sleep(600)` setelah `history.back()`, timeout tunggu modal naik ke 6 detik; (4) `verifyRemoved` mode profil — `waitFor` polling max 5 detik agar list benar-benar termuat sebelum menyimpulkan terverifikasi/tidak (bug kritis: sebelumnya semua aksi dianggap terverifikasi saat list belum render); (5) hapus duplikat key `followersTitle`/`followingTitle` di `patterns.js` |
| 1.4.1 | **Perbaikan klik tombol "…" profil**: cocokkan aria-label / title / teks "…" (elemen `button` / `role=button` / link / `tabindex`, bukan cuma yang ber-aria-label), pilih kandidat paling atas, coba sampai 3 kandidat hingga menu *Remove follower* muncul, rangkaian klik pointer+mouse (bukan klik sintetis tunggal); pola baru `Profile "…" button label` di panel Patterns; log daftar tombol terlihat bila tidak ketemu |
| 1.4.0 | **Mode ke-3: "Remove followers — via profil"** — dipakai bila di modal Followers tombolnya hanya `Follow back`; alur per orang: buka profil → tombol `…` → `Remove follower` → konfirmasi → kembali ke daftar (navigasi SPA tanpa reload, halaman Followers dibuka ulang otomatis); verifikasi = username hilang dari daftar |
| 1.3.1 | **Perbaikan baris yang "dilompati"**: percobaan "tidak jelas" (tombol/menu belum termuat) tidak lagi membakar jatah percobaan `maxRowAttempts` — dipisah ke `maxSoftAttempts` (6) sehingga baris tidak ter-skip permanen; baris yang tombolnya sudah `Follow` ditandai **bukan target** dan dilewati dengan penjelasan (tidak bakar jatah); log rincian saat tidak ada baris baru diproses (`rincian baris terlihat`); counter `· dilewati (bukan target)` di popup |
| 1.3.0 | **Patterns bisa diatur dari popup**: semua regex teks UI (aksi following/followers, menu remove, tombol "…", judul modal, kata kunci tambahan) dipindah ke `patterns.js` + panel **Patterns** di popup, tersimpan di `chrome.storage.local` dan langsung dipakai tab Threads (pesan `SET_PATTERNS`); pola invalid ditolak (nilai lama tetap dipakai); permission `storage` ditambahkan |
| 1.2.0 | **Perbaikan hitungan**: angka `Removed` sekarang diverifikasi ke DOM (aksi tanpa perubahan daftar tidak dihitung) + penghitung unik; START kedua tidak bisa membuat dua loop paralel; hanya elemen bisa-klik yang dicocokkan sebagai menu "Unfollow"; mode *following* tidak lagi bisa ter-klik "Follow" (anti ter-follow ulang); tombol **Recheck** + catatan "tidak terverifikasi" di popup |
| 1.1.0 | Badge versi (extension + content script) di popup; versi dikirim lewat `STATUS` / `DIAGNOSE` |
| 1.0.0 | Rilis awal: mode remove followers / remove following, delay, auto-scroll idle, debug log |

## Files
| File | Purpose |
|------|---------|
| `manifest.json` | Manifest V3, matches `threads.com` + `threads.net` |
| `patterns.js` | **Default pola teks (regex) + metadata field** untuk panel Patterns di popup (dipakai popup & content script) |
| `popup.html` / `.css` / `.js` | UI: mode, start/stop, delay, versi, **Patterns**, **Debug log**, **Diagnose**, **Test …**, **Recheck** |
| `content.js` | Otomasi + logging (jalan di dalam halaman Threads) |
| `icons/` | Ikon extension (16/48/128) |
| `make_icons.py` | Generator ikon (opsional) |

## Install di Chrome
1. Buka `chrome://extensions`.
2. Aktifkan **Developer mode** (toggle kanan atas).
3. Klik **Load unpacked** → pilih folder ini.
4. **Pin** extension (klik ikon 🧩 → pin 📌) — cukup sekali, Chrome mengingatnya.

## Cara hitungan "Removed" bekerja (penting)
`Removed` **bukan** jumlah klik, tapi jumlah baris yang benar-benar berubah di
daftar (diverifikasi ulang ke DOM setelah tiap aksi):

- ✔ dihitung → baris akun sudah hilang dari daftar (atau tombolnya bukan lagi
  `Following`). Setiap akun **hanya dihitung sekali** (disimpan sebagai set).
- ✖ **tidak** dihitung → aksi selesai tapi daftar tidak berubah; muncul di log
  sebagai `Diklaim sukses tapi TIDAK terverifikasi` dan jumlahnya tampil di
  popup sebagai `· tidak terverifikasi: N` (warna oranye).
- Percobaan "nyata" (ada klik / gagal verifikasi) dibatasi `CONFIG.maxRowAttempts`
  (2); percobaan "tidak jelas" — tombol/menu belum termuat, klik belum nyantol —
  punya jatah terpisah `CONFIG.maxSoftAttempts` (6) supaya baris **tidak** ter-skip
  permanen hanya karena UI belum siap (ini penyebab unfollow terasa "melompat").
- Baris yang tombolnya sudah `Follow`/`Follow back` **bukan target** (dia sudah
  tidak kamu-follow) → sengaja dilewati, dicatat di `state.notTarget`, muncul di
  popup sebagai `· dilewati (bukan target): N`, dan **tidak** dihitung.
- Saat tidak ada baris baru yang bisa diproses, log menampilkan rincian alasan:
  `{"barisTerlihat":N,"terverifikasi":..,"bukanTarget":..,"gagal":..,"tidakJelas":..}`.
- Hanya satu loop berjalan: menekan **Start** dua kali tidak akan membuat dua
  proses paralel (dulu ini sebabnya angka bisa ~2× dari penurunan nyata).

Tombol **Recheck** membandingkan daftar akun yang sudah dihitung dengan isi
daftar Threads saat ini, lalu melaporkan `{"modal":true,"terverifikasi":N,
"masihDiDaftar":0}` — pakai ini untuk memastikan angka di popup cocok dengan
kenyataan (mis. sesudah refresh halaman).

## Patterns — setting regex dari popup (v1.3.0+)
Buka panel **Patterns** di popup untuk mengubah pola teks (regex) yang dipakai
mendeteksi UI Threads. Tidak perlu edit file atau reload extension:

| Field | Dipakai untuk |
|-------|----------------|
| `Action button — Following mode` | tombol baris yang berarti masih following (hanya ini yang diklik di mode *Remove following*) |
| `Action button — Followers mode` | tombol aksi baris di daftar Followers & deteksi baris |
| `Remove option` | teks menu/dialog remove (default: `unfollow`, `remove follower`) |
| `Remove option — fallback` | cadangan bila pola utama tidak kena |
| `Extra keywords` | kata kunci tambahan (pisah koma, bukan regex) saat mencari menu remove |
| `More button label` | `aria-label` tombol "…" (More) di baris |
| `Modal title — Followers` / `— Following` | judul modal daftar yang dianggap target |

Cara kerja:
- **Save** → divalidasi dulu (`tfrValidatePatterns`). Pola invalid/kosong
  ditolak: field ditandai merah, nilai lama tetap dipakai, jadi salah ketik tidak
  akan membuat extension salah klik. Flag `i` (case-insensitive) otomatis.
- Nilai disimpan di `chrome.storage.local` (key `tfrPatterns`) dan langsung
  dikirim ke tab Threads lewat pesan `SET_PATTERNS` — **tidak perlu refresh tab**.
- **Reset default** mengembalikan semua field ke nilai di `patterns.js`.
- Saat tab Threads dimuat, content script juga membaca `chrome.storage.local`,
  jadi setting langsung ikut tanpa membuka popup.
- Pola yang sedang aktif muncul di log saat diterapkan (`Pola teks dipakai`) dan
  di output **Diagnose** (kunci `pola`).
- Kalau `patterns.js` tidak termuat, content script memakai pola "gagal-tertutup"
  (tidak mencocokkan apa pun) supaya tidak ada klik yang salah.

Ingin mengubah *default* (untuk semua orang)? Edit `TFR_DEFAULT_PATTERNS` di
`patterns.js` — field di popup dibuat otomatis dari `TFR_PATTERN_FIELDS`.

## Usage
1. Login **threads.com** → profil → buka tab **Followers** atau **Following**
   (pastikan modal terbuka).
2. Klik ikon extension → pilih **mode**, set **delay** (default 1000 ms) dan
   **auto-scroll idle** (detik, 0 = mati) → **Start**.
3. Pantau **Removed**, catatan **tidak terverifikasi**, dan **Debug log** di popup.
   **Stop** kapan saja. Setelah selesai, tekan **Recheck** untuk memastikan angka
   yang dihitung cocok dengan isi daftar.

## Debugging
- **Debug log** menampilkan tiap langkah: scan modal, klik tombol, menu remove, error.
- Setiap baris diakhiri status verifikasi:
  `✔ Terverifikasi (total N)` atau `✖ ... TIDAK terverifikasi — tidak dihitung`.
- Tombol **Recheck** membandingkan akun yang dihitung dengan isi daftar sekarang
  (mis. setelah refresh) → laporan JSON muncul di akhir log.
- Tombol **Diagnose** mengirim snapshot DOM: modal terbuka/tidak, jumlah tombol aksi,
  contoh teks tombol, jumlah menuitem — berguna saat selector meleset.
- Tombol **Test …** (v1.4.8) menguji klik tombol "…" di halaman yang **sedang
  terbuka** tanpa menjalankan loop — paling cepat untuk kasus "tombol … tidak bisa
  diklik". Cara pakai: buka halaman profil orang yang bermasalah → klik ikon
  extension → **Test …**. Log akan menampilkan
  `{strategiBerhasil, menuTerbuka, opsiRemoveDitemukan, isiMenu, riwayat}`:
  - `riwayat` berisi hasil tiap strategi klik, mis.
    `["pointer:menu+opsi"]` (berhasil pada klik pertama) atau
    `["pointer:terbuka-lalu-tertutup","native:menu+opsi"]` — artinya percobaan
    pertama membuka menu lalu menu tertutup lagi, dan strategi `native` berhasil.
  - Bila tiap strategi `tidak-ada-menu` → tombol yang dipilih bukan tombol "…"
    profil: tekan **Dump HTML** di halaman itu dan/atau isi field
    `Profile "…" selector` di panel **Patterns** (mis. `[aria-label="More"]`).
  - Bila hasilnya `menu-tanpa-opsi`, `isiMenu` menunjukkan label sebenarnya dari
    menu tersebut → tambahkan kata kuncinya di `Remove option` /
    `Extra keywords` (panel **Patterns**), tanpa perlu ubah kode.
- Popup menampilkan catatan khusus bila content script versi lama masih ter-inject
  (artinya: reload extension **lalu refresh tab**).
- Log juga muncul di console browser (F12) dengan prefix `[TFR]`.
- Jika Threads mengubah teks/bahasa UI, ubah polanya dari panel **Patterns** di
  popup (tidak perlu edit kode). Pola terkait: `ACTION_TEXT_RE` (tombol aksi,
  mode followers), `STILL_FOLLOWING_RE` (tombol "Following"), `REMOVE_ITEM_RE` /
  `REMOVE_FALLBACK_RE` + `REMOVE_TERMS` (menu remove), `MORE_LABEL_RE` (tombol "…"),
  `FOLLOWERS_TITLE_RE` / `FOLLOWING_TITLE_RE` (judul modal).

## Notes / limitations
- Permission: `activeTab`, `windows`, `storage` — tanpa tracking, tanpa network call.
  `storage` hanya menyimpan lokal di browser (setelan panel Patterns).
- Modal Threads memuat baris secara virtual — **scroll modal** bila daftar panjang
  agar baris berikutnya termuat (loop akan menunggu dan scan ulang).
- Verifikasi bergantung pada DOM daftar: kalau kamu menutup modal di tengah proses,
  aksi yang belum terverifikasi tidak dihitung (muncul sebagai *tidak terverifikasi*).
- Aksi asli tetap dilakukan oleh klik UI Threads; extension tidak bisa memastikan
  pihak Meta benar-benar memproses permintaan server — karena itu hitungan
  diverifikasi dari perubahan daftar, bukan dari klik.
