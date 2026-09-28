# Fouling-Resistant UV Analyzer: Scoping Notes for Fiscal 2026

Corvane Hydrologic Inc., Port Aldous, British Columbia. Authors: Devika Ramanathan (Sensor Engineering) and Owen Strachan (Firmware). Drafted July 22 2025, updated with results July 8 2026.

## Background

Our in-line analyzers measure UV absorbance at 254 nm as a proxy for dissolved organic carbon in municipal treatment plants. Biofilm on the optical window causes upward drift. Customer target: at least 30 days between cleanings with drift under 5 percent against lab grab samples.

## Status at end of fiscal 2025

- Prototype: Orion-1, single-channel 254 nm head with uncoated fused silica window and a mechanical wiper cycling every 15 minutes.
- Result at June 30 2025: Orion-1 held calibration for 14 days in secondary effluent before biofouling drift exceeded 5 percent.
- Wiper outcome: three blade materials (EPDM, silicone, fluoroelastomer) tested on Orion-1. Best result 16 days. Blades smeared thin film after about 7 days and scratched the window once loaded with grit. Wiper approach closed as failed.
- Open uncertainty 1: whether any window surface can resist biofilm attachment for 30 days or more while staying UV-clear at 254 nm and surviving chlorine and grit.
- Open uncertainty 2: whether drift can be compensated from a reference channel. Orion-1 had no reference channel, so fouling could not be separated from real changes in water quality.
- Fiscal 2025 spend on the program was roughly 1.4 person-years.

## Fiscal 2026 plan

New prototype: Orion-2. No wiper. Coated window. Dual-wavelength optics with measurement at 254 nm and reference at 365 nm.

Objectives:

1. Window coating with at least 85 percent transmission at 254 nm when new, and less than 5 percent transmission loss over 30 days in secondary effluent.
2. Reference-channel correction that holds drift at 254 nm to within 2 percent over 30 days without cleaning.

Hypothesis: if attenuation at 254 nm is a stable multiple of attenuation at 365 nm over the biofilm's life, a fitted multiple will hold corrected drift under 2 percent for 30 days. Coating hypothesis: a silica sol-gel with fluorinated top surface will keep raw drift under 5 percent for 30 days.

Schedule:

| Stage | Dates | Owner |
|---|---|---|
| Coupon screening | Aug 5 to Oct 31 2025 | Ramanathan |
| Fouling tank correction work | Oct 14 2025 to Jan 30 2026 | Strachan |
| Field trial, Harbourside plant | Feb 9 to Jun 12 2026 | Both |

Staffing: one technician (Leona Barkwell) on the fouling tank at about 90 percent time.

## Results summary

### Coating screening

Four candidates, 12 coupons each plus 12 uncoated controls, 42 days in secondary effluent side stream, transmission logged every 3 days.

- Uncoated: 5 percent loss at day 11, 22 percent at day 42.
- Fluorosilane monolayer: 92 percent initial, 5 percent loss at day 17.
- Zwitterionic brush: 71 percent initial, failed clarity target.
- Titania film: faster fouling than control, 5 percent loss at day 8.
- Sol-gel with fluorinated top: 89 percent initial, 5 percent loss at day 31.

Second round (November 2025): withdrawal speed cut from 2 mm/s to 1 mm/s, layer about 180 nm. Initial transmission 87 percent, 5 percent loss at day 38. Coating cost estimated at 11 dollars per window in batches of 50.

### Reference channel

Tank run 1 (6 heads, uncoated, nutrient-spiked about threefold, 21 days): 254/365 attenuation multiple about 1.6 in days 1 to 5, falling to about 1.15 after day 8. Fixed multiple of 1.4 left 4.8 percent drift at day 21.

Tank run 2: correction factor fitted as a function of accumulated 365 nm loss, trained on 4 heads, tested on 2. Held-out drift 1.7 percent at day 21. Repeat with 6 fresh heads in January 2026: worst case 1.9 percent. Correction adds about 0.4 ms per sample on the current processor.

### Field trial

Four Orion-2 units, two on secondary effluent, two on chlorinated final effluent. Grab samples twice weekly (68 grab samples total).

- Secondary, raw drift over 5 percent at day 36 and day 40.
- Secondary, corrected drift under 2 percent until day 52 and day 55.
- Final effluent unit B: 9 percent non-biofilm transmission loss between day 70 and day 90. Suspected chlorine attack on the fluorinated layer. Free chlorine at that point averaged 1.2 mg/L.

## Carried into fiscal 2027

- Coating durability in chlorinated water beyond 70 days.
- Cold-water behaviour at 4 to 6 C (trial water this year ranged 9 to 17 C).
- Whether the correction curve transfers to a second plant with high industrial load.
