-- Run once on existing installations after wallet_schema.sql to enable cash payments at POS.
ALTER TABLE tbl_pesanan
    MODIFY metode_pembayaran
    ENUM('cash', 'cod', 'bank', 'debit', 'ovo', 'dana', 'gopay', 'qris', 'wallet') NOT NULL;
