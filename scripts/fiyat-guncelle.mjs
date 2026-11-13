// Sigara zamlarını haberlerden bulup fiyatlar.json'a ekler.
// GitHub Actions her gün çalıştırır. Bağımlılık yok (Node 20+).
//
// Mantık:
//  1. Bing Haberler RSS'inde "<ürün> sigara fiyatı" aranır.
//  2. Son N gündeki haberler açılır, metinde ürün adından hemen sonra gelen "NNN TL" fiyatı okunur.
//  3. Son fiyattan yüksek (ve makul aralıkta) olan bir fiyat en az `min_kaynak` farklı haberde
//     geçiyorsa yeni zam kabul edilir. Zam tarihi = o fiyatı veren en eski haberin tarihi.

import { readFile, writeFile, appendFile } from 'node:fs/promises';

const KOK = new URL('../', import.meta.url);
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

// I/İ/ı/i farkını yok say: "NIGHT", "Nıght", "PARLİAMENT" hepsi eşleşsin
const kucult = s => s.toLowerCase().replace(/̇/g, '').replace(/ı/g, 'i');
const kacis = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const istanbulTarih = d => new Date(d.getTime() + 3 * 3600e3).toISOString().slice(0, 10);

export function htmlMetin(html) {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8378;|&#x20BA;/gi, '₺')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/\s+/g, ' ');
}

/**
 * Metinde ürün adından sonra (arada rakam olmadan, en fazla 40 karakter) gelen fiyatları döndürür.
 * `desen` verilirse ürün adı yerine bu düzenli ifade (küçük harfli metin üzerinde) kullanılır.
 */
export function fiyatlariBul(metin, urun, desen) {
  const ad = desen ? `(?:${desen})` : kacis(kucult(urun));
  const re = new RegExp(ad + '[^0-9]{0,40}?(\\d{2,4}(?:[.,]\\d{1,2})?)\\s*(?:tl|₺|lira)', 'g');
  const sonuc = [];
  for (const m of kucult(metin).matchAll(re)) sonuc.push(Number(m[1].replace(',', '.')));
  return sonuc;
}

export function rssOku(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const al = t => (it.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)) || [])[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    let link = (al('link') || '').replace(/&amp;/g, '&');
    const gercek = link.match(/[?&]url=([^&]+)/); // Bing yönlendirme linki
    if (gercek) link = decodeURIComponent(gercek[1]);
    return { baslik: al('title'), link, tarih: new Date(al('pubDate')) };
  });
}

/** Haber başına bulunan fiyatlardan yeni zammı seçer. */
export function zamSec(bulgular, sonFiyat, sonTarih, minKaynak) {
  const destek = new Map(); // fiyat -> [{tarih, link}]
  for (const b of bulgular) {
    const adaylar = new Set(b.fiyatlar.filter(f => f > sonFiyat && f <= sonFiyat * 1.4));
    for (const f of adaylar) destek.set(f, [...(destek.get(f) || []), b]);
  }
  const uygun = [...destek].filter(([, h]) => new Set(h.map(x => new URL(x.link).hostname)).size >= minKaynak);
  if (!uygun.length) return null;
  uygun.sort((a, b) => b[0] - a[0]); // fiyatlar hep artar: en yüksek desteklenen fiyat en günceli
  const [fiyat, haberler] = uygun[0];
  haberler.sort((a, b) => a.tarih - b.tarih);
  let tarih = istanbulTarih(haberler[0].tarih);
  if (tarih <= sonTarih) tarih = istanbulTarih(new Date(Date.parse(sonTarih) + 86400e3));
  return { tarih, fiyat, kaynak: haberler[0].link };
}

async function getir(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'tr-TR,tr' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

async function markaGuncelle(dosya) {
  const DOSYA = new URL(dosya, KOK);
  const veri = JSON.parse(await readFile(DOSYA, 'utf8'));
  const ayar = { gun: 45, min_kaynak: 2, en_fazla_haber: 15, ...veri.otomatik };
  const urun = ayar.urun_adi || veri.marka;
  const son = [...veri.fiyatlar].sort((a, b) => a.tarih.localeCompare(b.tarih)).at(-1);

  const sorgu = encodeURIComponent(`${ayar.arama || urun} sigara fiyatı`);
  const haberler = rssOku(await getir(`https://www.bing.com/news/search?q=${sorgu}&format=rss&setlang=tr-TR&cc=TR`))
    .filter(h => h.link && !isNaN(h.tarih) && Date.now() - h.tarih < ayar.gun * 86400e3)
    .slice(0, ayar.en_fazla_haber);
  console.log(`"${urun}" için ${haberler.length} haber bulundu. Son kayıt: ${son.tarih} → ${son.fiyat} TL`);

  const bulgular = [];
  for (const h of haberler) {
    try {
      const fiyatlar = fiyatlariBul(htmlMetin(await getir(h.link)), urun, ayar.desen);
      console.log(`  ${istanbulTarih(h.tarih)} ${fiyatlar.length ? fiyatlar.join(', ') + ' TL' : '-'}  ${h.link}`);
      if (fiyatlar.length) bulgular.push({ ...h, fiyatlar });
    } catch (e) { console.log(`  atlandı: ${e.message}`); }
  }

  const zam = zamSec(bulgular, son.fiyat, son.tarih, ayar.min_kaynak);
  if (!zam) return console.log('Yeni zam yok.');

  veri.fiyatlar.push(zam);
  await writeFile(DOSYA, JSON.stringify(veri, null, 2) + '\n');
  console.log(`YENİ ZAM: ${zam.tarih} → ${zam.fiyat} TL (${zam.kaynak})`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `mesaj=Zam: ${zam.tarih} ${urun} ${zam.fiyat} TL\n`);
}

// markalar.json'daki her marka ayrı taranır
async function main() {
  let dosyalar = ['fiyatlar.json'];
  try { dosyalar = JSON.parse(await readFile(new URL('markalar.json', KOK), 'utf8')).markalar.map(m => m.dosya); } catch (e) {}
  for (const d of dosyalar) {
    console.log(`\n=== ${d} ===`);
    try { await markaGuncelle(d); } catch (e) { console.log(`${d} atlandı:`, e.message); }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
