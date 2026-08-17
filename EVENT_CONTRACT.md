# Event contract — three desks

Merge bus (append-only JSONL, one object per line):

`/home/box/agent-data/projects/desk-tracker/events.jsonl`

Do not invent a second Micro log. Micro source of truth remains:

- append-only: `/workspace/micro-desk/cards.jsonl`
- snapshot: `/workspace/micro-desk/current.json`

MACRO will also append to `/workspace/macro-desk/cards.jsonl`.

The static board reads `public/events.json` (export of the bus + latest Micro card). Live desks append to the jsonl files; re-export or serve those tails later.

---

## Bus shape (MACRO / FVG / optional MICRO watch)

```
{
  "ts": "2026-08-16T22:03:00-04:00",
  "agent": "MACRO" | "MICRO" | "FVG",
  "action": "<see lists>",
  "symbol": "XAUUSD",
  "tf": "M1|M5|M10|M20|M30|D1|W1|MN",
  "payload": { ... }
}
```

Times: prefer offset ISO with America/New_York (`-04:00` / `-05:00`). Board displays ET.

`payload.sample: true` only on synthetic scaffold rows. Live MACRO/MICRO prints must omit it.

---

## MACRO

Gold only. Demo Coinexx 5217539. MACRO cards; Jonathan places/closes on his phone. No live Coinexx API — book is last statement.

Actions: `MAP`/`scan`, `IMPULSE`, `FVG SCORE`, `PA HUNT`, `CARD` (`LONG|WAIT|NO|SKIP`), `SIZE`, `HALF-TP`, `REFUSE`, `NEWS VETO`, `SKIP WEEK`, plus bus verbs already in use: `scan`, `box`, `runner`, `card`.

Card / payload field names (do not invent extras):

`status`, `skip_reason`, `symbol`, `tf_map`, `tf_entry`, `box {distal, proximal, mid_50}`, `nest`, `entry`, `sl` (distal−10), `sl_pad_usd` 10, `tp` none, `r_distance`, `risk_pct` 3 / cap 4, `risk_usd` 160.68, `lots`, `weekday_ok`, `d1_hh`, `d1_hl`, `d1_plus`, `chase_above_prox`, `seats {macro, fvg, micro}`, `reason`, `visual` (labeled chart required).

Rules the board encodes:

- Size new fills off **balance** 5355.93, not equity.
- FVG is a profit AREA, never auto-long.
- Fib is a ruler on the BOX (0=distal, 100=proximal, 50=mid), not a dump retrace.
- Analysis = TradingView OANDA/FXCM. Entries = Coinexx MT4. Never score off Coinexx candles.
- Skip week with no box = empty week, not a fail.
- Ticket **102034139** buy 0.05 from 4043.95, SL 4050 (above entry), state `lottery_ticket`. Never hide, never flatten, never move SL. Next half only if leftover doubles → 0.025, leave SL 4050. Adds both closed. No third gold long.

---

## MICRO

Actions only: `receive_impulse`, `nest`, `score`, `card` (`long|wait|invalid`), `manage_note`, `skip`. Bus may also show `watch`.

Hunt TFs: **M1 / M5 / M10 / M20 / M30 only**. Never M15. Never H1.

Micro never places or closes MT4. Never touches ticket 102034139.

Nest ≠ HTF box. Micro snipes **nest 50%**, not MACRO D1 50%.

`quiet: true` is a state. No new row ≠ idle bug.

Card fields: `agent`, `ts_et`, `card`, `symbol`, `spot`, `macro_impulse`, `htf_box`, `ltf_nest`, `hunt_tf`, `entry`, `sl` (distal−10), `risk_usd`, `lots`, `reason`, `refuse`, `picture`, `tickets_do_not_touch`, `quiet`.

The labeled `picture` IS the card. Show it large.

---

## FVG

Posts to the merge bus. Three lines: high / mid / low. **PROFIT AREA**. Never auto-long.

---

## Typical payload fragments

```
zone / box: { distal, proximal, mid_50, unused }
htf_box:    { tf, distal, proximal, mid, unused }
ltf_nest:   { ... } or null
fvg:        { high, low, candleTimes, state }   // profit area
trade:      { side, entry, sl, tp, halfTp, lots, riskPct, ticket, pnl, pnlPct }
picture / visual: path to labeled png
```
