-- Run once on installations that previously generated barcode values automatically.
-- Clears only known system-generated values and keeps manually assigned barcodes.

UPDATE tbl_produk
SET barcode = NULL, barcode_auto = 0
WHERE barcode_auto = 1
   OR barcode REGEXP '^TITA-[0-9]{6}(-[A-F0-9]{6})?$';
