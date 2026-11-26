-- Run once on older installations where barcode_schema.sql was applied before barcode_auto existed.
-- Clears legacy generated TITA codes so actual product barcodes can be scanned or entered.

ALTER TABLE tbl_produk
    ADD COLUMN barcode_auto TINYINT(1) NOT NULL DEFAULT 0 AFTER barcode;

UPDATE tbl_produk
SET barcode = NULL, barcode_auto = 0
WHERE barcode REGEXP '^TITA-[0-9]{6}(-[A-F0-9]{6})?$';
