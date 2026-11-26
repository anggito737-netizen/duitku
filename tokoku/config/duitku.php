<?php
declare(strict_types=1);

/**
 * Konfigurasi Duitku. File .env sengaja dibaca di server agar merchant key
 * tidak pernah terkirim ke browser.
 */
function duitkuEnvironment(): array
{
    static $values = null;
    if ($values !== null) {
        return $values;
    }

    $values = [];
    $path = __DIR__ . '/../.env';
    if (is_file($path)) {
        foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) {
                continue;
            }
            [$key, $value] = explode('=', $line, 2);
            $key = trim($key);
            $value = trim($value);
            if ($key === '') {
                continue;
            }
            if (strlen($value) >= 2 && (($value[0] === '"' && substr($value, -1) === '"')
                || ($value[0] === "'" && substr($value, -1) === "'"))) {
                $value = substr($value, 1, -1);
            }
            $values[$key] = $value;
        }
    }
    return $values;
}

function duitkuEnv(string ...$keys): string
{
    $environment = duitkuEnvironment();
    foreach ($keys as $key) {
        $value = getenv($key);
        if ($value !== false && trim((string) $value) !== '') {
            return trim((string) $value);
        }
        if (isset($environment[$key]) && trim($environment[$key]) !== '') {
            return trim($environment[$key]);
        }
    }
    return '';
}

function duitkuConfig(): array
{
    $mode = strtolower(duitkuEnv('DUITKU_MODE', 'MODE'));
    $sandbox = !in_array($mode, ['production', 'prod', 'live'], true);
    $genericUrl = duitkuEnv('URL');
    $genericUrlHost = (string) parse_url($genericUrl, PHP_URL_HOST);
    $appUrl = duitkuEnv('DUITKU_APP_URL', 'APP_URL');
    if ($appUrl === '' && $genericUrl !== '' && !str_contains(strtolower($genericUrlHost), 'duitku.com')) {
        $appUrl = $genericUrl;
    }
    if (!filter_var($appUrl, FILTER_VALIDATE_URL) && PHP_SAPI !== 'cli' && !empty($_SERVER['HTTP_HOST'])) {
        $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $script = (string) ($_SERVER['SCRIPT_NAME'] ?? '/api/index.php');
        $basePath = rtrim(str_replace('\\', '/', dirname(dirname($script))), '/');
        $appUrl = $scheme . '://' . $_SERVER['HTTP_HOST'] . ($basePath === '/' ? '' : $basePath);
    }
    $appUrl = rtrim($appUrl, '/');

    $callbackUrl = duitkuEnv('DUITKU_CALLBACK_URL');
    $returnUrl = duitkuEnv('DUITKU_RETURN_URL');
    if ($callbackUrl === '' && $appUrl !== '') {
        $callbackUrl = $appUrl . '/api/duitku-callback.php';
    }
    if ($returnUrl === '' && $appUrl !== '') {
        $returnUrl = $appUrl . '/api/duitku-return.php';
    }

    return [
        'merchant_code' => duitkuEnv('DUITKU_MERCHANT_CODE', 'MERCHANT'),
        'api_key' => duitkuEnv('DUITKU_API_KEY', 'API_KEY'),
        'mode' => $sandbox ? 'sandbox' : 'production',
        'endpoint' => $sandbox
            ? 'https://api-sandbox.duitku.com/api/merchant/createInvoice'
            : 'https://api-prod.duitku.com/api/merchant/createInvoice',
        'callback_url' => $callbackUrl,
        'return_url' => $returnUrl,
        'expiry_period' => 60,
    ];
}

function duitkuAssertReady(): array
{
    $config = duitkuConfig();
    if ($config['merchant_code'] === '' || $config['api_key'] === '') {
        throw new DomainException('Konfigurasi Duitku belum lengkap. Isi MERCHANT dan API_KEY pada .env.');
    }
    foreach (['callback_url', 'return_url'] as $urlKey) {
        if (!filter_var($config[$urlKey], FILTER_VALIDATE_URL)) {
            throw new DomainException('URL callback/return Duitku belum valid. Isi DUITKU_APP_URL atau DUITKU_CALLBACK_URL dan DUITKU_RETURN_URL pada .env.');
        }
    }
    if (!function_exists('curl_init')) {
        throw new RuntimeException('Ekstensi PHP cURL diperlukan untuk menggunakan Duitku.');
    }
    return $config;
}

function duitkuCreateInvoice(array $config, array $payload): array
{
    $body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    $timestamp = (string) round(microtime(true) * 1000);
    // Duitku POP Create Invoice signs merchantCode + timestamp with HMAC-SHA256.
    $signature = hash_hmac('sha256', $config['merchant_code'] . $timestamp, $config['api_key']);
    $curl = curl_init($config['endpoint']);
    curl_setopt_array($curl, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'x-duitku-merchantcode: ' . $config['merchant_code'],
            'x-duitku-timestamp: ' . $timestamp,
            'x-duitku-signature: ' . $signature,
        ],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 30,
    ]);
    $response = curl_exec($curl);
    $error = curl_error($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    curl_close($curl);

    if ($response === false || $error !== '') {
        throw new RuntimeException('Tidak dapat terhubung ke Duitku. Silakan coba lagi.');
    }
    $decoded = json_decode($response, true);
    if ($status < 200 || $status >= 300 || !is_array($decoded)
        || empty($decoded['paymentUrl']) || empty($decoded['reference'])) {
        $message = is_array($decoded)
            ? (string) ($decoded['statusMessage'] ?? $decoded['Message'] ?? $decoded['message'] ?? $decoded['error'] ?? '')
            : '';
        throw new DomainException($message !== '' ? 'Duitku: ' . $message : 'Duitku belum dapat membuat invoice pembayaran.');
    }
    return $decoded;
}
