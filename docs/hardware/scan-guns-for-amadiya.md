# Handheld scanner options for Amadiya Agro Products

**Prepared by NexGen Innovations · 22 September 2026**
**For:** Amadiya Agro Products management
**Subject:** Selecting and purchasing handheld scanning hardware for the NexOrder warehouse module

---

## 1. Executive summary

The handheld scanner currently in use at Amadiya is **on loan and must be returned**. NexOrder's warehouse functions — Receive Stock, Putaway, Replenishment, Stocktake and scan-verified Picking — all depend on a handheld device. This report sets out five purchasable options, what each costs, and which one we recommend.

### Two findings that shape the decision

**Finding 1 — a budget of A$800 per unit does not reach this product category.**

The working budget we started from was under A$800 per device. The market does not support it. A rugged Android scanner with a 5.5-inch screen, an enterprise barcode engine and a drop rating suitable for a warehouse floor starts at roughly **A$840 landed as a direct import from China**, and at roughly **A$1,900 from an Australian supplier with local warranty**. The established brands (CipherLab, Honeywell, Zebra) sit between A$2,500 and A$3,500.

This is not a reason to abandon the purchase. It is a reason to decide deliberately between a cheap imported device with no local support and a supported device that costs three times as much — because that, and not the brand name, is the real choice.

**Finding 2 — reading a barcode from 3 metres away requires a different class of scan engine, not just a bigger label.**

Our initial expectation was that longer read distance could be achieved cheaply by printing larger barcodes. The manufacturers' own published decode tables do not support this.

| Scan engine | Class | Code 128 at 15 mil | Best published distance |
|---|---|---|---|
| **SE4770** (the engine in the borrowed unit) | Standard range | **0.71 m** | 0.92 m (20 mil Code 39) |
| **SE55** | Advanced range | **1.81 m** | 14.07 m (100 mil Code 39) |
| **SE4850** | Extended range | — | 21.4 m |

The borrowed unit's engine tops out **below one metre at any barcode size Zebra publishes**. Larger labels help, but they cannot take a standard-range engine to 3 metres. If scanning rack labels from the aisle floor is a genuine operational requirement, it must be bought in the scan engine.

The good news is that the threshold is lower than it first appears. On an advanced-range engine, a 20 mil barcode (0.5 mm bar width) reads at **2.77 m**, and our label system already supports bar widths up to 0.55 mm without modification. **Roughly 3 metres is reachable on an advanced-range engine with labels we can already print.**

### Recommendation

**Purchase the CipherLab RS36, specified with the SE5500 advanced-range imager.**

Indicative cost **A$2,600–2,800 per unit** (US list US$1,726; Australian quote required).

It is the right choice for four reasons:

1. **It is the direct successor to the unit Amadiya is already using.** The RS36 replaces the RS35. The scanner configuration NexOrder requires is already documented and proven on this vendor's software, and the two models share batteries, cradles and protective boots — so accessories bought now are not stranded.
2. **The advanced-range engine option solves the distance requirement** within the same device, at roughly A$700 less than the Zebra alternative.
3. **5.5-inch screen, Android 14, Wi-Fi 6, IP65/IP68, 1.5 m drop rating, hot-swappable battery, −20 °C to 50 °C.** It meets every requirement NexOrder places on the hardware.
4. **It is supported in Australia** through several resellers.

If budget is the binding constraint and 3-metre scanning is dropped, the **Urovo DT50** is the sensible Australian-supplied fallback. If Amadiya would rather standardise on the largest vendor with the strongest local service network, the **Zebra TC53 with the SE55 engine** is the premium choice at A$3,495 ex GST.

---

## 2. Why this is time-limited

The current device is borrowed. When it is returned, and until a replacement is in place, the following stop working:

| Function | What happens without a handheld |
|---|---|
| **Receive Stock** | Deliveries cannot be booked in against a supplier at the dock. |
| **Putaway** | Stock cannot be directed to a bin, and cannot be confirmed as placed. Goods read as sitting at the warehouse root. |
| **Picking** | Scan verification is how NexOrder prevents the wrong product being picked. Without it, that check is gone. |
| **Replenishment** | Pick-face top-ups cannot be scanned from the reserve bin to the pick bin. |
| **Stocktake** | Counting by location is not possible. |

None of this is a soft degradation — these functions require a scanner by design. Ordering lead times for enterprise handhelds in Australia are typically 2–6 weeks, and every device here requires a written quote before it can be ordered. **We recommend starting the quote process now, independently of the final model decision.**

---

## 3. What NexOrder requires of the device

These are not preferences. Each is a requirement the software imposes, and a device failing any one of them will not work correctly.

| # | Requirement | Why |
|---|---|---|
| 1 | **Scanner output set to keyboard "Key Event" mode** | NexOrder runs in the device's web browser. Scanner output modes that send data by Android Intent, by clipboard, or over a serial port are **completely invisible to a web page**. This is the single most important setting, and it is a configuration capability rather than a price tier — confirm it is available before ordering. |
| 2 | **Chrome / Android System WebView version 111 or newer** | Below this version the application renders without styling. All five options meet this. |
| 3 | **Character transmission faster than 50 ms per character** | NexOrder distinguishes a scan from a person typing by speed. Set the inter-character delay to 0 ms. |
| 4 | **Carriage Return as the terminator**, no prefix or AIM identifier | The app expects the bare code followed by Enter. |
| 5 | **Code 128, EAN-13 and UPC-A symbologies enabled** | Every bin, pallet and product label NexOrder prints is Code 128. Product barcodes from suppliers are EAN-13 and UPC-A. |
| 6 | **Able to read a 0.25 mm minimum bar width** | The narrowest label the system will print. All enterprise engines here exceed this. |
| 7 | **Vibration motor and speaker** | NexOrder signals scan accepted or rejected by vibration and tone, deliberately rather than relying on the scanner's own beep — which cannot be trusted to mean the app accepted the data. A device without a vibration motor loses the primary confirmation channel in a noisy warehouse. |
| 8 | **Screen at least 360 CSS pixels wide, portrait** | The warehouse screens are laid out to this width. A narrower screen breaks the layout. This rules out several traditional warehouse handhelds with small 4-inch displays. |
| 9 | **Rear camera** | Used as the fallback for reading a torn or damaged label. |

We already have the tooling to verify all of this on arrival: a printable calibration test sheet (`npm run scan:sheet`) and an on-device diagnostics page that reports the browser version, screen width, vibration support and audio support. **Any device should be tested against these before a bulk order is placed.**

---

## 4. The five options

### Option 1 — CipherLab RS36 · *recommended*

The direct replacement for the borrowed RS35.

| | |
|---|---|
| **Screen** | 5.5" HD+ (720 × 1440), 630 nits, Gorilla Glass, glove-capable |
| **Operating system** | Android 12 or 14, upgradeable to Android 16 |
| **Processor / memory** | Qualcomm octa-core 2 GHz · 4 GB RAM / 64 GB storage |
| **Scan engine** | **Standard range:** SE4100 / SE4770 · **Advanced range: SE5500** |
| **Durability** | IP65 **and** IP68 · 1.5 m drops (36×), 500 tumbles · 1.8 m with rubber boot |
| **Battery** | 4,000 mAh (12 h) or 6,000 mAh (18 h) — **hot-swappable** |
| **Temperature** | −20 °C to 50 °C |
| **Connectivity** | Wi-Fi 6, Bluetooth 5.1, 4G LTE, NFC |
| **Weight** | 288 g (319 g extended battery) |
| **Pistol grip** | Available as an accessory |
| **Indicative price** | **US$1,726** list for the Android 14 / SE5500 configuration ≈ **A$2,640** |
| **Australian supply** | Track'n'Trace, BPC Technology, Strike, PB Tech |

**Strengths.** Same vendor and same accessory ecosystem as the unit in use — batteries, cradles and boots are shared between RS35 and RS36, and the scanner configuration NexOrder needs is already proven on CipherLab's software. Hot-swappable battery means a shift change costs no session. IP68 is the strongest sealing rating in this list. The SE5500 advanced-range option resolves the distance requirement without changing device.

**Trade-offs.** CipherLab is a smaller vendor in Australia than Zebra or Honeywell, so the service network is thinner. We were unable to retrieve the published decode-distance table for the SE5500 — **request it from the reseller in writing at quote stage** and confirm it meets the distance Amadiya needs.

---

### Option 2 — Zebra TC53 with SE55 engine · *premium*

| | |
|---|---|
| **Screen** | 6" Full HD+ |
| **Operating system** | Android, long support runway |
| **Scan engine** | **SE55 advanced range** — published to 12.2 m |
| **Read distance** | 15 mil Code 128 → **1.81 m** · 20 mil → **2.77 m** · 55 mil → **7.44 m** |
| **Durability** | Rugged, enterprise warehouse grade |
| **Connectivity** | Wi-Fi 6E, 5G, CBRS |
| **Price** | **A$3,495 ex GST** (TechnoSource Australia), 1-year warranty |

**Strengths.** The largest screen here, the best-documented scan performance, and by far the strongest service and spares network in Australia. Zebra publishes full decode tables, so its performance can be verified before purchase rather than discovered after. Longest expected service life.

**Trade-offs.** The most expensive option — roughly **A$850 more per unit than the RS36** and four times the original budget. Warranty is only 1 year as listed; extended cover is a further cost. This is the right purchase if Amadiya intends to standardise on one vendor and keep the fleet for five or more years.

---

### Option 3 — Honeywell ScanPal EDA52 / EDA5S

| | |
|---|---|
| **Screen** | 5.5" HD (720 × 1440), Gorilla Glass |
| **Operating system** | Android 11, upgradeable to 13 |
| **Processor / memory** | Snapdragon SM6115 2.0 GHz · 3 GB/32 GB or 4 GB/64 GB |
| **Scan engine** | Honeywell S0703 — **standard range, rated 0–1 m** |
| **Durability** | IP67 · 1.2 m drop to concrete |
| **Battery** | 3,060 mAh, removable (**not** hot-swappable), ~8 h |
| **Temperature** | −10 °C to 50 °C |
| **Connectivity** | Wi-Fi 5, Bluetooth 5.1, 4G LTE, NFC |
| **Indicative price** | US$1,626–1,789 list ≈ **A$2,490–2,740** |
| **Australian supply** | Honeywell Australia, POSMarket |

**Strengths.** A tier-1 vendor with genuine Australian support at a price close to the RS36. Well-proven in retail and light warehouse use.

**Trade-offs — and they are material.** Honeywell rates the S0703 engine at **0 to 1 metre**, and offers **no extended-range option** on this model, so this device cannot meet the 3-metre requirement at all. Its specifications are also the weakest here in three other respects: the lowest drop rating (1.2 m), the smallest battery (3,060 mAh, roughly 8 hours and not hot-swappable), and the oldest wireless standard (Wi-Fi 5). **Recommended only if the distance requirement is dropped and Honeywell support is specifically valued.**

---

### Option 4 — Urovo DT50 / DT50P · *budget option with Australian supply*

| | |
|---|---|
| **Screen** | 5.7" (720 × 1440, 283 ppi) |
| **Operating system** | Android (9 through 13 depending on variant — **specify 13**) |
| **Processor / memory** | Qualcomm octa-core 2.45 GHz · 4 GB/64 GB or 8 GB/128 GB |
| **Scan engine** | 1D/2D imager; **long-range variants exist — confirm at quote** |
| **Durability** | IP67 · 1.5 m drop to concrete |
| **Battery** | 5,000 mAh, replaceable |
| **Temperature** | −20 °C to 60 °C — the widest range here |
| **Weight** | 265 g — the lightest here |
| **Indicative price** | A$2,099 inc GST (≈ **A$1,908 ex GST**) for an older Android 9 configuration |
| **Australian supply** | Urovo Australia, POSPlaza, OnlyPOS, QuickPOS, POSCentral, Barcodes.com.au, Scope Link, Logiqon |

**Strengths.** The cheapest device here that still has a **real Australian distribution network** — an Australian entity, multiple resellers, local warranty and no import risk. Largest screen in the budget group, best operating temperature range, good battery, lightest in hand.

**Trade-offs.** A second-tier vendor with a shorter support runway and less certain Android update commitment. The widely listed Australian configuration is Android 9, which is old — insist on Android 13. Long-range engine availability must be confirmed at quote; do not assume it.

---

### Option 5 — Chainway C66 · *lowest cost, direct import*

| | |
|---|---|
| **Screen** | 5.5" HD |
| **Operating system** | Android 11 or 13 |
| **Processor** | Octa-core |
| **Scan engine** | 1D/2D; **Zebra SE4710 available** on some variants |
| **Durability** | IP65 standard, IP67 optional |
| **Extras** | UHF RFID, fingerprint reader, NFC available |
| **Price** | **US$548** (US$499 for 2 or more) ≈ **A$840**, before freight, duty and GST |
| **Australian supply** | **None.** Direct import or through an overseas reseller. |

**Strengths.** By a wide margin the cheapest route to a working device, and the only option that comes close to the original A$800 target. The specification on paper is competitive, and the Zebra SE4710 engine variant is a known-good scanner.

**Trade-offs — read carefully before choosing this.** There is **no Australian warranty, no local RMA and no local support**. A failed unit must be shipped overseas at Amadiya's cost, and is out of service for weeks. IP65 as standard is the weakest sealing here. Android security update commitments are unclear. Quoted prices exclude freight, import duty and GST, which typically add 25–40%.

This is a reasonable choice **only** if Amadiya buys at least one spare unit as its own on-site replacement stock — which erodes much of the saving. Two C66 units land at roughly A$1,700–2,100, close to a single supported device.

---

### Considered and not recommended: Zebra MC3300x

The MC3300x is the classic warehouse handheld, with a pistol grip, a 7,000 mAh three-shift battery, and an SE4850 extended-range engine reading to **21.4 m** — the best scanning performance of anything reviewed.

**We do not recommend it, because its screen is 4 inches at 800 × 480 resolution.** That is very likely to present to the browser as approximately 320 CSS pixels wide — below the 360-pixel minimum NexOrder's warehouse screens are built to. The interface would not lay out correctly.

This is worth stating explicitly because it illustrates the shape of the market: **traditional long-range warehouse guns have small screens, and modern large-screen devices are mostly short-range.** The overlap — a 5.5-inch-or-larger screen with an advanced-range engine — is a narrow band, and the CipherLab RS36 with SE5500 and the Zebra TC53 with SE55 are the two devices in it.

---

## 5. Comparison

| | **RS36** *(rec.)* | **Zebra TC53** | **Honeywell EDA52** | **Urovo DT50** | **Chainway C66** |
|---|---|---|---|---|---|
| Screen size | 5.5" | 6.0" | 5.5" | 5.7" | 5.5" |
| Meets 360 px minimum | Yes | Yes | Yes | Yes | Yes |
| Android version | 12 / 14 → 16 | Current | 11 → 13 | 9–13 | 11 / 13 |
| Advanced-range option | **Yes** (SE5500) | **Yes** (SE55) | **No** — 1 m max | Confirm | Confirm |
| Sealing rating | **IP65 + IP68** | Rugged | IP67 | IP67 | IP65 (IP67 opt.) |
| Drop rating | **1.5 m** (1.8 m booted) | 1.3–1.8 m | 1.2 m | **1.5 m** | Not stated |
| Battery | 4,000 / **6,000 mAh** | Enterprise | 3,060 mAh | 5,000 mAh | Not stated |
| Hot-swap battery | **Yes** | Yes | No | No | No |
| Operating temp. | −20 to 50 °C | −20 to 50 °C | −10 to 50 °C | **−20 to 60 °C** | Not stated |
| Wi-Fi generation | **Wi-Fi 6** | **Wi-Fi 6E** | Wi-Fi 5 | Wi-Fi 6 ready | Standard |
| Australian support | Yes | **Strongest** | Yes | Yes | **None** |
| Shares RS35 accessories | **Yes** | No | No | No | No |
| Indicative unit price | **≈A$2,640** | **A$3,495** ex GST | ≈A$2,490–2,740 | ≈A$1,908 ex GST | ≈A$840 + import |

*All prices indicative. Enterprise handhelds are sold by written quote in Australia; US list prices converted at US$1 ≈ A$1.53 and are typically higher than negotiated reseller pricing.*

---

## 6. Total cost of ownership

The purchase price is not the cost of putting a scanner on the floor. A realistic three-year cost per device, using the recommended RS36:

| Item | Indicative cost | Note |
|---|---|---|
| Device (RS36, SE5500 advanced range) | A$2,640 | The quoted figure |
| Spare battery (6,000 mAh) | A$120–180 | Essential if running more than one shift |
| Charging cradle | A$180–400 | A 4-slot RS35/RS36 charger lists at **A$356** |
| Protective rubber boot | A$60–90 | Raises drop rating from 1.5 m to 1.8 m — pays for itself on the first drop |
| Hand strap / holster | A$40–80 | Reduces drops, which are the main cause of failure |
| Screen protector (2-pack) | A$30–50 | |
| Extended warranty, 3 years | A$300–500 | Strongly recommended — out-of-warranty repair often approaches replacement cost |
| **Three-year cost, one device** | **≈ A$3,370–4,140** | |

**Roughly 1.3 to 1.6 times the sticker price.** Budget accordingly.

Two notes for planning:

- **Accessories are shared with the RS35.** Any cradle or boot already at Amadiya for the borrowed unit fits the RS36. This is a genuine saving no other option offers.
- **Buy one spare device if the fleet is three or more.** A failed unit under warranty is still a unit off the floor for one to three weeks. A fourth device on a three-device site is cheaper than the disruption.

---

## 7. Recommendation and next steps

**Recommended:** CipherLab RS36 with the SE5500 advanced-range imager and the 6,000 mAh extended battery.

It is the lowest-risk option because it is the device Amadiya is already effectively using, one generation newer; it is the cheapest way to meet the 3-metre scanning requirement; and its accessories are shared with the current unit.

**Steps, in order:**

1. **Confirm two requirements with Amadiya.** First, is scanning from 3 metres genuinely needed, or is arm's-length scanning sufficient? This single answer changes the budget by roughly A$700 per unit. Second, how many devices, and how many shifts per day?
2. **Request written quotes** from Track'n'Trace, BPC Technology and Strike for the RS36, and from TechnoSource for the Zebra TC53 as a comparison. Ask each explicitly for: the **SE5500 decode distance table**, confirmation that **keyboard "Key Event" output mode** is supported, and the Android version and security update commitment.
3. **Test one unit before ordering the fleet.** We will print the calibration test sheet, configure the scanner, and run the on-device diagnostics to verify browser version, screen width, vibration and audio, and record the actual read distance achieved on Amadiya's own labels. This takes under an hour and removes all remaining risk.
4. **Place the order**, allowing 2–6 weeks lead time.

---

## Sources

- CipherLab RS36 specifications — cipherlab.com; Australian availability — trackntrace.com.au
- CipherLab RS36 configuration and US list price — barcodefactory.com (part AS36U4AF4SUU1)
- Zebra SE4770 decode distances — docs.zebra.com, TC72/TC77 product reference guide
- Zebra SE55 decode distances — docs.zebra.com, TC73/TC78 product reference guide, and SE55 specification sheet
- Zebra SE4850 extended range and MC3300x specifications — zebra.com
- Zebra TC53 Australian price — technosource.com.au
- Honeywell ScanPal EDA5S / EDA52 specifications — automation.honeywell.com; US list price — barcodefactory.com
- Urovo DT50 specifications — urovo.com; Australian pricing — posplaza.com.au
- Chainway C66 specifications — chainway.net; pricing — barcode-arena.com
- NexOrder software requirements — derived from the application source, September 2026

*Prepared by NexGen Innovations. Prices are indicative and require written quotation. Specifications were current at the date of this report.*
