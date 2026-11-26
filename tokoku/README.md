# Tokoku — Retail Intelligence

Sistem penjualan berbasis PHP 8+, MySQL/MariaDB, HTML, CSS, dan JavaScript. Aplikasi menambahkan lapisan akun, katalog, dan pesanan pada `db_tokoku` tanpa mengganti objek bisnis lama.

## Menjalankan di XAMPP

1. Pastikan Apache, MySQL/MariaDB, serta ekstensi PHP `pdo_mysql` aktif.
2. Pastikan database `db_tokoku` serta objek yang digunakan aplikasi sudah tersedia.
3. Jalankan sekali `database/auth_schema.sql`, `database/retail_schema.sql`, `database/product_variants.sql`, `database/barcode_schema.sql`, `database/wallet_schema.sql`, dan `database/wallet_topup_security.sql` pada `db_tokoku`. Instalasi yang sudah memakai skema dompet harus menjalankan sekali `database/cash_payment_schema.sql` untuk menambahkan metode tunai. Untuk checkout Duitku, jalankan sekali `database/duitku_payment_schema.sql`. Migrasi varian mengelompokkan produk katalog yang sudah ada ke master tanpa mengubah foreign key maupun snapshot detail pesanan. Migrasi barcode menyiapkan kolom barcode unik yang diisi dengan barcode fisik produk. Migrasi dompet menambahkan saldo dan ledger; migrasi top up menambahkan referensi pembayaran yang diverifikasi admin.
4. Jika kredensial database berbeda dari nilai default XAMPP, atur `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, dan `DB_PASS` untuk Apache/PHP dan CLI.
5. Buat akun admin pertama dari CLI. Atur `TOKOKU_ADMIN_EMAIL` dan `TOKOKU_ADMIN_PASSWORD` (minimal 12 karakter) pada environment proses PHP, lalu jalankan `php api/setup-admin.php`.
6. Setelah masuk sebagai admin, buat akun kasir atau pelanggan baru dari halaman **Data pelanggan → Buat akun pengguna**. Akun kasir juga dapat dibuat lewat CLI dengan `TOKOKU_CASHIER_EMAIL` dan `TOKOKU_CASHIER_PASSWORD` (minimal 12 karakter), lalu jalankan `php api/setup-cashier.php`.
7. Buka `http://localhost/tokoku/public/`. Admin dapat menambah produk; katalog storefront dan POS akan tetap kosong sampai ada produk aktif.

Default koneksi: `127.0.0.1:3306`, database `db_tokoku`, user `root`, password kosong. File `database/db_tokoku.sql` hanya berisi query inspeksi metadata yang read-only; file itu bukan skrip instalasi dan aman dijalankan untuk memeriksa objek. Jangan jalankan skrip yang menghapus/membuat ulang routine pada database produksi.

## Integrasi dan batasan skema

- Akun admin awal dibuat lewat CLI. Admin dapat membuat akun kasir dan pelanggan dari halaman Data pelanggan; kata sandi kasir minimal 12 karakter dan pelanggan minimal 10 karakter. Registrasi publik tetap hanya membuat akun pelanggan.
- Registrasi pelanggan membuat catatan pada `tbl_pelanggan` dan akun ber-password hash pada `tbl_akun`. Sesi server, cookie `HttpOnly`/`SameSite`, dan token CSRF melindungi API.
- Admin mengelola produk, stok, diskon, pelanggan, laporan semua transaksi, dan audit. Kasir mengakses POS, antrean pesanan online, serta laporan transaksi POS miliknya sendiri; pembatasan laporan kasir diterapkan di API. Harga dan diskon selalu ditentukan server/database. Pelanggan hanya dapat membaca profil serta pesanan sendiri dan membuat pesanan yang otomatis ditautkan ke ID mereka.
- Untuk pelanggan lama yang sudah memiliki histori transaksi, admin perlu memverifikasi identitas lalu menautkan akunnya lewat CLI dengan `TOKOKU_CUSTOMER_ID`, `TOKOKU_CUSTOMER_EMAIL`, dan `TOKOKU_CUSTOMER_PASSWORD` (minimal 12 karakter), kemudian menjalankan `php api/link-customer.php`. Ini menghindari pendaftaran publik yang dapat mengklaim histori pelanggan lain.
- Pelanggan memakai kolom `tbl_pelanggan.nama_pelanggan` dan `kota`; daftar menggunakan `view_total_belanja_pelanggan`.
- Transaksi/report memakai `tbl_transaksi.tanggal` dan `total_belanja`; laporan transaksi menggabungkannya dengan data pesanan/kasir dari `tbl_pesanan`.
- Dashboard memanggil `HitungPelanggan()`. Tambah pelanggan memakai `TambahPelanggan()`, detail memakai `CariPelanggan(id)`, dan endpoint tambahan menyediakan `TampilPelanggan()` serta `LaporanTransaksi(id)`.
- Katalog, stok, diskon per produk, dan detail pesanan tersimpan di tabel tambahan `tbl_produk`, `tbl_pesanan`, dan `tbl_detail_pesanan`. Checkout mengunci stok, membaca ulang harga/diskon dari database, memanggil `HitungDiskon()`, `HitungPajak()`, `HitungTotal()`, kemudian memperbarui stok dan `tbl_transaksi` secara atomik.
- Dompet pelanggan disimpan di `tbl_wallet`; top up, pembelian dengan saldo, dan pengembalian pesanan dicatat di ledger `tbl_wallet_ledger`. Top up memakai permintaan transfer bank manual; admin hanya menambah saldo setelah memeriksa dana masuk dan mencatat referensi transaksi. Checkout saldo mengurangi saldo dan menyimpan penjualan/pesanan secara atomik. Pelanggan dibatasi maksimal tiga permintaan top up yang masih menunggu.
- Katalog memakai `tbl_produk_master` sebagai data nama/kategori/harga/gambar/diskon dan `tbl_produk` sebagai varian dengan stok masing-masing. Satu produk induk dapat memiliki banyak pilihan seperti ukuran, warna, model, atau isi; nama pilihan disimpan di kolom `ukuran` yang sudah ada. Checkout dan detail penjualan tetap mengacu ke ID varian untuk menjaga stok dan histori. Form admin dapat membuat beberapa varian sekaligus; pelanggan dan kasir memilih varian sebelum menambahkan ke keranjang.
- Admin dapat mengunggah gambar produk JPG, PNG, atau WebP hingga 5 MB melalui form produk. File disimpan di `public/uploads/products` dengan nama acak dan URL relatif disimpan pada produk. Pastikan Apache/PHP dapat menulis ke direktori `public` (aplikasi membuat subdirektori upload saat gambar pertama diunggah); SVG dan gambar lebih dari 20 megapiksel ditolak. URL gambar eksternal yang valid tetap dapat digunakan.
- Setiap varian produk dapat dihubungkan dengan barcode fisik yang sudah tercetak pada barang. Admin bisa memindai barcode dengan scanner saat kursor berada di kolom barcode varian, atau memasukkannya manual; kode kosong tetap kosong dan tidak dibuat otomatis. Di POS, scanner USB/Epson yang berfungsi sebagai keyboard dapat memindai ke kolom barcode; scanner perlu mengirim Enter setelah kode. Nota POS terbuka otomatis untuk cetak thermal 80 mm atau disimpan sebagai PDF, dengan pajak 11%, nama kasir/pelanggan, metode pembayaran, uang tunai, dan kembalian. Header nota menggunakan alamat Campursari, Sambit, Ponorogo.
- Instalasi lama yang pernah membuat barcode otomatis perlu menjalankan sekali `database/barcode_manual_schema.sql`; migrasi ini menghapus barcode yang ditandai sebagai buatan sistem dan mempertahankan kode custom. Untuk instalasi lama yang belum pernah menambahkan kolom `barcode_auto`, jalankan terlebih dahulu `database/barcode_identity_schema.sql`.
- Preview keranjang juga dihitung lewat stored functions di database. Stok katalog di-refresh berkala; pesanan online dapat dikonfirmasi, diproses, diselesaikan, atau dibatalkan. Pembatalan mengembalikan stok dalam transaksi database.
- Metode POS menyediakan Tunai, DANA, dan QRIS. Pembayaran tunai meminta jumlah uang diterima dan menghitung kembalian; untuk QRIS statis, kasir harus memastikan dana masuk sebelum menyelesaikan transaksi. Checkout pelanggan online menyediakan Saldo Tokoku, COD, transfer bank, QRIS, dan Duitku. Duitku membuat invoice di server, menyimpan referensi, lalu mengubah pesanan menjadi diproses hanya dari callback HMAC yang valid. Gambar QRIS merchant Anggito disimpan di `public/assets/qris.jpg`.

## Duitku

`.env` mendukung nama `MERCHANT`, `API_KEY`, `MODE` (`sandbox` atau `production`), dan `URL` sebagai URL dasar aplikasi. Nama yang lebih eksplisit juga tersedia: `DUITKU_MERCHANT_CODE`, `DUITKU_API_KEY`, `DUITKU_MODE`, `DUITKU_APP_URL`, `DUITKU_CALLBACK_URL`, dan `DUITKU_RETURN_URL`.

`DUITKU_APP_URL` harus berupa URL HTTPS publik aplikasi, misalnya `https://tokoku.example.com/tokoku`; jangan gunakan `localhost` untuk transaksi nyata karena server Duitku tidak dapat mengirim callback ke komputer lokal. Daftarkan URL callback yang terbentuk (`https://.../api/duitku-callback.php`) pada proyek Duitku. Callback memverifikasi HMAC, nominal, dan ID pesanan sebelum stok/status diperbarui.
- Struk kasir membuka dialog cetak browser yang dapat disimpan sebagai PDF.
- Kategori memakai `KategoriBelanja()` yang sudah ada (label Gold mulai Rp1.000.000 dan Silver mulai Rp500.000 pada database saat ini).
- `KonversiNilai(nilai)` pada database saat ini mengubah nilai 0–100 menjadi grade A–E; API mempertahankannya pada endpoint `convert-grade`, bukan menggunakannya sebagai kategori belanja.
- Transaksi lama tetap tampil sebagai histori berstatus selesai; kolom item/metode bayar yang memang belum tercatat pada skema lama ditandai sebagai data lama.
- Penghapusan pelanggan dengan histori transaksi ditolak karena constraint database; transaksi dan audit tetap utuh. Penghapusan pelanggan tanpa histori dicatat oleh API ke kedua tabel log.
- Trigger database yang ada mencatat insert/update dan menolak total transaksi negatif. Audit log diperbarui otomatis di UI setiap 30 detik saat halaman audit terbuka.

## Endpoint

Semua endpoint memakai `api/index.php?route=...` dan mengembalikan JSON.

| Method | Route | Keterangan |
|---|---|---|
| GET | `auth/session` | Status login dan token CSRF |
| POST | `auth/login` | Login admin, kasir, atau pelanggan |
| POST | `auth/register` | Registrasi akun pelanggan |
| POST | `auth/logout` | Mengakhiri sesi |
| GET | `dashboard` | (Admin) Metrik, `HitungPelanggan()`, tren 7 hari |
| GET | `customers&q=&page=&limit=` | View pelanggan + `KategoriBelanja()` |
| POST | `customers` | Tambah melalui `TambahPelanggan()` |
| PUT / DELETE | `customers&id=` | Ubah/hapus dengan pencatatan audit |
| GET | `customer-detail&id=` | Detail melalui `CariPelanggan()` |
| GET | `customers-all` | Daftar melalui `TampilPelanggan()` |
| POST | `admin-accounts` | (Admin) Buat akun kasir atau akun pelanggan beserta profilnya |
| GET | `transactions&from=&to=&page=&limit=` | Filter laporan dari view |
| GET | `sales-report&from=&to=&page=&limit=` | Laporan admin semua transaksi atau laporan POS milik kasir yang login |
| GET | `products&q=&category=` | Produk katalog aktif; admin melihat produk terarsip juga |
| POST / PUT / DELETE | `products&id=` | (Admin) Kelola produk, stok, diskon; delete mengarsipkan |
| PUT | `product-discount&id=` | (Admin) Sakelar diskon produk |
| GET | `calculate-cart&items=` | Preview keranjang melalui stored functions |
| POST | `checkout` | Checkout POS/storefront, reserve stok, simpan transaksi/detail/pembayaran |
| GET | `orders&status=` | Riwayat pribadi atau antrean pesanan online admin/kasir |
| GET | `order-detail&id=` | Detail pesanan sesuai hak akses |
| PUT | `order-status&id=` | (Admin/Kasir) Proses atau batalkan; pembatalan mengembalikan stok |
| GET | `customer-transactions&id=` | Riwayat melalui `LaporanTransaksi()` |
| GET | `convert-grade&nilai=` | Konversi nilai melalui `KonversiNilai()` |
| GET | `logs&limit=` | Gabungan dua tabel audit |
| GET | `my-profile` | (Pelanggan) Profil akun sendiri |
| GET | `wallet` | (Pelanggan) Saldo dan status top up terbaru |
| POST | `wallet-topups` | (Pelanggan) Ajukan top up transfer bank manual Rp10.000–Rp10.000.000 |
| GET | `wallet-admin` | (Admin) Total saldo, penjualan via saldo, dan riwayat top up |
| PUT | `wallet-topups&id=` | (Admin) Tolak atau setujui top up setelah memeriksa dana dan referensi transaksi |

Ekspor CSV kompatibel dengan Excel. Tombol Simpan PDF membuat dokumen laporan terformat dari seluruh transaksi pada rentang tanggal aktif, lalu membuka dialog browser (“Save as PDF”). Laporan kasir hanya menyertakan transaksi POS yang dibuat oleh akun kasir tersebut.

## Catatan deployment

Gunakan HTTPS di production agar cookie sesi beratribut `Secure`, batasi akses database ke host aplikasi, serta simpan kredensial di environment rahasia. Tabel akun menggunakan `password_hash()` PHP dan kata sandi tidak disimpan dalam teks biasa. Tabel bisnis dan transaksi lama tetap menjadi sumber data; aplikasi tidak mengisi transaksi contoh.
