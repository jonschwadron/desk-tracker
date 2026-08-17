# XAUUSD desk tracker

Live activity board for MACRO / MICRO / FVG. **Gold only.** Coinexx **demo** 5217539.

**Live board:** https://jonschwadron.github.io/desk-tracker/

`events.json` and `book.json` are snapshots, not a live broker feed. Trade Tracker refreshes them. The board polls `events.json` every 2.5s. No build step.

See [EVENT_CONTRACT.md](EVENT_CONTRACT.md) for the desk event shape.
