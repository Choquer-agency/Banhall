# Burner Anomaly Model: Development Log, Fiscal 2026

Quillmere Analytics Ltd., Carrow, Saskatchewan. Maintained by Rosalind Tiwari, reviewed by Anders Kowalczyk. Covers July 1 2025 to June 30 2026.

## Goal

Detect burner and column faults on grain dryers at least 15 minutes before they become dangerous, with false alarms below 0.25 per dryer-day, while plenum temperature sensors drift up to 3 C per month and moisture sensors up to 1.5 points per month.

## Data

- Training and validation: 2024 season, 14 dryers, about 11,000 dryer-hours at 1-minute resolution (about 660,000 rows per sensor channel).
- Documented faults with usable data: 11 (4 flame instability, 3 column plugging, 2 fuel valve sticking, 2 igniter).
- Drift profiles taken from post-season calibration checks on 23 sensors pulled in December 2024: median plenum drift 1.8 C per month, worst 3.1 C per month.

## Log

**2025-07-14 to 2025-08-08. Baseline rebuild.** Isolation forest, 42 features (raw sensors plus 5 and 15 minute rolling means and slopes). Held-out test with injected drift.

| Drift (C/month) | False alarms per dryer-day, week 4 |
|---|---|
| 0 | 0.3 |
| 1 | 0.7 |
| 2 | 1.4 |
| 3 | 2.6 |

Faults caught: 9 of 11. Median lead time 9 minutes.

**2025-08-11 to 2025-08-29. Synthetic drift training.** Random drift injected into training at 0.5 to 3 C per month and up to 1.5 moisture points per month, 5 augmented copies per dryer-season. False alarms at 2 C drift: 0.6 per dryer-day. Faults caught: 6 of 11. All 3 column plugs missed (these build over 30 to 60 minutes). Approach dropped.

**2025-09-02 to 2025-10-03. Energy balance residual with online bias tracking.** Per-dryer energy balance predicting plenum and exhaust temperature from fuel flow, fan speed, ambient temperature and humidity. Fit on first 48 hours of season. Residual RMS on clean 2024 data: 1.1 C plenum, 1.6 C exhaust. Kalman filter bias state per sensor, bias rate limited to 4 C per month, updates gated on steady-state flag (fuel and fan changes under 3 percent over 20 minutes).

Results at 3 C per month injected drift: false alarms 0.18 per dryer-day. Faults caught: 10 of 11. Median lead time 22 minutes. Miss: igniter fault on a single-plenum-sensor dryer.

**2025-10-06 to 2025-11-21. Harvest shadow trial.** 9 customer dryers (7 with dual plenum sensors, 2 single). About 7,100 dryer-hours logged.

- Dual sensor dryers: 0.21 false alarms per dryer-day. Highest measured drift 2.7 C per month (dryer Q-07).
- Single sensor dryers: 0.64 false alarms per dryer-day.
- Real events: 4 (2 flame instability, 2 plugging). All flagged. Lead times 14, 19, 26 and 31 minutes.
- Model inference time: 38 ms per dryer per minute on the controller.

**2026-01-12 to 2026-03-27. Single-sensor fallback.** Exhaust temperature used as an indirect second reference for plenum bias via the energy balance. Replay on fall data: single-sensor false alarms 0.64 down to 0.33 per dryer-day. No change in detection on the 4 events.

**2026-04-06 onward. Spring shadow mode.** Same 9 dryers. As of June 26 2026, 1,850 dryer-hours logged, false alarms 0.19 per dryer-day on dual-sensor units. No real events during spring.

## What we learned

- Synthetic drift training hides slow faults. Not usable here.
- Residuals from a physics-based energy balance, with rate-limited online bias tracking from redundant sensors, hold false alarms near 0.2 per dryer-day under realistic drift and give about 20 minute median lead time.
- Sensor redundancy is the deciding factor. Without a second plenum sensor, false alarms roughly triple.
- Exhaust temperature partly replaces a missing second plenum sensor, roughly halving the penalty.

## Open items

- Moisture sensor drift is not yet tracked with the same method.
- Flame instability lead time is marginal (14 minutes on one event).
- Single-sensor dryers still above target.
- First live-alert season planned for fall 2026 harvest.

## Not part of this log

The billing portal hosting move, the dashboard colour and layout update, and the dealer and operator training sessions are tracked in separate operations records and are outside this project.
