<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/duitku.php';

function callbackReply(int $status, string $message): never
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    echo $message;
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    callbackReply(405, 'METHOD NOT ALLOWED');
}

try {
    $config = duitkuAssertReady();
    $merchantCode = trim((string) ($_POST['merchantCode'] ?? ''));
    $amount = trim((string) ($_POST['amount'] ?? ''));
    $merchantOrderId = trim((string) ($_POST['merchantOrderId'] ?? ''));
    $signature = trim((string) ($_POST['signature'] ?? ''));
    $resultCode = trim((string) ($_POST['resultCode'] ?? ''));
    if ($merchantCode !== $config['merchant_code'] || $amount === '' || $merchantOrderId === '' || $signature === '') {
        callbackReply(400, 'INVALID CALLBACK');
    }
    $expected = hash_hmac('sha256', $merchantCode . $amount . $merchantOrderId, $config['api_key']);
    if (!hash_equals($expected, $signature)) {
        callbackReply(403, 'INVALID SIGNATURE');
    }

    /** @var PDO $pdo */
    $pdo = require __DIR__ . '/../config/database.php';
    $pdo->beginTransaction();
    $paymentStmt = $pdo->prepare(
        'SELECT d.id_pembayaran, d.id_pesanan, d.nominal, d.status AS payment_status,
                o.status AS order_status
         FROM tbl_pembayaran_duitku d
         JOIN tbl_pesanan o ON o.id_pesanan = d.id_pesanan
         WHERE d.merchant_order_id = ? FOR UPDATE'
    );
    $paymentStmt->execute([$merchantOrderId]);
    $payment = $paymentStmt->fetch(PDO::FETCH_ASSOC);
    if (!$payment || (int) round((float) $payment['nominal']) !== (int) $amount) {
        $pdo->rollBack();
        callbackReply(404, 'ORDER NOT FOUND');
    }

    $reference = trim((string) ($_POST['reference'] ?? ''));
    $paymentCode = trim((string) ($_POST['paymentCode'] ?? ''));
    $payload = json_encode($_POST, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    if ($resultCode === '00') {
        if ($payment['payment_status'] !== 'paid' && $payment['order_status'] !== 'cancelled') {
            $updatePayment = $pdo->prepare(
                "UPDATE tbl_pembayaran_duitku
                 SET status = 'paid', reference_duitku = NULLIF(?, ''), payment_code = NULLIF(?, ''),
                     callback_payload = ?, paid_at = CURRENT_TIMESTAMP
                 WHERE id_pembayaran = ?"
            );
            $updatePayment->execute([$reference, $paymentCode, $payload, $payment['id_pembayaran']]);
            $pdo->prepare("UPDATE tbl_pesanan SET status = 'processing' WHERE id_pesanan = ? AND status = 'pending'")
                ->execute([$payment['id_pesanan']]);
        }
    } elseif ($payment['payment_status'] === 'pending' && $payment['order_status'] === 'pending') {
        $items = $pdo->prepare('SELECT id_produk, jumlah FROM tbl_detail_pesanan WHERE id_pesanan = ?');
        $items->execute([$payment['id_pesanan']]);
        $restore = $pdo->prepare('UPDATE tbl_produk SET stok = stok + ? WHERE id_produk = ?');
        foreach ($items->fetchAll(PDO::FETCH_ASSOC) as $item) {
            $restore->execute([$item['jumlah'], $item['id_produk']]);
        }
        $pdo->prepare("UPDATE tbl_pembayaran_duitku SET status = 'failed', callback_payload = ? WHERE id_pembayaran = ?")
            ->execute([$payload, $payment['id_pembayaran']]);
        $pdo->prepare("UPDATE tbl_pesanan SET status = 'cancelled' WHERE id_pesanan = ?")
            ->execute([$payment['id_pesanan']]);
    }
    $pdo->commit();
    callbackReply(200, 'SUCCESS');
} catch (Throwable $error) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    callbackReply(500, 'RETRY');
}
