# 🚭 Sigarasız Kazanç

Sigarayı bıraktığım günden bu yana ne kadar para kazandığımı, **zam tarihlerine göre** hesaplayan basit bir sayfa.

## Nasıl çalışır?
- `fiyatlar.json` içinde her zammın tarihi ve yeni paket fiyatı tutulur.
- Bir fiyat, bir sonraki zam tarihine kadar geçerlidir.
- Sayfa, bırakma tarihinden bugüne kadar her zam dönemini ayrı hesaplar ve toplar:
  `kazanç = gün sayısı × (paket fiyatı ÷ paketteki adet × günlük adet)`
- Bırakma tarihi ve günlük adet tarayıcıda saklanır.

## Zamlar otomatik eklenir
`.github/workflows/fiyat-guncelle.yml` her gün 09:17'de çalışır:
1. Bing Haberler'de `"<urun_adi> sigara fiyatı"` aranır (son 45 gün).
2. Haberlerde ürün adının hemen yanındaki `NNN TL` fiyatı okunur.
3. Son fiyattan yüksek (en fazla %40) bir fiyat **en az 2 farklı sitede** geçiyorsa
   `fiyatlar.json`'a eklenir ve commit atılır. Tarih = o fiyatı veren en eski haberin tarihi.

Ayarlar `fiyatlar.json` → `otomatik` içinde: `urun_adi` haberlerde geçtiği şekliyle yazılmalı
(ör. `Parliament Night Blue`, `Marlboro Touch`, `Winston Slims`).
Elle çalıştırmak için: Actions → "Sigara fiyatlarını güncelle" → Run workflow.

## Elle düzeltme
Bot yanlış bir şey eklerse ya da bir zammı kaçırırsa `fiyatlar.json`'u elle düzenleyin:
```json
{ "tarih": "2026-07-15", "fiyat": 85 }
```

## Yayınlama
Settings → Pages → Branch: `main` / root. Sayfa `https://<kullanıcı>.github.io/sigara/` adresinde açılır.
