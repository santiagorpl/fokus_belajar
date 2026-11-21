# FocusTune – Music & Study Timer

Aplikasi web **Pomodoro timer** dengan musik otomatis, alarm hitung mundur, dan penyimpanan lokal. Dibuat dengan **HTML, CSS, dan JavaScript murni (Vanilla JS)** tanpa framework dan tanpa backend.

---

## ✨ Fitur

- Timer belajar/istirahat dengan jumlah sesi yang bisa diatur.
- Kontrol **MULAI**, **JEDA**, **LANJUTKAN**, dan **RESET** (aman dari double-start).
- Timer berbasis timestamp, tetap akurat meskipun tab browser tidak aktif.
- Upload beberapa lagu untuk kategori **Belajar** dan **Istirahat**.
- Pemutar musik: play/pause, next, previous, pilih lagu, shuffle, seek, dan volume.
- Musik berganti otomatis mengikuti fase timer.
- 3 mode musik: **Belajar**, **Istirahat**, atau **Keduanya**.
- Alarm **BEEP** dengan Web Audio API pada detik ke-10 sampai ke-1.
- Notifikasi suara + pesan **SELAMAT! SEMUA SESI SELESAI**.
- Riwayat sesi (maksimal 30 entri terakhir).
- Pengaturan, riwayat → `localStorage`.
- File lagu → `IndexedDB` (tetap tersedia setelah refresh/tutup browser).
- Tampilan modern, dark green, responsif untuk desktop dan mobile.

---

## 📁 Struktur Project

```text
focustune/
├── index.html
├── css/
│   └── style.css
├── js/
│   ├── app.js       # menghubungkan UI dengan seluruh modul
│   ├── timer.js     # logika Pomodoro & sesi
│   ├── music.js     # pustaka lagu, pemutar, perpindahan fase
│   ├── alarm.js     # suara beep & notifikasi (Web Audio API)
│   └── storage.js   # localStorage + IndexedDB
└── assets/
    └── icons/
        └── favicon.svg
```

---

## 🚀 Cara Menjalankan

### Opsi 1 — VS Code + Live Server (direkomendasikan)

1. Buka VS Code.
2. `File → Open Folder…` lalu pilih folder `focustune`.
3. Install ekstensi **Live Server** (Ritwick Dey) jika belum ada.
4. Klik kanan `index.html` → **Open with Live Server**.
5. Browser akan membuka `http://127.0.0.1:5500/index.html`.

### Opsi 2 — Python (tanpa ekstensi)

```bash
cd focustune
python -m http.server 5500
```

Lalu buka `http://localhost:5500`.

> Disarankan memakai web server (bukan membuka `index.html` dengan `file://`) agar IndexedDB dan autoplay berperilaku normal.

---

## 🎵 Cara Pakai Singkat

1. Buka menu **Musik**, unggah lagu belajar dan/atau lagu istirahat.
2. Pilih mode musik di **Pengaturan** atau halaman **Musik**.
3. Kembali ke **Timer**, atur durasi & jumlah sesi.
4. Klik **MULAI** — klik ini juga mengizinkan browser memutar audio.
5. Saat tersisa 10 detik, alarm akan berbunyi setiap detik sampai detik ke-1.

### Tips uji cepat
Atur **Belajar = 1 menit**, **Istirahat = 1 menit**, **Sesi = 2**. Dengan begitu satu siklus penuh selesai dalam 4 menit.

> Jika autoplay diblokir browser, klik sekali tombol **▶** pada pemutar musik. Setelah itu lagu akan otomatis mengikuti fase timer.

---

## 💾 Penyimpanan Data

| Data | Tempat | Keterangan |
|---|---|---|
| Pengaturan waktu, sesi, mode, volume, alarm | `localStorage` | Tersimpan per browser |
| Riwayat sesi | `localStorage` | Maksimal 30 entri |
| File MP3/WAV/OGG/M4A | `IndexedDB` | Disimpan sebagai Blob, tidak perlu upload ulang |

Data **tidak dikirim ke server** dan hanya tersedia di perangkat/browser yang dipakai. Untuk sinkronisasi lintas perangkat atau login, aplikasi perlu dikembangkan dengan backend + database (Firebase/Supabase/MySQL).

---

## 📤 Upload ke GitHub

Jika folder ini belum menjadi repository:

```bash
cd focustune
git init
git add .
git commit -m "Initial commit - FocusTune Music & Study Timer"
git branch -M main
git remote add origin https://github.com/USERNAME/NAMA_REPO.git
git push -u origin main
```

Ganti `USERNAME` dan `NAMA_REPO` dengan milik kakak.

---

## ✅ Kompatibilitas Browser

Ditujukan untuk browser modern: Chrome, Edge, Firefox, dan Safari versi terbaru. Fitur yang dipakai: `IndexedDB`, `URL.createObjectURL`, `Web Audio API`, `async/await`, dan `Element.closest`.

---

Dibuat untuk kegiatan belajar. Silakan dimodifikasi sesuai kebutuhan.
