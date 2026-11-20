# Panduan Deployment Pengeluaran Kos Sifar SmartCost (RM0.00 / Bulan)
**Seni Bina:** Cloudflare Pages Free (`dist/`) + Cloudflare Workers Free (`workers/smartcost-edge-worker.ts`) + Firebase Authentication & Firestore Enterprise (`reflecting-booth-740ks`)

---

## FASA 1 — Audit Konfigurasi Cloudflare & Build

| Komponen | Fail / Tetapan | Status & Fungsi | Kos |
|---|---|---|---|
| Konfigurasi Worker | `wrangler.toml` | `name = "smartcost-zero-cost-gateway"`, `main = "workers/smartcost-edge-worker.ts"`, `compatibility_date = "2026-01-01"`, `workers_dev = true`, **tiada Durable Objects / KV berbayar / Load Balancer berbayar** | **RM0.00** |
| Edge Gateway | `workers/smartcost-edge-worker.ts` | Menangani `/healthz`, `/api/health`, `/api/config/features`, `/api/edge/capabilities`, CORS allowlisted (`*.pages.dev`, `*.run.app`, `localhost`), pra-penerbangan `OPTIONS`, dan proksi `ORIGIN_API_URL` dengan diagnostik `503 ORIGIN_API_URL_NOT_CONFIGURED` berstruktur (tiada `501` tanpa penjelasan) | **RM0.00** |
| Frontend Build | `vite.config.ts` -> `npm run build` -> `dist/` | Output statik di bawah had fail tunggal **25 MiB** Cloudflare Pages Free | **RM0.00** |
| Pemisahan Origin API | `src/utils/apiBase.ts` | Semua panggilan `/api/*` klien menggunakan `apiUrl(...)` (`VITE_API_BASE_URL`, lalai `""` untuk same-origin, atau URL `*.workers.dev` apabila dihoskan secara terpisah di `*.pages.dev`) | **RM0.00** |
| Pengepala Keselamatan Statik | `public/_headers` -> `dist/_headers` | `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `X-SmartCost-Cost-Tier: RM0.00-Free-Tier` | **RM0.00** |
| CORS & Proksi Origin | `server.ts` (`trust proxy`, allowlist CORS + `https://*.workers.dev` CSP) | Mengesahkan asal `*.pages.dev` & penghantaran header sesi (`X-SmartCost-Session`, `X-CSRF-Token`, `Authorization`) merentasi asal | **RM0.00** |

---

## FASA 2 — Jadual Keserasian Lengkap Semua 49 Endpoint Express (`server.ts`) + 1 Endpoint Edge

Semua laluan backend SmartCost telah diaudit dan diklasifikasikan mengikut **5 kategori wajib**:

### 1. Boleh Diproses Terus Oleh Cloudflare Workers Free (< 2 ms CPU)
- `GET /healthz` — Pemeriksaan kesihatan Edge & status `originConfigured`.
- `GET /api/health` — Semakan sambungan rangkaian & status gateway (`logicalPool`).
- `GET /api/config/features` — Bendera ciri bukan rahsia (`devEntryEnabled`, `zeroCostEdgeMode`) apabila origin tidak dikonfigurasikan atau diproksi ke origin.
- `GET /api/edge/capabilities` — Diagnostik keupayaan Edge & senarai laluan (sifar rahsia didedahkan).
- `OPTIONS /api/*` — Pra-penerbangan CORS selamat bagi domain Cloudflare Pages (`*.pages.dev`).

### 2. Memerlukan Express Origin (`ORIGIN_API_URL` + Runtime Loopback / Disk Node.js)
- `GET /api/infra/usage-limits` — Pengiraan kuota percuma berbanding penggunaan semasa.
- `GET /api/infra/overview` — Ringkasan nod pelayan, memori Node.js, trafik dan baki kuota.
- `POST /api/infra/health-check` — Ujian probe HTTP langsung ke nod loopback pelayan.
- `POST /api/infra/servers/:nodeId/mode` — Tukar mod `ACTIVE` / `MAINTENANCE` / `OFFLINE`.
- `POST /api/infra/load-balancer/test` — Ujian agihan permintaan `round_robin` / `least_connections` / `health_based` / `failover`.
- `POST /api/infra/config` — Simpan tetapan infrastruktur (`data/infra_config.json`).
- `GET /api/infra/logs` — Log peristiwa infrastruktur pelayan.
- `GET /api/infra/security` — Telemetri keselamatan, cubaan gagal log masuk dan kunci kadar.
- `GET /api/infra/backups` — Senarai fail sandaran cakera berasingan (`data/backups/`).
- `POST /api/infra/backups/create` — Jana sandaran berasingan bersama checksum `SHA-256`.
- `POST /api/infra/backups/verify` — Semak integriti fail sandaran menggunakan `SHA-256`.
- `GET /api/infra/backups/:backupId/download` — Muat turun fail sandaran disahkan.
- `POST /api/infra/backups/restore-preview` — Pratonton keselamatan pemulihan tanpa mengubah rekod.
- `POST /api/infra/backups/restore` — Pemulihan selamat pangkalan data (dengan pra-sandaran automatik).
- `POST /api/infra/firestore-telemetry` — Rekod latensi ping Firestore dari klien ke telemetri pelayan.
- `POST /api/telemetry/firestore-ops` — Rekod bilangan operasi baca/tulis Firestore klien.

### 3. Memerlukan Pangkalan Data Stateful (`data/*.json` + Pengasingan RBAC)
*(Nota: Baca/tulis rekod syarikat & produk di **Firestore Enterprise `reflecting-booth-740ks`** turut berjalan terus dari klien React melalui Firebase Web SDK dan `firestore.rules` tanpa Express).*
- `GET /api/databases/list` — Senarai pendaftaran pangkalan data (dikawal ketat: pembangun sahaja / terasing mengikut syarikat).
- `GET /api/databases/active` — Baca kunci pangkalan data aktif semasa untuk sesi.
- `POST /api/databases/active` — Kemas kini kunci pangkalan data aktif dengan semakan `canUserAccessDatabase`.
- `POST /api/databases/inspect` — Mod pemeriksaan pembangun baca-sahaja ke atas DB syarikat.
- `POST /api/databases/clone-sandbox` — Klon data syarikat ke ruang ujian sandbox pembangun secara selamat.
- `POST /api/databases/register` — Daftar kunci DB baharu/sedia ada dalam registri `data/server_databases.json`.
- `POST /api/auth/delete-company-db` — Pemadaman kekal DB syarikat (memerlukan sesi Pembangun Sah + kata pengesahan).
- `GET /api/mrcost/history` — Muat turun sejarah perbualan Mr Cost terasing per `databaseId`.
- `POST /api/mrcost/history` — Simpan sejarah perbualan Mr Cost terasing per `databaseId`.
- `DELETE /api/mrcost/history` — Kosongkan sejarah perbualan Mr Cost bagi `databaseId` semasa.
- `GET /api/admin/users` — Senarai pengguna syarikat untuk Matriks Akses (Pentadbir/Pembangun).
- `POST /api/admin/users/role` — Tukar peranan RBAC pengguna dengan pengesahan semula kata laluan Admin.
- `POST /api/admin/backup/export` — Eksport JSON sandaran syarikat yang disanitasi kata laluan.
- `POST /api/admin/backup/validate` — Pengesahan skema fail JSON sandaran sebelum import.
- `POST /api/admin/backup/import` — Import/gabung sandaran JSON ke pangkalan data syarikat.
- `GET /api/admin/backup/audit-log` — Log audit aktiviti eksport/import sandaran.

### 4. Memerlukan Sesi Pengguna (`server_users.json` / `server_sessions.json` + `bcryptjs` HMAC)
*(Nota: `bcryptjs` cost-12 menggunakan >100 ms CPU dan melebihi had **10 ms CPU** Cloudflare Workers Free; oleh itu kekal di Express origin sehingga/melainkan migrasi ke D1 + PBKDF2 diluluskan pembangun. Pengguna Google Sign-In pula disahkan terus oleh Firebase Authentication).*
- `GET /api/auth/session` — Semak kesahihan sesi aktif, peranan RBAC, dan masa tamat tidak aktif.
- `POST /api/auth/register-manual` — Daftar akaun manual baharu (peranan lalai `staf`, hash `bcryptjs` cost-12).
- `POST /api/auth/bootstrap-admin` — Pengaktifan kata laluan awal akaun pentadbir utama (`admin`).
- `POST /api/auth/login-manual` — Log masuk nama pengguna/emel & kata laluan dengan had kadar (`rate limit`).
- `POST /api/auth/session-firebase` — Tukar Firebase ID Token sah kepada sesi pelayan bertandatangan HMAC.
- `POST /api/auth/session-dev` — Pengesahan sesi pembangun sistem (`Alt+D`, kata laluan `bcryptjs`).
- `GET /api/auth/dev-audit` — Semakan audit keselamatan akses pembangun.
- `POST /api/auth/logout` — Tamatkan dan padam token sesi daripada `server_sessions.json`.
- `POST /api/auth/reauthenticate` — Pengesahan semula kata laluan sebelum operasi berisiko tinggi.
- `POST /api/auth/password-reset/request` — Jana permintaan tetapan semula kata laluan selamat.
- `POST /api/auth/password-reset/confirm` — Sahkan token & kemas kini hash kata laluan baharu.
- `POST /api/auth/change-password` — Tukar nama pengguna dan/atau kata laluan (mengemaskini sumber tunggal kebenaran DB).
- `POST /api/auth/link-manual` — Pautkan kata laluan manual kepada akaun log masuk Google.

### 5. Memerlukan Proksi Gemini AI (`GEMINI_API_KEY` Pelayan + Tapisan Privasi)
- `POST /api/mrcost/chat` — Memproses soalan Mr Cost AI (streaming SSE & fallback JSON), menyemak kebenaran sesi & `databaseId`, menapis medan sensitif (`mrCostPrivacy.ts`), memanggil Gemini SDK menggunakan `GEMINI_API_KEY` sebelah pelayan sahaja, dan menyimpan sejarah perbualan.

> **Tingkah Laku Jika `ORIGIN_API_URL` Belum Ditetapkan pada Worker:**
> Worker **tidak** memulangkan ralat `501` kosong. Sebaliknya, Worker memulangkan **HTTP `503`** dengan kod `ORIGIN_API_URL_NOT_CONFIGURED`, kategori tepat (`user_session_required`, `gemini_ai_proxy_required`, `stateful_database_required`, atau `express_origin_required`), sebab teknikal, dan alternatif operasi.

---

## FASA 3 — Jaminan Keselamatan Pangkalan Data Asal

- **Firebase Project ID dikekalkan:** `reflecting-booth-740ks`
- **Firestore Enterprise Database ID dikekalkan:** `ai-studio-remixsmartcostpr-940297e1-af61-42e5-8469-9bca8d60c481`
- **Firestore Rules (`firestore.rules`) & Pengasingan (`ownerId`, `companyId`):** Tidak diubahsuai atau dilemahkan.
- **Tiada Auto-Migrasi D1 / KV:** Fail `data/server_users.json` dan `data/server_sessions.json` kekal terpelihara; tiada akaun pengguna dipindahkan atau dipadamkan.
- **Kandungan `.gitignore`:** `data/`, `*.backup.json`, `.env*`, dan `.wrangler/` dikecualikan daripada GitHub supaya tiada data syarikat atau token sesi dimuat naik ke repositori.

---

## FASA 4 — Keselamatan Secrets & Konfigurasi Alam Sekitar

**JANGAN SEKALI-KALI** menulis rahsia berikut dalam kod sumber, `wrangler.toml`, atau repositori GitHub:

| Pemboleh Ubah | Lokasi Tetapan Selamat | Kegunaan & Nota Keselamatan |
|---|---|---|
| `GEMINI_API_KEY` | Tetapan Environment/Secret pada **Express Origin** (JANGAN letak prefix `VITE_`) | Digunakan oleh `/api/mrcost/chat` di pelayan sahaja. Tidak pernah dihantar ke pelayar. |
| `SESSION_SECRET` | Tetapan Environment/Secret pada **Express Origin** | Rentetan heksadesimal rawak 64 aksara untuk tandatangan HMAC token sesi (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). |
| `ORIGIN_API_URL` | Cloudflare Worker Secret: `npx wrangler secret put ORIGIN_API_URL` | URL HTTPS Express origin anda (cth. URL AI Studio / VPS / tunnel HTTPS percuma). |
| `VITE_API_BASE_URL` | Tetapan Build Environment **Cloudflare Pages** (jika guna Worker terpisah) | URL `https://smartcost-zero-cost-gateway.<subdomain>.workers.dev`. Biarkan kosong (`""`) untuk same-origin. |
| `ALLOWED_ORIGINS` | Pemboleh ubah Worker / Express Origin (pilihan) | Domain tersuai tambahan selain `*.pages.dev` & `*.run.app` (cth. `https://smartcost.syarikatanda.com`). |

**Peringatan Penting Firebase Authentication (`reflecting-booth-740ks`):**
Selepas domain `https://<projek-anda>.pages.dev` dicipta, buka **Firebase Console -> Authentication -> Settings -> Authorized domains** dan tambahkan `<projek-anda>.pages.dev` supaya Google Sign-In berfungsi pada domain Cloudflare Pages. *(Nota: Nilai `apiKey` dan `projectId` dalam `firebase-applet-config.json` adalah pengecam awam klien Firebase dan dilindungi oleh `firestore.rules` — pastikan anda turut menyemak dan mengekalkan peraturan akses ketat pada Firebase Console).*

---

## FASA 5 — Tutorial Deployment Langkah Demi Langkah (10 Langkah, RM0.00/Bulan)

### Langkah 1: Log Masuk Cloudflare (Pelan Percuma)
1. Layari [dash.cloudflare.com](https://dash.cloudflare.com) dan daftar atau log masuk akaun **Free**.
2. Pastikan tiada pelan berbayar atau kad kredit diaktifkan; semak bahagian *Billing* kekal **Free (RM0.00)**.
3. **Hasil Dijangka:** Papan pemuka Cloudflare terbuka tanpa sebarang langganan berbayar aktif.

### Langkah 2: Hubungkan Kod Sumber ke GitHub (Repositori Persendirian Percuma)
1. Sahkan `.gitignore` mengandungi `data/`, `.env`, `.env.*`, dan `.wrangler/`.
2. Tolak (*push*) kod projek SmartCost ke repositori GitHub persendirian anda (pelan GitHub Free).
3. Semak pada GitHub bahawa tiada fail `.env`, `GEMINI_API_KEY`, `server_users.json`, atau `data/backups/` berada dalam sejarah commit.
4. **Hasil Dijangka:** Repositori GitHub tersedia dengan kod sumber bersih dan sifar rahsia/data pengguna terdedah.

### Langkah 3: Deploy Frontend ke Cloudflare Pages (Free Tier)
1. Dalam papan pemuka Cloudflare, pilih **Workers & Pages -> Create -> Pages -> Connect to Git**.
2. Pilih repositori GitHub SmartCost dan tetapkan:
   - **Production branch:** `main`
   - **Framework preset:** `Vite` (atau `None`)
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
3. Tambah Build Environment Variable (jika Worker berada di subdomain berasingan): `VITE_API_BASE_URL` = URL Worker dari Langkah 4 (boleh dikemas kini dan *Retry deployment* sejurus selepas Langkah 4).
4. Klik **Save and Deploy**.
5. **Hasil Dijangka:** Binaan selesai tanpa ralat, setiap fail dalam `dist/` < 25 MiB, pengepala dalam `dist/_headers` aktif, dan URL `https://<nama-projek>.pages.dev` memaparkan skrin Log Masuk SmartCost.

### Langkah 4: Deploy Cloudflare Worker (Free Tier)
1. Di terminal projek tempatan anda, sahkan sesi Wrangler:
   ```bash
   npx wrangler login
   ```
2. Uji binaan dan lancarkan Worker percuma:
   ```bash
   npx wrangler deploy
   ```
3. Catatkan URL Worker yang diberikan (cth. `https://smartcost-zero-cost-gateway.<akaun>.workers.dev`).
4. **Hasil Dijangka:** `GET https://<worker-url>/healthz` dan `GET https://<worker-url>/api/edge/capabilities` memulangkan `HTTP 200 OK` dengan `"monthlyCost": "RM0.00"`. Jika `VITE_API_BASE_URL` disetkan di Langkah 3, lakukan *redeploy* Pages sekali lagi.

### Langkah 5: Konfigurasi API Origin (`ORIGIN_API_URL`)
1. Pastikan Express origin (`server.ts`) berjalan di host Node.js percuma / terowong HTTPS selamat (cth. URL origin HTTPS anda yang aktif dengan `trust proxy` dan CORS terpasang).
2. Jika origin belum diikat, akses terus ke laluan `/api/mrcost/chat` melalui Worker akan memulangkan JSON diagnostik `503 ORIGIN_API_URL_NOT_CONFIGURED` yang jelas (bukan `501` kosong).
3. **Hasil Dijangka:** API Express boleh dicapai melalui HTTPS tanpa mendedahkan port dalaman secara tidak selamat.

### Langkah 6: Tetapkan Encrypted Secrets (Cloudflare Worker & Express Origin)
1. Pada mesin terminal, simpan `ORIGIN_API_URL` ke dalam storan rahsia tersulit Cloudflare Worker:
   ```bash
   npx wrangler secret put ORIGIN_API_URL
   ```
   *(Masukkan URL HTTPS Express origin anda, contoh tanpa slash di hujung).*
2. Pada tetapan rahsia Express origin anda, tetapkan `GEMINI_API_KEY` dan `SESSION_SECRET` (64 aksara hex rawak).
3. Dalam **Firebase Console (`reflecting-booth-740ks`) -> Authentication -> Settings -> Authorized domains**, tambahkan domain `*.pages.dev` anda.
4. **Hasil Dijangka:** `GET https://<worker-url>/healthz` memulangkan `"originConfigured": true`, dan tiada rahsia dipaparkan dalam log binaan atau respons API.

### Langkah 7: Uji Log Masuk (Manual & Google Sign-In)
1. Buka URL Cloudflare Pages (`https://<projek>.pages.dev`).
2. Cuba log masuk menggunakan akaun manual yang disahkan atau akaun Google Sign-In.
3. Sahkan tiada ralat CORS pada DevTools Network dan panggilan `POST /api/auth/login-manual` atau `POST /api/auth/session-firebase` memulangkan `HTTP 200` bersama `sessionToken`.
4. **Hasil Dijangka:** Pengguna masuk ke Papan Pemuka Utama SmartCost dengan peranan RBAC tepat.

### Langkah 8: Uji Pangkalan Data & Pengasingan Syarikat (Firestore Enterprise)
1. Uji tambah atau kemas kini bahan mentah/produk pada halaman Kos Standard & Kos Sebenar.
2. Segarkan semula pelayar (*refresh*) dan sahkan data dimuatkan semula daripada pangkalan data syarikat pengguna itu sahaja (Firestore Enterprise `reflecting-booth-740ks`).
3. Uji akses pengguna bukan pembangun ke `/api/databases/list`: pelayan wajib memulangkan `HTTP 403` (tidak boleh melihat senarai syarikat lain).
4. **Hasil Dijangka:** Pengasingan pangkalan data per syarikat dan formula pengekosan kekal tepat 100%.

### Langkah 9: Uji Mr Cost AI (`/api/mrcost/chat`)
1. Buka tab **Mr Cost AI** di dalam ruang kerja syarikat.
2. Hantar soalan analisis kos (contoh: *"Kirakan titik pulang modal semasa produk ini"*).
3. Sahkan permintaan melalui `VITE_API_BASE_URL` -> Cloudflare Worker -> Express Origin -> Gemini API memulangkan jawapan penstriman SSE / JSON tanpa mendedahkan `GEMINI_API_KEY` di rangkaian pelayar.
4. **Hasil Dijangka:** Jawapan tepat mengikut data produk syarikat semasa dipaparkan dan sejarah disimpan mengikut `databaseId`.

### Langkah 10: Uji Backup & Recovery
1. Buka **Konsol Pembangun (`Alt+D`) -> Pengurusan Pelayan & Pangkalan Data -> Backup / Pemulihan**.
2. Cipta sandaran (`POST /api/infra/backups/create`) atau eksport sandaran JSON syarikat (`POST /api/admin/backup/export`).
3. Jalankan semakan integriti **SHA-256** (`POST /api/infra/backups/verify`) dan **Pratonton Pemulihan** (`POST /api/infra/backups/restore-preview`).
4. **Hasil Dijangka:** Status `SHA-256 VERIFIED`, tiada kata laluan teks biasa dalam fail eksport, dan pratonton pemulihan memaparkan kiraan rekod dengan tepat tanpa menjejaskan akaun pengguna.
