1. **Buat file server.js menggunakan Express.js**
   - Import dependency (express, telegram, dotenv, mime-types).
   - Inisialisasi Express app.
   - Buat fungsi untuk handle koneksi ke Telegram API menggunakan `TelegramClient`.
2. **Setup Telegram Authentication**
   - Ambil kredensial (API_ID, API_HASH, SESSION_STRING) dari environment variables.
   - Inisialisasi `StringSession` dan koneksikan client ke Telegram.
3. **Endpoint `/api/get_link`**
   - Menerima `channel_id` dan `message_id` melalui query parameter.
   - Mengambil informasi message dari Telegram API (menggunakan `client.getMessages`).
   - Validasi ketersediaan file media di dalam message.
   - Mengambil metadata file seperti nama, ukuran, dan mimetype.
   - Meng-generate random `hash` untuk file tersebut, dan simpan mapping hash ke metadata file (ke dalam memory / variable sementara).
   - Kembalikan response JSON sesuai format yang diminta.
4. **Endpoint `/stream/:hash`**
   - Menerima `hash` sebagai parameter URL.
   - Cari metadata file dari mapping berdasarkan `hash`.
   - Setup request handling `Range` (HTTP 206) untuk support Internet Download Manager / multi-thread.
   - Hitung offset dan limit berdasarkan `Range` header.
   - Gunakan `iterDownload` (atau iterasi manual memanggil API `upload.GetFile`) dari GramJS untuk mendownload chunk-by-chunk mulai dari `offset` sampai selesai.
   - "Pipe" atau teruskan chunk yang didapat langsung ke HTTP Response (Express `res`) (Zero-storage policy).
   - Pastikan chunk size diperhitungkan untuk mendownload secara parallel per koneksi (GramJS `iterDownload` bisa dimanfaatkan untuk offset per koneksi dari IDM).
5. **Jalankan server**
