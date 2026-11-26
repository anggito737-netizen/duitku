-- Run once after product_variants.sql. Scan or enter each physical product barcode in the admin form.

ALTER TABLE tbl_produk
    ADD COLUMN barcode VARCHAR(64) NULL AFTER ukuran,
    ADD UNIQUE KEY uq_tbl_produk_barcode (barcode);
