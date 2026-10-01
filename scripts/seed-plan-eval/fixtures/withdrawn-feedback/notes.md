# Test Memo: Adaptive Deburring of A357 Brackets, Fiscal 2026

Tessrow Robotics Corp., Grandbois, Quebec. From Hana Mizrahi (Controls) and Callum Oyelaran (Manufacturing Engineering). Date: June 29 2026. Distribution: engineering leads.

## Scope

This memo summarizes testing in the pilot cell in Bay 4 between August 11 2025 and June 19 2026 on vision-guided deburring of cast A357 aerospace brackets (about 180 by 90 mm). The deburring tool throughout is the floating head: a radially floating pneumatic spindle with contact force set by regulated air pressure, fitted with a 6 mm carbide burr on a nylon abrasive sleeve.

Customer requirements: edge radius 0.2 to 0.5 mm on every edge, no residual burr, total cycle under 4 minutes per bracket. Current manual process reject rate: about 9 percent. Incoming burr height ranges from 0.1 to 1.2 mm. Each bracket has 38 edges on the deburring path.

Material received: 1,200 brackets from casting lots C-114, C-121 and C-129.

## Hypothesis

If burr height per edge can be estimated from 2D images to within 0.1 mm RMS in under 120 ms per edge, and the floating head contact force is set from that estimate, edge radius will stay in window on at least 97 percent of edges and bracket rejects will fall below 3 percent within a 4 minute cycle.

## Test results

| Test | Dates | Brackets or edges | Key setting | Result |
|---|---|---|---|---|
| 1 Baseline | Sep 2025 | 120 brackets | Fixed 20 N | 14 percent rejects, 3:10 cycle |
| 2 Single-angle vision | Oct to Nov 2025 | 400 edges | Low-angle ring light | 0.18 mm RMS, 210 ms/edge |
| 3 Two-angle vision | Dec 2025 | 400 edges | 15 and 60 degree shots, GPU | 0.07 mm RMS, 95 ms/edge |
| 4 Force map | Jan to Feb 2026 | 60 coupons, 300 brackets | 8 to 40 N sweep, lookup table | 4.3 percent rejects, 96.1 percent edges in window, 3:50 cycle |
| 5 Thin flange fix | Mar to Apr 2026 | 360 brackets | Cap 26 N, feed 25 mm/s on flanges | 2.6 percent rejects, 97.8 percent in window, 3:58 cycle |
| 6 Wear correction | May 2026 | 240 brackets | Reference coupon every 25 brackets | 2.4 percent rejects, no drift trend |

## Observations

**Vision.** Single-angle lighting failed mainly because of specular reflection on machined faces. In test 2, 31 of 400 edges were overestimated by more than 0.4 mm, all on machined faces. Two-angle differencing removed that failure. The worst single-edge error in test 3 was 0.19 mm.

**Force map.** Force needed to reach a 0.35 mm target radius rises from about 10 N at 0.1 mm burr to about 22 N at 0.6 mm, then more steeply to about 34 N at 1.2 mm. The knee near 0.6 mm was repeatable across all three casting lots within plus or minus 2 N.

**Thin flanges.** Brackets have four flanges of 2.5 mm wall. Above about 28 N the flange deflected by up to 0.15 mm (measured with a dial indicator on a static load), the floating head lost contact and chattered. Capping at 26 N and slowing feed from 40 to 25 mm/s removed chatter on all 360 test 5 brackets. A second pass was also tried on 40 brackets and gave 3.9 percent rejects, so it was dropped.

**Abrasive wear.** Without correction, mean edge radius fell by about 0.06 mm over 150 brackets. The reference coupon check adds 22 seconds every 25 brackets, under 1 second per bracket on average. Sleeve life extended from a fixed 100 brackets to about 175 brackets.

## Conclusions

1. 2D burr height estimation to 0.07 mm RMS at 95 ms per edge is achievable on cast A357 with two-angle differencing.
2. Force versus burr height for the floating head is non-linear, with a knee near 0.6 mm.
3. Thin walls need a force cap with longer dwell instead of higher force.
4. Periodic reference coupons track abrasive wear well enough to hold rejects flat.

## Next steps

- Customer acceptance run of 1,000 brackets, target under 3 percent rejects, planned for October 2026.
- Internal edges (about 8 percent of edges on the next bracket family) that the camera cannot see directly.
- Transfer of the force map to A356 and one titanium bracket without a full re-sweep.
- Reduce GPU processing below 70 ms per edge to recover cycle margin.

All testing took place in the pilot cell in Bay 4.
