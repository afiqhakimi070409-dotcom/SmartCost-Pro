# SmartCost Deployment Guide (Cloudflare Frontend + External Backend)

Panduan ringkas untuk menerbitkan **SmartCost** di luar AI Studio dengan **Frontend di Cloudflare** (Pages / Workers) dan **Backend di Render** (atau pelayan Node.js/Express berasingan).

---

## 1. Senarai Pembolehubah Persekitaran & Lokasi Tetapan

> **Amaran Keselamatan:** Jangan masukkan sebarang kunci rahsia (`GEMINI_API_KEY`, `SESSION_SECRET`, `DEV_ACCESS_SECRET`) ke dalam kod frontend (`src/`), fail `.env` yang dimuat naik ke GitHub, atau pembolehubah awalan `VITE_*`.

| Pembolehubah | Di Mana Diletakkan | Keterangan |
| :--- | :--- | :--- |
| **`VITE_API_BASE_URL`** | **Cloudflare** (Build Environment Variable) | Alamat penuh pelayan backend Render anda (cth: `https://smartcost-backend.onrender.com`). Biarkan kosong hanya jika frontend dan Worker/Express dihoskan pada domain yang sama. |
| **`GEMINI_API_KEY`** | **Backend Render** (Environment Variables) *(atau Cloudflare Worker Secrets jika tiada Render)* | Kunci API Google Gemini untuk Mr Cost AI. Semua panggilan Gemini diproses di backend sahaja (`/api/mrcost/chat`). |
| **`SESSION_SECRET`** | **Backend Render** *(dan Worker Secrets jika guna Worker)* | Rentetan rawak 64 aksara hex untuk menandatangani token sesi HMAC-SHA256. |
| **`ALLOWED_ORIGINS`** | **Backend Render** *(pilihan)* | Senarai domain frontend tambahan dipisahkan koma (cth: `https://app.domainanda.com`). Domain `*.pages.dev`, `*.workers.dev`, dan `*.onrender.com` dibenarkan secara automatik. |
| **`DEV_ACCESS_SECRET`** | **Backend Render** *(pilihan)* | Rahsia akses manual pembangun (Alt+D). Log masuk Google Pembangun masih berfungsi walaupun tidak ditetapkan. |
| **`ORIGIN_API_URL`** | **Cloudflare Worker** *(pilihan, jika proxy melalui Worker)* | URL backend Render apabila menggunakan Cloudflare Worker sebagai reverse proxy same-origin. |

---

## 2. Tetapan Firebase (Authentication & Firestore)

Konfigurasi klien Web Firebase sedia ada disimpan dalam `firebase-applet-config.json` (bukan rahsia pelayan):
- **`projectId`**, **`appId`**, **`apiKey`**, **`authDomain`**, **`firestoreDatabaseId`**, **`storageBucket`**, **`messagingSenderId`**

### Langkah Wajib Selepas Deploy ke Cloudflare / Custom Domain:
1. Buka **Firebase Console** > **Authentication** > **Settings** > **Authorized domains**.
2. Klik **Add domain** dan masukkan domain Cloudflare anda (contohnya `nama-projek.pages.dev`, `nama-worker.workers.dev`, atau domain tersuai anda).
3. Jika domain belum ditambah, log masuk Google akan memaparkan nama domain semasa (`window.location.hostname`) supaya pembangun tahu domain yang perlu dibenarkan.

---

## 3. Ringkasan Deploy

### A. Backend (Render Web Service)
- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm start` (`node dist/server.cjs` pada `PORT`)
- **Environment Variables:** Tetapkan `GEMINI_API_KEY`, `SESSION_SECRET`, dan `NODE_ENV=production`.

### B. Frontend (Cloudflare Pages / Workers)
- **Build Command:** `npm run build` (output: `dist`)
- **Build Environment Variable:** Tetapkan `VITE_API_BASE_URL` = URL perkhidmatan Render anda.
