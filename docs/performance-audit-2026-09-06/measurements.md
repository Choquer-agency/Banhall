# Measurement details

Generated 2026-09-06T17:51:20.553214+00:00. Time values in milliseconds.

## Live public login

| Profile | Samples | LCP median | LCP range | Observed CLS | Errors |
|---|---:|---:|---:|---:|---:|
| Desktop | 3 | 244.0 | 228.0–328.0 | 0 | 0 |
| Mobile viewport / 4× CPU / constrained network | 3 | 652.0 | 628.0–660.0 | 0 | 0 |

Unsigned sign-in only. 148,272 encoded JavaScript bytes were reported per sample. No field INP is available. See evidence.json for conditions and compact source measurements.

## Report code import after Projects code import

| Profile | Samples | Median additional report module load | Range | Warm same-module reimport |
|---|---:|---:|---:|---:|
| 1× CPU local | 3 | 89.4 | 66.9–93.5 | 0.2–0.4 |
| 4× CPU with 80ms / 6Mbit | 3 | 912.1 | 905.4–912.6 | 2.5–5.4 |

23 new resources, 387,865 encoded / 1,339,617 decoded bytes in each sample. This is import/evaluation, not mounted report navigation.

## Actual Editor, final production-CSS run

| CPU | Approximate words | Samples | Mount through two frames (range) | Largest observed typing event per sample (range) | Maximum scripted transaction per sample (range) |
|---|---:|---:|---:|---:|---:|
| 1× | 2,000 | 3 | 42.3–92.2 | 16.0–56.0 | 2.8–3.9 |
| 1× | 10,000 | 3 | 54.1–61.3 | 40.0–56.0 | 3.9–5.4 |
| 1× | 50,000 | 3 | 138.5–141.4 | 40.0–40.0 | 13.3–15.4 |
| 4× | 2,000 | 3 | 211.6–220.0 | 48.0–48.0 | 7.9–9.4 |
| 4× | 10,000 | 3 | 280.4–289.3 | 64.0–72.0 | 15.9–19.4 |
| 4× | 50,000 | 3 | 600.4–612.2 | 112.0–120.0 | 56.4–58.4 |

All 18 final samples confirm computed font family Geist Variable. Typing used actual keyboard input with 35 ms inter-key delay and event timing threshold 16 ms. Max interaction samples are not field INP. Local save callback only; network save time excluded. The 50k-word input is a stress fixture, much larger than sampled current reports.

## Actual XLSX parser

| CPU | Rows × 20 columns | Input bytes | Samples | Parse elapsed range | Longest task range |
|---|---:|---:|---:|---:|---:|
| 1× | 5,000 | 744,979 | 2 | 321.5–333.0 | 296.0–303.0 |
| 1× | 20,000 | 2,982,397 | 2 | 1184.3–1194.8 | 1181.0–1193.0 |
| 4× | 5,000 | 744,979 | 2 | 1257.0–1292.3 | 1221.0–1253.0 |
| 4× | 20,000 | 2,982,397 | 2 | 4926.9–4933.2 | 4923.0–4930.0 |

Both outputs contain 400,053 characters. First workbook in each context includes library import; second has a warm library. No uploads performed.

## Chat reconstruction helper in Node

| Accumulated text chunks | Text characters | Samples | Replay range |
|---|---:|---:|---:|
| 100 | 3,500 | 5 | 1.4–8.1 |
| 1,000 | 35,000 | 5 | 11.2–12.9 |
| 5,000 | 175,000 | 5 | 170.8–199.6 |

Actual installed helper, synthetic text, no browser/markdown/network. First sample of each size includes warmup effects.

## Caveats

The compact evidence includes method, runtime and sample counts. Calibration is 4× CDP CPU simulation, not a phone model. Some initial diagnostic/editor measurements overlapped other audit processes; the final editor run uses exact CSS and was repeated after other timing probes finished. The audit does not claim controlled hardware isolation from unrelated user processes. Original rejected runs remain local and are excluded from the committed sample results.
