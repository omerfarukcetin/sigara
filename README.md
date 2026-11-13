# 🚭 Sigarasız Kazanç

Sigarayı bıraktığım günden bu yana ne kadar para kazandığımı, **zam tarihlerine göre** hesaplayan basit bir sayfa.

## Nasıl çalışır?
- `fiyatlar.json` içinde her zammın tarihi ve yeni paket fiyatı tutulur.
- Bir fiyat, bir sonraki zam tarihine kadar geçerlidir.
- Sayfa, bırakma tarihinden bugüne kadar her zam dönemini ayrı hesaplar ve toplar:
  `kazanç = gün sayısı × (paket fiyatı ÷ paketteki adet × günlük adet)`
- Bırakma tarihi ve günlük adet tarayıcıda saklanır.

## Zam gelince
`fiyatlar.json` dosyasına yeni bir satır ekleyin:
```json
{ "tarih": "2026-07-15", "fiyat": 85 }
```

## Yayınlama
Settings → Pages → Branch: `main` / root. Sayfa `https://<kullanıcı>.github.io/sigara/` adresinde açılır.
