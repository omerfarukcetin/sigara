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

async function getir(url, tur = 'text', ekBaslik = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8', ...ekBaslik }, signal: AbortSignal.timeout(30000) });
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

/* ---------- Yatırım araçları (TL fiyatları) ---------- */
const ONS_GRAM = 31.1034768;

// Yahoo Finance günlük kapanışlar -> { 'YYYY-MM-DD': kapanış }
async function yahoo(sembol) {
  const bas = Math.floor(Date.UTC(2019, 11, 20) / 1000), son = Math.floor(Date.now() / 1000);
  for (const host of ['query1', 'query2']) {
    try {
      const j = await getir(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sembol)}?period1=${bas}&period2=${son}&interval=1d`, 'json');
      const r = j.chart.result[0], kapanis = r.indicators.quote[0].close, ofset = r.meta.gmtoffset || 0;
      const sonuc = {};
      r.timestamp.forEach((t, i) => { if (kapanis[i] > 0) sonuc[new Date((t + ofset) * 1000).toISOString().slice(0, 10)] = kapanis[i]; });
      if (Object.keys(sonuc).length > 500) return sonuc;
    } catch (e) { console.log(`${sembol} (${host}) atlandı:`, e.message); }
  }
  return null;
}
// Stooq CSV yedeği (Yahoo erişilemezse)
async function stooq(sembol) {
  try {
    const csv = await getir(`https://stooq.com/q/d/l/?s=${sembol}&d1=20191220&i=d`);
    const sonuc = {};
    for (const satir of csv.trim().split('\n').slice(1)) { const p = satir.split(','); if (+p[4] > 0) sonuc[p[0]] = +p[4]; }
    return Object.keys(sonuc).length > 500 ? sonuc : null;
  } catch (e) { console.log(`stooq ${sembol} atlandı:`, e.message); return null; }
}
// Altın: freegoldapi.com açık veri seti (USD/ons, günlük)
async function freeGold() {
  try {
    const csv = await getir('https://freegoldapi.com/data/latest.csv');
    const sonuc = {};
    for (const satir of csv.trim().split('\n').slice(1)) {
      const [t, f] = satir.split(',');
      if (/^\d{4}-\d{2}-\d{2}$/.test(t) && t >= '2019-12-20' && +f > 0) sonuc[t] = +f;
    }
    console.log(`freegoldapi: ${Object.keys(sonuc).length} gün`);
    return Object.keys(sonuc).length > 300 ? sonuc : null;
  } catch (e) { console.log('freegoldapi atlandı:', e.message); return null; }
}
// Altın: LBMA öğleden sonra fiyatı (USD/ons)
async function lbmaAltin() {
  try {
    const j = await getir('https://prices.lbma.org.uk/json/gold_pm.json', 'json');
    const sonuc = {};
    for (const x of j) if (x.d >= '2019-12-20' && x.v?.[0] > 0) sonuc[x.d] = x.v[0];
    return Object.keys(sonuc).length > 500 ? sonuc : null;
  } catch (e) { console.log('LBMA altın atlandı:', e.message); return null; }
}
// Binance herkese açık veri ucu: günlük kapanışlar, 1000'erli sayfalar
async function binance(sembol) {
  const sonuc = {};
  let bas = Date.UTC(2019, 11, 20);
  try {
    while (bas < Date.now()) {
      const k = await getir(`https://data-api.binance.vision/api/v3/klines?symbol=${sembol}&interval=1d&startTime=${bas}&limit=1000`, 'json');
      if (!k.length) break;
      for (const m of k) sonuc[new Date(m[0]).toISOString().slice(0, 10)] = +m[4];
      bas = k.at(-1)[0] + 86400000;
    }
    return Object.keys(sonuc).length > 300 ? sonuc : null;
  } catch (e) { console.log(`Binance ${sembol} atlandı:`, e.message); return null; }
}
const binanceBtc = () => binance('BTCUSDT');
// BIST 100: İş Yatırım endeks geçmişi
async function isYatirimBist() {
  const tarih = d => d.toISOString().slice(0, 10).replace(/-/g, '') + '000000';
  const url = `https://www.isyatirim.com.tr/_layouts/15/Isyatirim.Website/Common/ChartData.aspx/IndexHistoricalAll?period=1440&from=20191220000000&to=${tarih(new Date())}&endeks=XU100.I`;
  const baslik = { Referer: 'https://www.isyatirim.com.tr/tr-tr/analiz/hisse/Sayfalar/default.aspx', 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/javascript, */*; q=0.01' };
  try {
    const metin = await getir(url, 'text', baslik);
    console.log(`İş Yatırım IndexHistoricalAll: ${metin.length} bayt`);
    const j = JSON.parse(metin);
    const sonuc = {};
    for (const [t, v] of j.data || []) if (v > 0) sonuc[new Date(t + 3 * 3600e3).toISOString().slice(0, 10)] = v;
    if (Object.keys(sonuc).length > 500) return sonuc;
  } catch (e) { console.log('İş Yatırım BIST atlandı:', e.message); }
  try {
    const g = d => `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
    const metin = await getir(`https://www.isyatirim.com.tr/_layouts/15/Isyatirim.Website/Common/Data.aspx/HisseTekil?hisse=XU100&startdate=20-12-2019&enddate=${g(new Date())}`, 'text', baslik);
    console.log(`İş Yatırım HisseTekil: ${metin.length} bayt: ${metin.slice(0, 300)}`);
    const j = JSON.parse(metin), sonuc = {};
    for (const x of j.value || []) {
      const [gg, aa, yy] = String(x.HGDG_TARIH).split('-');
      const v = x.END_DEGER ?? x.HGDG_KAPANIS;
      if (yy && v > 0) sonuc[`${yy}-${aa}-${gg}`] = v;
    }
    return Object.keys(sonuc).length > 500 ? sonuc : null;
  } catch (e) { console.log('İş Yatırım HisseTekil atlandı:', e.message); return null; }
}

function kurluCevir(usdSeri, kurlar) {
  const tarihler = Object.keys(kurlar).sort();
  let i = 0, sonKur = kurlar[tarihler[0]];
  const sonuc = {};
  for (const t of Object.keys(usdSeri).sort()) {
    while (i < tarihler.length && tarihler[i] <= t) sonKur = kurlar[tarihler[i++]];
    sonuc[t] = usdSeri[t] * sonKur;
  }
  return sonuc;
}
const yuvarla = (seri, basamak) => Object.fromEntries(Object.entries(seri).sort().map(([t, v]) => [t, +v.toFixed(basamak)]));

async function yatirimGuncelle() {
  const kur = (await oku('kur.json'))?.kurlar;
  if (!kur) return console.log('kur.json yok, yatırım verisi atlandı.');
  const eski = await oku('yatirim.json');
  const varliklar = [];

  // Gram altın = ons (USD) × USD/TRY ÷ 31,10
  let ons = (await freeGold()) || (await lbmaAltin()) || (await yahoo('GC=F')) || (await stooq('xauusd'));
  const paxg = await binance('PAXGUSDT'); // 1 PAXG = 1 ons altın; günlük veriyle seyrek seriyi tamamlar
  if (paxg) { ons = { ...(ons || {}), ...paxg }; console.log(`PAXG: ${Object.keys(paxg).length} gün eklendi`); }
  if (ons) varliklar.push({ id: 'altin', ad: 'Gram altın', ikon: '🥇', fiyatlar: yuvarla(Object.fromEntries(Object.entries(kurluCevir(ons, kur)).map(([t, v]) => [t, v / ONS_GRAM])), 2) });

  const bist = (await isYatirimBist()) || (await yahoo('XU100.IS')) || (await stooq('^xu100'));
  if (bist) varliklar.push({ id: 'bist', ad: 'BIST 100', ikon: '📊', not: 'Endeks; temettü ve masraflar hariç', fiyatlar: yuvarla(bist, 2) });

  const btc = (await binanceBtc()) || (await yahoo('BTC-USD')) || (await stooq('btcusd'));
  if (btc) varliklar.push({ id: 'btc', ad: 'Bitcoin', ikon: '₿', fiyatlar: yuvarla(kurluCevir(btc, kur), 0) });

  // Euro: ECB referans kuru
  for (const kok of ['https://api.frankfurter.dev/v1', 'https://api.frankfurter.app']) {
    try {
      const v = await getir(`${kok}/2020-01-01..${new Date().toISOString().slice(0, 10)}?from=EUR&to=TRY`, 'json');
      varliklar.push({ id: 'eur', ad: 'Euro', ikon: '💶', fiyatlar: yuvarla(Object.fromEntries(Object.entries(v.rates).map(([t, r]) => [t, r.TRY])), 4) });
      break;
    } catch (e) { console.log('EUR kaynağı atlandı:', e.message); }
  }

  // Alınamayan varlık için eski veriyi koru
  for (const e of eski?.varliklar || []) if (!varliklar.some(v => v.id === e.id)) { varliklar.push(e); console.log(`${e.id}: eski veri korundu`); }
  if (!varliklar.length) return console.log('Hiçbir yatırım verisi alınamadı.');

  const sira = ['altin', 'bist', 'btc', 'eur'];
  varliklar.sort((a, b) => sira.indexOf(a.id) - sira.indexOf(b.id));
  const yeni = { aciklama: 'Günlük TL fiyatları. Dolar karşılığı için kur.json kullanılır.', varliklar };
  if (JSON.stringify(eski?.varliklar) !== JSON.stringify(varliklar)) {
    await writeFile(new URL('yatirim.json', KOK), JSON.stringify(yeni) + '\n');
    degisenler.push('yatırım fiyatları');
  }
  for (const v of varliklar) { const t = Object.keys(v.fiyatlar).sort(); console.log(`${v.ad}: ${t.length} gün, ${t[0]} → ${t.at(-1)} = ${v.fiyatlar[t.at(-1)]}`); }
}

await kurGuncelle();
await yiufeGuncelle();
await yatirimGuncelle();
if (degisenler.length && process.env.GITHUB_OUTPUT)
  await appendFile(process.env.GITHUB_OUTPUT, `mesaj=Veri: ${degisenler.join(', ')}\n`);
