# Powder on MDF: Trial Summary, Fiscal 2026

Velloway Panel Finishing Ltd., Kessridge, Ontario. Kept by Tobias Achterberg, process engineer. Covers July 1 2025 to June 30 2026. All trials on 25 mm MDF (moisture 6 to 7 percent) with routed edges: shaker profile (6 mm radius) and deep cove profile.

## Targets

| Measure | Target |
|---|---|
| DFT, faces | 70 to 90 microns |
| DFT, routed edges (edge wrap) | at least 60 microns |
| Pinholes and blistering | at most 1 per square metre |
| Cure | 50 MEK double rubs, no break-through |
| Substrate temperature at cure | 120 C or less |
| Bake window | at least 8 C wide (oven zones drift up to 4 C either way) |
| Line speed | 2.5 m per minute |

Thermocouples on every test panel logged the substrate temperature through preheat and cure.

## Trial 1, August to September 2025: datasheet process

IR preheat to 110 C substrate temp. Standard low-temperature powder, gel time 210 s at 130 C. Convection cure, 135 C air, 10 min.

| Result | Value |
|---|---|
| Peak substrate temp | 131 C |
| MEK rubs | 55 to 62 |
| Pinholes, overall | 14 per square metre |
| Pinholes, routed edges | 30 per square metre |
| DFT, faces / edges | 82 / 35 microns |

Pinholes follow the peak board temperature, not the dwell time.

## Trial 2, October 2025: lower cure air, longer dwell

Same preheat. Cure air 125 C, dwell 10 to 14 min.

| Cure air | Peak substrate temp | Pinholes per square metre | MEK rubs |
|---|---|---|---|
| 125 C | 121 C | 4 | 30 |
| 127 C | 123 C | 9 | 41 |

Onset of pinholes at a substrate temp of about 118 to 122 C at every dwell time tried. With this powder the bake window is close to zero.

## Trial 3, November 2025 to January 2026: conductive edge sealer

Water-based conductive sealer on routed edges only, flash-dried 6 min at 60 C. Preheat cut from 110 C to 85 C.

| Result | Value |
|---|---|
| Edge DFT, average / minimum | 58 / 47 microns |
| Pinholes | 1.8 per square metre |
| Cross-hatch adhesion, faces | 3B on 12 percent of panels (target 5B) |

Cause of the adhesion loss: sealer overspray on the faces. Fixed with an edge-only nozzle and a face mask; adhesion back to 5B.

## Trial 4, February to April 2026: fast-catalysed powder

Supplier's polyester-epoxy hybrid at three catalyst levels. Fastest level: gel time 95 s at 125 C (was 210 s). Cure at 120 C substrate temp in 9 min gave 55 MEK rubs. Oven split into a ramp zone and a hold zone; overshoot down from about 5 C to 2 C.

Bake window map, 1 C steps, with the edge sealer:

| Substrate temp | Result |
|---|---|
| below 113 C | undercured (under 50 MEK rubs) |
| 113 to 121 C | full cure, pinholes at most 1 per square metre |
| above 121 C | pinholes over 1 per square metre |

Window 8 C wide. Middle catalyst level: better flow, window only 4 C. Fastest level: orange peel 5 on the supplier's scale (target 6).

Sealer plus fast powder, 140 panels: DFT faces 78 microns, edges 64 microns average (minimum 52), pinholes 0.6 per square metre.

## Trial 5, May to June 2026: production pilot

600 doors over three weeks at 2.5 m per minute, customer orders.

| Profile | Panels | Pinholes per square metre | Edge DFT below 60 microns | MEK pass |
|---|---|---|---|---|
| Shaker | 420 | 0.8 | 0 percent | 98 percent |
| Deep cove | 180 | 1.1 | 13 percent | 98 percent |
| All | 600 | 0.9 | 4 percent | 98 percent |

All MEK failures came from one batch on the day oven zone 3 drifted 6 C low.

## What we learned

- On this board, pinholes start at a substrate temp of about 118 to 122 C, whatever the dwell time.
- An edge sealer can give the conductivity that preheat used to give. Preheat came down by 25 C.
- A powder with a gel time under 100 s at 125 C reaches full cure below the pinhole onset, with an 8 C bake window.
- Edge wrap on shaker edges meets 60 microns. Deep cove edges do not yet.

## Open items

- Edge wrap inside the deep cove profile: sealer type, gun angle or cove geometry.
- Oven zone control: a 6 C drift is outside an 8 C window.
- Orange peel at the fastest catalyst level.

## Other work this year (separate budgets)

- Powder booth extraction upgrade, spring 2026: new extraction fans and cartridge filters, installed by a contractor, about 180,000 dollars.
- Colour matching of the 14 catalogue shades for our largest kitchen customer, with the powder supplier.
