# BarkWatch Slovenija — Vmesnik

> **Opomba:** To je različica dokumentacije, prevedena z umetno inteligenco. Izvorna angleška različica je [`README.md`](README.md).

Izdelano za Arnes Hackathon 2026 — ekipa Korošci+Tilen.

> Ta repozitorij vsebuje samo **spletni vmesnik**. Model umetne inteligence za napovedi in generiranje sintetičnih podatkov sta v [ločenem repozitoriju](https://github.com/anejm/BarkWatch_Korosci-plus-Tilen).

---

## Ozadje

Slovenija je ena najbolj gozdnatih držav v Evropi (~58 % površine pokriva gozd). Podlubniki so resna naravna grožnja, ki lahko tiho opustošijo velike površine, preden gozdar sploh zazna težavo.

**Resnični podatki** prihajajo iz Zavoda za gozdove Slovenije v obliki mesečnih evidenc o poseku. Te vrednosti odražajo človeške odločitve o tem, kdaj in kje posekati — ne samo pritiska podlubnikov — kar vnese šum v podatke.

**Sintetični podatki** so bili generirani iz resničnih podatkov o poseku z determinističnimi matematičnimi modeli, ki izločijo komponento človeških odločitev. Ta pristop se je izkazal za natančnejši signal aktivnosti podlubnikov kot surove vrednosti poseka. Napovedi za oba nabora podatkov je izdelal naš lasten model umetne inteligence.

---

## Funkcionalnosti

- Toplotna karta aktivnosti podlubnikov do ravni posameznega gozdnega odseka
- ~20-letno zgodovinsko okno + 1-letna napoved umetne inteligence, ki jo je mogoče pregledovati z drsnikom
- Celoten časovni grafikon za kateri koli izbrani odsek
- Preklop med resničnimi podatki o poseku (m³/ha) in sintetičnimi podatki o gostoti podlubnikov (hrošči/m²)
- 3D višinska karta v nagnjenem pogledu — višina je sorazmerna z zveznimi vrednostmi podatkov
- Navigacija po zgodovini pogledov (smer, naklon, povečava, izbrani odsek)
- Aplikacija ima veliko funkcij, od katerih niso vse namerne — nekateri temu pravijo hrošči

---

## Geografska hierarhija

```
GGO — Gozdnogospodarsko območje   — skupaj 14
 └── GGE — Gozdnogospodarska enota
      └── Odsek                    — skupaj ~42.000
```

---

## Lokalno zaganjanje

### Predpogoji

- Python 3.9+ (ni potrebna namestitev s `pip` — strežnik uporablja samo standardno knjižnico)
- [Git LFS](https://git-lfs.github.com/) za velike podatkovne datoteke
- Priporočljiv je računalnik z grafično kartico (GPU) — karta uporablja WebGL in GPU rendering bistveno izboljša gladkost delovanja

### Namestitev

```bash
git lfs install
git lfs pull          # prenese MBTiles in velike CSV datoteke
python3 server.py
# odprite http://localhost:8000
```

Ob prvem zagonu strežnik zgradi predpomnilniške datoteke JSON iz MBTiles in CSV datotek. Naslednji zagoni so hitrejši.

---

## Struktura projekta

```
BarkWatch_Korosci-plus-Tilen_interface/
├── server.py
├── static/
│   ├── index.html                   # Glavna stran aplikacije
│   ├── landing.html                 # Vstopna stran
│   ├── app.js                       # Logika odjemalca
│   ├── styles.css                   # Slogi glavne strani
│   ├── landing.css                  # Slogi vstopne strani
│   ├── logo.png
│   └── logo_transparent.png
├── data/                            # Vse podatkovne datoteke sledene z Git LFS
│   ├── odseki.csv
│   ├── gge.csv
│   ├── heatmap_past_data.csv
│   ├── heatmap_future_predictions.csv
│   ├── heatmap_past_data_synthetic.csv
│   ├── heatmap_future_predictions_synthetic.csv
│   ├── vector_map_odseki.mbtiles
│   ├── vector_map_gge.mbtiles
│   ├── vector_map_ggo.mbtiles
│   ├── vector_map_slovenia.mbtiles
│   ├── vector_map_odseki.bbox_cache.json   # samodejno ustvarjeno ob zagonu
│   ├── gge_heatmap_cache.json              # samodejno ustvarjeno ob zagonu
│   └── gge_heatmap_cache_synthetic.json    # samodejno ustvarjeno ob zagonu
├── notebooks/
├── scripts/
├── .gitattributes
└── requirements.txt
```

---

## Arhitektura

```
┌──────────────────────────────────────────────────────────┐
│                       Brskalnik                          │
│          index.html + app.js + styles.css                │
│                  MapLibre GL JS (karta)                  │
│                  Chart.js (časovni grafikon)             │
│                  Vanilla JS (UI, stanje, predpomnjenje)  │
└────────────────────────┬─────────────────────────────────┘
                         │ HTTP REST (GET + JSON)
                         │ Vektorske ploščice (MVT / protobuf)
┌────────────────────────▼─────────────────────────────────┐
│                 server.py  (Python 3 stdlib)             │
│  HTTPServer na :8000                                     │
│  ├── Strežnik statičnih datotek  (/, /static/*)          │
│  ├── REST API  (/api/*)                                  │
│  └── Strežnik ploščic  (/tiles/*, /gge-tiles/*, ...)     │
│                                                          │
│  V pomnilniku ob zagonu:                                 │
│  ├── odseki.csv  →  slovarji metapodatkov + indeks površin│
│  ├── gge.csv     →  tabela površin GGE                   │
│  ├── heatmap_*.csv  →  razvrščeni + zvezni podatki višin │
│  ├── MBTiles  →  predpomnilnik bbox (JSON)               │
│  └── agregat toplotne karte GGE (JSON)                   │
└────────────────────────┬─────────────────────────────────┘
                         │ SQLite (MBTiles)
                         │ CSV (metapodatki + podatki toplotne karte)
┌────────────────────────▼─────────────────────────────────┐
│                      data/                               │
│  vector_map_odseki.mbtiles                               │
│  vector_map_gge.mbtiles                                  │
│  vector_map_ggo.mbtiles                                  │
│  vector_map_slovenia.mbtiles                             │
│  odseki.csv  •  gge.csv                                  │
│  heatmap_past_data.csv                                   │
│  heatmap_future_predictions.csv                          │
│  heatmap_past_data_synthetic.csv                         │
│  heatmap_future_predictions_synthetic.csv                │
│  *.bbox_cache.json  •  *_cache.json                      │
└──────────────────────────────────────────────────────────┘
```

---

## Zaledni del (server.py)

### Zaporedje zagona

| Korak | Funkcija | Opis |
|-------|----------|------|
| 1 | `load_odseki_data()` | Razčleni `odseki.csv` v slovarje; izračuna površino odseka (`POVRSINA_BY_ODSEK`) |
| 2 | `load_gge_area_data()` | Prebere `gge.csv`; zgradi `GGE_AREA[(ggo, gge)] → ha` |
| 3 | `load_heatmap_data()` | Združi pretekle in prihodnje CSV; normalizira glede na površino; izračuna mejne vrednosti razredov; zgradi `HEATMAP_REL_BY_MONTH` (m³/ha) in stropne vrednosti p99 za višine |
| 4 | `load_heatmap_data_synthetic()` | Enako za sintetične podatke; podatki o višinah neposredno uporabljajo surove vrednosti podlubnikov/m² (brez ponovne normalizacije glede na površino) |
| 5 | `_load_or_build_bbox_index()` | Dekodira MBTiles pri povečavi 11; izlušči omejujoče okvire poligonov; zapiše/prebere predpomnilnik JSON |
| 6 | `_load_or_build_gge_cache()` | Agregira absolutne m³ po (ggo, gge) na mesec; razvrsti v razrede; zapiše/prebere predpomnilnik JSON |

### REST API

| Končna točka | Ključni parametri | Namen |
|--------------|------------------|-------|
| `GET /api/ggo` | — | Seznam vseh 14 imen GGO + možnosti za spustni meni |
| `GET /api/gge/ggo` | `gge` | Razreši ime GGE → njen GGO |
| `GET /api/odseki/suggest` | `q`, `ggo` | Samodejno dopolnjevanje za iskanje odseka (do 20 rezultatov) |
| `GET /api/odseki/by-key` | `ggo`, `odsek` | Metapodatki odseka + omejujoči okvir (za povečavo na karti) |
| `GET /api/odseki/{id}` | — | Metapodatki odseka; vrne `ambiguous` če se ujema z več GGO |
| `GET /api/heatmap/meta` | `dataset` | Razpoložljivi meseci, meja napovedi, mejne vrednosti razredov, maksimumi višin |
| `GET /api/heatmap` | `month`, `dataset` | Preslikava `{odsek_id: razred}` za celotno državo |
| `GET /api/heatmap/value` | `odsek`, `month`, `ggo`, `dataset` | Vrednost posameznega odseka (absolutno m³ + relativno m³/ha) |
| `GET /api/heatmap/odsek-series` | `odsek`, `ggo`, `dataset` | Celotna časovna vrsta za en odsek (vsi meseci) |
| `GET /api/heatmap/gge` | `month`, `dataset` | Preslikava `{ggo\x00gge: razred}` za barvanje na ravni GGE |
| `GET /api/heatmap/heights` | `month`, `dataset` | Zvezne vrednosti `{odsek_id: vrednost}` za višino 3D ekstruzije |
| `GET /api/heatmap/gge-heights` | `month`, `dataset` | Zvezne vrednosti `{ggo\x00gge: vrednost}` za višino 3D ekstruzije GGE |
| `GET /tiles/{z}/{x}/{y}` | — | MVT ploščica — poligoni gozdnih odsekov |
| `GET /gge-tiles/{z}/{x}/{y}` | — | MVT ploščica — meje gozdnih enot |
| `GET /ggo-tiles/{z}/{x}/{y}` | — | MVT ploščica — meje gozdnih območij |
| `GET /slo-tiles/{z}/{x}/{y}` | — | MVT ploščica — meja Slovenije |

### Razvrščanje toplotne karte v razrede

Vrednosti so razvrščene v 5 ravni:

| Razred | Pomen | Barva |
|--------|-------|-------|
| 0 | Ni podatkov | zelena |
| 1 | Nizka | rumeno-zelena |
| 2 | Zmerna | rumena |
| 3 | Visoka | oranžna |
| 4 | Zelo visoka | rdeča |

Resnični podatki se razvrščajo glede na vrednosti m³/ha, normalizirane po površini, z `HEATMAP_BREAKS`. Sintetični podatki se razvrščajo glede na surove izvorne vrednosti (že na površino normalizirane) z `HEATMAP_BREAKS_SYN`.

### Enote podatkov o višinah

Končni točki za višine vračata različne enote glede na nabor podatkov:

| Nabor podatkov | Enota | Utemeljitev |
|----------------|-------|-------------|
| Resnični | m³/ha | Surovi CSV je absolutni m³; strežnik deli s površino odseka/GGE |
| Sintetični | podlubniki/m² | Izvorne vrednosti so že na površino; nadaljnja normalizacija ni potrebna |

Vrednost p99 čez vse mesece se uporablja kot strop višine (`height_max` / `gge_height_max` v `/api/heatmap/meta`), da preprečimo, da bi osamelci stisnili lestvico.

### Dekodiranje vektorskih ploščic

Strežnik vsebuje dekoder Mapbox Vector Tile (protobuf), ki se ob zagonu uporablja za izluščitev omejujočih okvirjev poligonov iz `vector_map_odseki.mbtiles` (povečava 11) za funkcijo samodejnega dopolnjevanja z zoom na odsek.

---

## Čelni del (app.js, index.html, styles.css)

### Knjižnice

| Knjižnica | Različica | Uporaba |
|-----------|-----------|---------|
| [MapLibre GL JS](https://maplibre.org/) | 3.6.2 | Renderiranje vektorske karte (WebGL / GPU) |
| [Chart.js](https://www.chartjs.org/) | 4.4.0 | Stolpčni grafikon časovne vrste odseka |
| ArcGIS World Imagery | CDN raster | Satelitska podlaga |

Ni koraka gradnje niti orodja za združevanje — vse se nalaga s CDN ali se posreduje kot statične datoteke.

### Sloji karte

Osredotočeno na Slovenijo (`[14.9955, 46.1512]`, povečava 8) z zaklenjenimi mejami na državo.

| Vir | Končna točka | Vidno ko |
|-----|-------------|----------|
| `odseki` | `/tiles/{z}/{x}/{y}` | povečava ≥ 11 |
| `gge` | `/gge-tiles/{z}/{x}/{y}` | povečava < 11 |
| `ggo` | `/ggo-tiles/{z}/{x}/{y}` | vedno (samo obroba) |
| `slovenija` | `/slo-tiles/{z}/{x}/{y}` | vedno (samo meja) |

Vsak podatkovni sloj obstaja v dveh različicah: ravni sloj `fill` (2D) in sloj `fill-extrusion` (3D). Naenkrat je aktivna samo ena različica glede na nagib karte.

### 3D vizualizacija

Ko nagib karte preseže 1°, ekstruzijski sloji nadomestijo ravne sloje. Višina je sorazmerna z zvezno vrednostjo podatkov — ne z barvnim razredom — kar daje večjo ločljivost kot 5-stopenjska barvna lestvica.

| Konstanta | Vrednost | Sloj |
|-----------|----------|------|
| `MAX_EXTRUSION_HEIGHT_GGE` | 150.000 m | GGE (državna raven, ~425 m/px pri povečavi 8) |
| `MAX_EXTRUSION_HEIGHT_ODSEK` | 30.000 m | Odsek (lokalna raven, ~53 m/px pri povečavi 11) |

- **2D način:** ekstruzijski sloji imajo `visibility: none` — brez 3D GPU dela.
- **Časovna usklajenost preklapljanja slojev:** sloji se preklopijo v 2D *pred* začetkom animacij povečevanja ali zmanjševanja nagiba (gumb Domov, preklop 3D→2D).
- **Izbira posameznega odseka:** samo izbrani odsek se prikaže v 3D; vsi ostali se vrnejo na ravni sloj. Filter uporablja sestavljeni ključ `(ggo_naziv, odsek)` za enoznačnost.

### Predpomnjenje na strani odjemalca

Štirje LRU predpomnilniki (ključirani po nizu meseca), vsi izpraznjeni pri `HEATMAP_CACHE_LIMIT = 30`:

| Predpomnilnik | Vsebina |
|---------------|---------|
| `heatmapCache` | Preslikave razredov odsekov |
| `ggeCache` | Preslikave razredov GGE |
| `heightCache` | Zvezne vrednosti višin odsekov |
| `ggeHeightCache` | Zvezne vrednosti višin GGE |

Preklop nabora podatkov izbriše vse štiri predpomnilnike.

### Kontrole vmesnika

| Kontrola | Vedenje |
|----------|---------|
| Spustni meni GGO | Omeji iskanje in povečavo na izbrano območje |
| Iskanje odseka | Samodejno dopolnjevanje; izbere odsek in preleti do njega |
| Gumb ✕ (panel) | Prekliče izbiro odseka; viden samo ko je odsek izbran |
| Časovni drsnik | Preklopi prikazani mesec; gumba ‹/› premakneta za en mesec |
| Izmerjeni / Sintetični | Preklopi med resničnimi podatki o poseku in sintetičnimi podatki o gostoti podlubnikov |
| +/− | Povečava karte |
| Kompas / vlečenje | Prikazuje smer; klik ponastavi na sever; vlečenje levo/desno zavrti karto |
| 2D/3D / vlečenje | Klik preklopi med ravninskim in nagnjenim pogledom; vlečenje gor/dol nastavi nagib |
| ← / → | Navigacija nazaj/naprej po shranjenih stanjih pogleda |
| ⌂ domov | Preleti na pogled celotne države v 2D |
| ›/››/››› | Kolesari hitrost animacij: počasno / normalno / hitro |
| Legenda | Barvna legenda; potrditvena polja za vklop/izklop mej Slovenije in GGO |

---

## Podatkovne datoteke

### CSV datoteke

#### `odseki.csv`

Metapodatki gozdnih odsekov. Ena vrstica na kombinacijo odsek–GGO (odsek se lahko pojavi v več območjih).

| Stolpec | Opis |
|---------|------|
| `ggo_naziv` | Ime gozdnogospodarskega območja (npr. `CELJE`) |
| `odsek` | Niz ID odseka (lahko vsebuje presledke) |
| `povrsina` | Površina v hektarjih |
| `gge_naziv` | Ime gozdnogospodarske enote |
| `ke_naziv` | Krajevna enota |
| `revir_naziv` | Revirno območje |
| `katgozd_naziv` | Kategorija gozda |
| `ohranjen_naziv` | Status ohranjenosti |
| `relief_naziv` | Vrsta reliefa |
| `lega_naziv` | Ekspozicija |
| `pozar_naziv` | Razred požarne ogroženosti |
| `intgosp_naziv` | Intenzivnost gospodarjenja |
| `krajime` | Ime krajevne skupnosti |
| `grt1_naziv` | Primarni gozdni habitatni tip |
| `revirni` | Ime odgovornega gozdrarja |
| `eposta` | Kontaktni e-poštni naslov gozdrarja |

#### `gge.csv`

Ime GGE + koda GGO + površina v hektarjih. Uporablja se za normalizacijo vrednosti toplotne karte na ravni GGE.

#### `heatmap_past_data.csv`

Zgodovinski podatki o poseku z Zavoda za gozdove Slovenije. Vrstice z vrednostjo nič so odstranjene.

| Stolpec | Opis |
|---------|------|
| `ggo` | Številčna koda GGO (1–14) |
| `odsek_id` | Normaliziran ID odseka (presledki → ničle) |
| `leto_mesec` | Mesec v obliki `YYYY-MM` |
| `target` | Količina poseka v m³ |

#### `heatmap_future_predictions.csv`

Napovedi umetne inteligence, enaka shema kot pretekli podatki. Meseci, ki so prisotni v obeh datotekah, privzeto uporabijo vrednost napovedi (nadzorovano z `OVERLAP_PREFER = 'predictions'`).

#### `heatmap_past_data_synthetic.csv` + `heatmap_future_predictions_synthetic.csv`

Sintetični nabor podatkov o gostoti podlubnikov. Enaka shema, enote so podlubniki/m² namesto m³. Generirano iz podatkov o poseku z determinističnimi matematičnimi modeli; napovedi AI uporabljajo isti model kot za resnične podatke.

### Vektorske datoteke (MBTiles)

Vsi vektorski sloji so shranjeni kot [MBTiles](https://github.com/mapbox/mbtiles-spec) — baze podatkov SQLite z gzip-komprimiranimi Mapbox Vector Tiles, ki jih strežnik bere neposredno z `sqlite3`.

| Datoteka | Ime sloja | Atributi | Opombe |
|----------|----------|----------|--------|
| `vector_map_odseki.mbtiles` | `odseki_map_ggo_gge` | `ggo_naziv`, `gge_naziv`, `odsek` | Povečava 0–14; razčlenjen pri povečavi 11 za indeks bbox |
| `vector_map_gge.mbtiles` | `gge_vektor` | `ggo_naziv`, `gge_naziv` | Prikazan pri povečavi < 11 |
| `vector_map_ggo.mbtiles` | `ggo_maps` | `ggo_naziv` | Zelena obroba; nastavljivo |
| `vector_map_slovenia.mbtiles` | `meja_maps` | — | Modra meja; nastavljivo |

### Samodejno ustvarjene predpomnilniške datoteke

Ustvarjene ob prvem zagonu; samodejno obnovljene ob spremembi oznake različice.

| Datoteka | Ključ različice | Vsebina |
|----------|----------------|---------|
| `vector_map_odseki.bbox_cache.json` | `_BBOX_CACHE_VERSION = 5` | `{ggo\x00odsek: [Z, J, V, S, odsek_raw]}` |
| `gge_heatmap_cache.json` | `_GGE_CACHE_VERSION = 7` | `{mesec: {ggo\x00gge: razred}}` |
| `gge_heatmap_cache_synthetic.json` | enako | Enako za sintetični nabor podatkov |
