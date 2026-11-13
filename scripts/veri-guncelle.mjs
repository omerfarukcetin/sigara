// Dolar kurunu (günlük) ve Yİ-ÜFE endeksini (aylık) günceller.
// GitHub Actions her gün çalıştırır. Bağımlılık yok (Node 20+).
//
//  - kur.json  : USD/TRY günlük kurları, ECB referans kurundan (frankfurter API). Hafta sonu/tatil günleri
//                dosyada yoktur; sayfa o günler için bir önceki iş gününün kurunu kullanır.
//  - yiufe.json: Yİ-ÜFE (2003=100) aylık endeks. TÜİK tablosunun yayımlandığı sayfadan okunur;
//                okunamazsa ya da değerler tutarsızsa dosyaya dokunulmaz.

import { readFile, writeFile, appendFile } from 'node:fs/promises';

const KOK = new URL('../', import.meta.url);
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const degisenler = [];

async function getir(url, tur = 'text') {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return tur === 'json' ? r.json() : r.text();
}
const oku = async ad => { try { return JSON.parse(await readFile(new URL(ad, KOK), 'utf8')); } catch { return null; } };
const yaz = (ad, v) => writeFile(new URL(ad, KOK), JSON.stringify(v, null, 1) + '\n');

/* ---------- USD/TRY ---------- */
async function kurGuncelle() {
  const eski = await oku('kur.json');
  const bugun = new Date().toISOString().slice(0, 10);
  let veri;
  for (const kok of ['https://api.frankfurter.dev/v1', 'https://api.frankfurter.app']) {
    try { veri = await getir(`${kok}/2020-01-01..${bugun}?from=USD&to=TRY`, 'json'); break; }
    catch (e) { console.log('kur kaynağı atlandı:', e.message); }
  }
  if (!veri?.rates) return console.log('Kur alınamadı, kur.json değişmedi.');

  const kurlar = {};
  for (const [tarih, r] of Object.entries(veri.rates)) if (r.TRY > 0) kurlar[tarih] = Math.round(r.TRY * 10000) / 10000;
  const adet = Object.keys(kurlar).length;
  if (adet < 1000) return console.log(`Şüpheli kur verisi (${adet} gün), kur.json değişmedi.`);

  const yeni = { aciklama: 'USD/TRY, ECB referans kuru (iş günleri).', kaynak: 'https://frankfurter.dev', kurlar };
  if (JSON.stringify(eski?.kurlar) !== JSON.stringify(kurlar)) {
    await yaz('kur.json', yeni);
    const son = Object.keys(kurlar).sort().at(-1);
    degisenler.push(`kur ${son}: ${kurlar[son]}`);
  }
  console.log(`Kur: ${adet} gün.`);
}

/* ---------- Yİ-ÜFE ---------- */
async function yiufeGuncelle() {
  const eski = await oku('yiufe.json');
  if (!eski) return;
  let html;
  try { html = await getir('https://ymm.net/YIFE/YIFEGoster'); }
  catch (e) { return console.log('Yİ-ÜFE kaynağı okunamadı:', e.message); }

  const metin = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const yeni = { ...eski.endeks };
  let eklenen = 0;
  // "2026 4910,53 5029,76 ... 0,00 0,00" biçimindeki yıl satırları
  for (const m of metin.matchAll(/\b(20[2-9]\d)((?:\s+\d{1,5}(?:[.,]\d{1,2})?){12})/g)) {
    const yil = m[1];
    m[2].trim().split(/\s+/).forEach((v, i) => {
      const deger = Number(v.replace('.', '').replace(',', '.'));
      const ay = `${yil}-${String(i + 1).padStart(2, '0')}`;
      if (deger > 0 && !(ay in yeni)) { yeni[ay] = deger; eklenen++; }
    });
  }
  if (!eklenen) return console.log('Yİ-ÜFE: yeni ay yok.');

  // Tutarlılık: aylık değişim -%10 ile +%30 arasında olmalı
  const aylar = Object.keys(yeni).sort();
  for (let i = 1; i < aylar.length; i++) {
    const oran = yeni[aylar[i]] / yeni[aylar[i - 1]];
    if (oran < 0.9 || oran > 1.3) return console.log(`Yİ-ÜFE tutarsız (${aylar[i]}), dosya değişmedi.`);
  }
  await yaz('yiufe.json', { ...eski, endeks: Object.fromEntries(aylar.map(a => [a, yeni[a]])) });
  degisenler.push(`Yİ-ÜFE ${aylar.at(-1)}: ${yeni[aylar.at(-1)]}`);
  console.log(`Yİ-ÜFE: ${eklenen} yeni ay eklendi.`);
}

await kurGuncelle();
await yiufeGuncelle();
if (degisenler.length && process.env.GITHUB_OUTPUT)
  await appendFile(process.env.GITHUB_OUTPUT, `mesaj=Veri: ${degisenler.join(', ')}\n`);
