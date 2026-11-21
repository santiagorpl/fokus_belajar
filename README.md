# FocusTune – Music & Study Timer

Aplikasi **Pomodoro timer** dengan musik, album, noise generator, statistik fokus, dan bisa dipasang di HP sebagai **PWA**. Dibuat dengan **HTML, CSS, dan JavaScript murni (Vanilla JS)** — **tanpa framework, tanpa backend, tanpa database server**.

---

## ✨ Fitur

### Timer & sesi
- Durasi belajar/istirahat dan jumlah sesi bisa diatur.
- Preset cepat: `25/5`, `50/10`, `15/3`, `30/10`.
- Kontrol **MULAI, JEDA, LANJUTKAN, RESET** (aman dari double-start).
- Timer berbasis timestamp, tetap akurat walau tab tidak aktif.
- Alarm **BEEP** Web Audio API pada detik ke-10 sampai ke-1.
- Catatan tugas per sesi ikut tersimpan di riwayat.

### Musik & album
- Upload banyak lagu (MP3/WAV/OGG/M4A) sekali saja, lewat tombol **+ Unggah** atau **drag & drop** ke kartu pustaka.
- **Album**: buat album, pindah lagu antar album, hapus album.
- Tombol **B / I** untuk memindahkan lagu ke kategori **Belajar** atau **Istirahat** tanpa upload ulang.
- Tombol **✎** mengganti judul tampilan lagu, **⬇** mengunduh file lagu aslinya.
- Pemutar: play/pause, next, previous, pilih lagu, shuffle, seek, volume.
- **Crossfade halus** saat pindah fase.
- **Visualizer equalizer** memakai `AnalyserNode`.
- 3 mode musik: Belajar, Istirahat, Keduanya.

### Suara & statistik
- **Noise generator**: Hujan, White Noise, Kafe — dibuat langsung oleh Web Audio API, tanpa file.
- Grafik fokus 7 hari terakhir (`canvas` murni) + **streak** harian.
- Riwayat sesi (maksimal 30 entri).
- Notifikasi browser saat pergantian fase (opsional).
- Keyboard shortcut: `Space`, `N`, `P`, `S`, `R`, `?`.
- Wake Lock agar layar HP tidak mati saat timer berjalan.

### Mobile / PWA
- Responsif di laptop dan HP.
- Bisa di-install ke home screen Android/iOS lewat browser.
- Service worker membuat aplikasi bisa dipakai **offline**.

---

## 📁 Struktur Project

```text
focustune/
├── .gitignore
├── README.md
├── index.html
├── manifest.webmanifest
├── sw.js
├── css/
│   └── style.css
├── js/
│   ├── app.js
│   ├── timer.js
│   ├── music.js
│   ├── alarm.js
│   └── storage.js
└── assets/
    └── icons/
        ├── favicon.svg
        ├── icon-192.png
        └── icon-512.png
```

---

## 🚀 Cara Menjalankan

### VS Code + Live Server
1. Buka folder `focustune` di VS Code.
2. Install ekstensi **Live Server** (Ritwick Dey).
3. Klik kanan `index.html` → **Open with Live Server**.
4. Buka `http://127.0.0.1:5500`.

### Python
```bash
cd focustune
python -m http.server 5500
```

> Service worker dan PWA butuh `localhost` atau HTTPS. Jangan buka dengan `file://`.

---

## 📱 Cara Pasang di HP (PWA)

Cara paling mudah: **GitHub Pages** (gratis & HTTPS).

1. Push project ini ke GitHub.
2. Buka repo → **Settings → Pages**.
3. Pilih **Source: Deploy from a branch** → branch `main` → folder **/(root)** → Save.
4. Tunggu beberapa menit, lalu buka:
   ```text
   https://santiagorpl.github.io/fokus_belajar/
   ```
5. Di HP:
   - **Chrome Android**: menu ⋮ → **Install app** / **Add to Home screen**
   - **Safari iOS**: tombol Share → **Add to Home Screen**

Setelah dipasang, ikon FocusTune muncul di home screen dan bisa dibuka seperti aplikasi biasa, termasuk offline.

## 🤖 APK Android (sudah jadi)

Selain PWA, aplikasi ini juga sudah dikemas jadi **APK asli** dengan Capacitor.

```text
D:\santiago\waktu_belajar\FocusTune-v1.0.apk
```

Cara pasang:
1. Copy APK ke HP.
2. Buka dari File Manager → izinkan **Install unknown apps**.
3. Tekan **Install**, lalu buka aplikasi **FocusTune**.

APK sudah signed, berjalan offline, dan memakai ikon FocusTune. Detail build, cara rebuild, dan catatan keystore ada di:

```text
D:\santiago\waktu_belajar\focustune-apk\README.md
```

> PWA dan APK memakai kode sumber yang sama. Pilih mana saja yang paling nyaman: PWA cukup buka URL, APK tinggal install file.

---

## 💾 Penyimpanan Data (tetap lokal)

| Data | Tempat |
|---|---|
| Pengaturan, notifikasi, riwayat, log fokus/streak | `localStorage` |
| Album dan file MP3/WAV/OGG/M4A | `IndexedDB` |

Tidak ada data yang dikirim ke server. Jika ingin sinkron antar perangkat/login, baru perlu backend + database (Supabase/Firebase).

### Backup tanpa server
- **Pengaturan → Ekspor Backup (.json)**: menyimpan pengaturan, riwayat, log fokus/streak, dan daftar album.
- **Impor Backup (.json)**: memulihkan data tersebut di perangkat/browser lain.
- File audio sengaja tidak dimasukkan ke JSON agar ukurannya kecil. Simpan/pindahkan file lagu lewat tombol **⬇** pada tiap lagu, lalu unggah lagi di perangkat tujuan.

---

## 🎵 Cara Pakai Singkat

1. Buka **Musik → Album**, buat album misalnya “Fokus Pagi”.
2. Pilih album itu, lalu unggah 5 lagu sekalian di **Musik Belajar** / **Musik Istirahat**.
3. Klik tombol **B** atau **I** pada lagu untuk mengubah kategori tanpa upload ulang.
4. Nyalakan noise di **Musik → Suara Latar** kalau suka.
5. Klik **MULAI** di Timer (sekali klik juga mengizinkan audio/browser).
6. Alarm bunyi saat tersisa 10 detik; musik otomatis pindah fase dengan crossfade.

Tips uji cepat: preset `15/3` atau atur **Belajar = 1 menit, Istirahat = 1 menit, Sesi = 2**.

---

## 📤 Update ke GitHub

```bash
cd focustune
git add .
git commit -m "Update FocusTune - album, noise, statistik, PWA"
git push
```

---

Dibuat untuk belajar. Silakan dimodifikasi sesuai kebutuhan.
