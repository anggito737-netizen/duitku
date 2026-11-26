<?php
declare(strict_types=1);

// resultCode from the redirect is intentionally ignored. This page waits for
// our signed server callback before it displays a receipt.
$reference = trim((string) ($_GET['reference'] ?? ''));
if ($reference === '' || strlen($reference) > 100) {
    header('Location: ../public/', true, 303);
    exit;
}
?><!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nota pembayaran · Tokoku</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:22px;box-sizing:border-box;background:#f5faf6;color:#173428;font:14px Arial,sans-serif}.card{width:min(100%,560px);background:#fff;border:1px solid #d8e7dc;border-radius:16px;padding:28px;box-shadow:0 14px 42px #1f512014}.brand{text-align:center;font-weight:800;font-size:24px}.muted{color:#607168}.center{text-align:center}.spinner{width:28px;height:28px;border:3px solid #dcebe0;border-top-color:#27835f;border-radius:50%;margin:18px auto;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.head{border-bottom:1px dashed #b8c9bc;padding-bottom:15px;margin-bottom:12px}.meta,.total,.line{display:flex;justify-content:space-between;gap:16px}.meta{font-size:13px;margin:7px 0}.items{border-top:1px dashed #b8c9bc;border-bottom:1px dashed #b8c9bc;margin:16px 0}.line{padding:11px 0}.line+.line{border-top:1px solid #edf3ee}.line small{display:block;color:#607168;margin-top:3px}.total{font-size:18px;font-weight:800}.actions{display:flex;gap:10px;justify-content:center;margin-top:24px}.button{border:0;border-radius:8px;padding:10px 16px;cursor:pointer;font:inherit;text-decoration:none}.primary{background:#27835f;color:#fff}.secondary{background:#edf5ef;color:#173428}@media print{body{background:#fff;padding:0}.card{box-shadow:none;border:0;width:72mm;padding:0}.actions{display:none}}
</style></head><body>
<main class="card" id="content"><div class="center"><div class="brand">TOKOKU</div><div class="spinner"></div><p id="message" class="muted">Memverifikasi pembayaran dan menyiapkan nota…</p></div></main>
<script>
const reference=<?= json_encode($reference, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?>;
const content=document.getElementById('content'),message=document.getElementById('message');
const money=v=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(v)||0);
const date=v=>new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short'}).format(new Date(String(v).replace(' ','T')));
const node=(tag,cls,value)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(value!==undefined)n.textContent=String(value??'');return n};
const meta=(parent,label,value)=>{const row=node('div','meta');row.append(node('span','muted',label),node('b','',value));parent.append(row)};
function render(data){const r=data.receipt;content.replaceChildren();const head=node('section','head center');head.append(node('div','brand','TOKOKU'),node('b','','Pembayaran berhasil'),node('p','muted','Terima kasih sudah berbelanja.'));content.append(head);const details=node('section');meta(details,'No. pesanan','#ORD-'+r.id_pesanan);meta(details,'No. transaksi','#'+r.id_transaksi);meta(details,'Tanggal pembayaran',date(r.paid_at||r.created_at));meta(details,'Pelanggan',r.nama_pelanggan);meta(details,'Referensi Duitku',r.reference_duitku);content.append(details);const items=node('section','items');data.items.forEach(i=>{const row=node('div','line'),left=node('div');left.append(node('b','',i.nama_produk),node('small','',Number(i.jumlah)+' × '+money(i.harga_satuan)));row.append(left,node('b','',money(i.subtotal)));items.append(row)});content.append(items);const total=node('div','total');total.append(node('span','','Total dibayar'),node('span','',money(r.total_belanja)));content.append(total);const actions=node('div','actions'),print=node('button','button primary','Cetak nota'),back=node('a','button secondary','Kembali ke toko');print.type='button';print.onclick=()=>window.print();back.href='../public/';actions.append(print,back);content.append(actions)}
let attempts=0;async function load(){try{const res=await fetch('index.php?route=duitku-receipt&reference='+encodeURIComponent(reference),{credentials:'same-origin'}),json=await res.json();if(!res.ok)throw new Error(json.error||'Nota tidak dapat dimuat.');if(json.data){render(json.data);return}attempts++;if(attempts<20){setTimeout(load,1500);return}message.textContent='Pembayaran sedang dikonfirmasi. Nota akan tersedia di riwayat pesanan setelah callback Duitku diterima.'}catch(e){message.textContent=e.message+' Silakan kembali ke toko dan periksa riwayat pesanan.'}}load();
</script></body></html>
