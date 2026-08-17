# XAUUSD desk tracker

Live activity board for MACRO / MICRO / FVG. **Gold only.** Coinexx **demo** 5217539.

**Live board:** https://jonschwadron.github.io/desk-tracker/

Polls `events.json` and `book.json` every 2.5s (cache-bust). LIVE SPOT is an indicative XAU mid from [gold-api](https://api.gold-api.com/price/XAU) every 20s — **not Coinexx, not OANDA**. If gold-api fails, the board uses `book.json` bid and marks STALE.

`events.json` and `book.json` are desk snapshots, not a live broker feed. No build step.

See [EVENT_CONTRACT.md](EVENT_CONTRACT.md) for the desk event shape.
