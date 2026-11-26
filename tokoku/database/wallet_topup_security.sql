-- Run once after wallet_schema.sql to require auditable, non-reusable payment references.
ALTER TABLE tbl_wallet_topup
    ADD COLUMN referensi_pembayaran VARCHAR(100) NULL AFTER reviewed_by,
    ADD UNIQUE KEY uq_tbl_wallet_topup_payment_reference (referensi_pembayaran);
