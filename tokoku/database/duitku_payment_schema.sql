-- Run once after retail_schema.sql and wallet_schema.sql.
-- Keeps gateway data separate from orders and makes Duitku callbacks idempotent.
ALTER TABLE tbl_pesanan
    MODIFY metode_pembayaran
    ENUM('cash', 'cod', 'bank', 'debit', 'ovo', 'dana', 'gopay', 'qris', 'wallet', 'duitku') NOT NULL;

CREATE TABLE IF NOT EXISTS tbl_pembayaran_duitku (
    id_pembayaran BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_pesanan BIGINT UNSIGNED NOT NULL,
    merchant_order_id VARCHAR(80) NOT NULL,
    reference_duitku VARCHAR(100) NULL,
    payment_url VARCHAR(1000) NULL,
    payment_code VARCHAR(30) NULL,
    nominal DECIMAL(12,2) NOT NULL,
    status ENUM('pending', 'paid', 'failed', 'expired') NOT NULL DEFAULT 'pending',
    callback_payload MEDIUMTEXT NULL,
    paid_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id_pembayaran),
    UNIQUE KEY uq_pembayaran_duitku_order (id_pesanan),
    UNIQUE KEY uq_pembayaran_duitku_merchant_order (merchant_order_id),
    UNIQUE KEY uq_pembayaran_duitku_reference (reference_duitku),
    KEY idx_pembayaran_duitku_status (status, created_at),
    CONSTRAINT fk_pembayaran_duitku_order FOREIGN KEY (id_pesanan)
        REFERENCES tbl_pesanan (id_pesanan),
    CONSTRAINT chk_pembayaran_duitku_nominal CHECK (nominal >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
