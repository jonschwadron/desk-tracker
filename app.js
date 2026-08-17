/* XAUUSD desk board — static-hostable. Polls events.json. */
(function () {
  "use strict";

  const TZ = "America/New_York";
  const POLL_MS = 2500;
  const ET = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const ET_SHORT = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const ET_FULL = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, weekday: "short", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });

  const state = {
    events: [],
    book: null,
    seen: new Set(),
    fresh: new Set(),
    chart: null,
    series: null,
    lines: [],
    markersOn: false,
  };

  const $ = (id) => document.getElementById(id);

  function parseTs(ts) {
    if (!ts) return null;
    const d = new Date(ts);
    return isNaN(d) ? null : d;
  }
  function fmtET(ts) {
    const d = parseTs(ts);
    return d ? ET_SHORT.format(d) + " ET" : "—";
  }
  function fmtClock(d) {
    return ET.format(d) + " ET";
  }
  function num(n, d) {
    if (n == null || n === "" || Number.isNaN(Number(n))) return "—";
    return Number(n).toLocaleString("en-US", { minimumFractionDigits: d ?? 2, maximumFractionDigits: d ?? 2 });
  }
  function px(n) {
    if (n == null || n === "") return "—";
    return Number(n).toFixed(Number(n) >= 100 ? 2 : 3);
  }
  function clsPnl(n) {
    if (n == null) return "";
    return Number(n) >= 0 ? "up" : "dn";
  }
  function evKey(e) {
    const p = e.payload || {};
    return [e.ts, e.agent, e.action, e.tf, p.ticket || p.status || p.card || p.label || p.reason || ""].join("|");
  }
  function isSample(e) {
    const p = e.payload || {};
    return p.sample === true || e.sample === true;
  }
  function payload(e) { return (e && e.payload) || {}; }

  function oneLine(e) {
    const p = payload(e);
    const a = (e.action || "").toLowerCase();
    if (p.reason && (a === "card" || a === "watch" || a === "refuse")) {
      const card = (p.card || p.status || "").toString().toUpperCase();
      const refuse = p.refuse ? " · " + p.refuse : "";
      return (card ? card + " — " : "") + p.reason + refuse;
    }
    if (a === "scan") {
      const c = p.c != null ? "C " + px(p.c) : "";
      const bar = p.last_d1_bar || "";
      return [bar, c, p.status, p.spot_sunday_mt4 || p.spot, p.note].filter(Boolean).join(" · ");
    }
    if (a === "box") {
      const box = p.box || p.htf_box || p;
      const d = box.distal, pr = box.proximal, m = box.mid_50 || box.mid;
      const lab = p.label || p.side || "box";
      return [lab, p.freshness, d != null ? px(d) + "–" + px(pr) : "", m != null ? "mid " + px(m) : "", p.refuse || p.note]
        .filter(Boolean).join(" · ");
    }
    if (a === "runner") {
      return "ticket " + (p.ticket || "") + " " + (p.type || p.side || "buy") + " " +
        (p.lots != null ? p.lots : "") + " @ " + px(p.open_price || p.entry) +
        " SL " + px(p.sl) + " · " + (p.state || "runner");
    }
    if (a === "card") {
      return [(p.status || p.card || "").toString().toUpperCase(), p.skip_reason || p.reason, p.refuse, p.spot]
        .filter(Boolean).join(" · ");
    }
    if (p.note) return p.note;
    if (p.reason) return p.reason;
    return a || "event";
  }

  /* ---------- clock ---------- */
  function tickClock() {
    $("clock-et").textContent = fmtClock(new Date());
  }

  /* ---------- P/L strip from last statement ---------- */
  function renderPL() {
    const b = state.book || {};
    const cells = [
      { k: "BALANCE", v: num(b.balance), s: "size new fills off this", c: "gold" },
      { k: "EQUITY", v: num(b.equity), s: "statement, not live", c: "" },
      { k: "FLOATING", v: (b.floating_pl >= 0 ? "+" : "") + num(b.floating_pl), s: "open runner mark", c: clsPnl(b.floating_pl) },
      { k: "REALIZED", v: "+" + num(b.closed_pl), s: "closed rows on statement", c: "up" },
      { k: "MARGIN", v: num(b.margin), s: "free " + num(b.free_margin), c: "" },
      { k: "RISK / FILL", v: "$" + num(b.risk_usd_new_fills), s: (b.risk_pct || 3) + "% / cap " + (b.risk_pct_cap || 4) + "%", c: "gold" },
      { k: "ACCOUNT", v: b.account || "5217539", s: (b.server || "Coinexx-Demo") + " · " + (b.broker_tz || "GMT+3"), c: "" },
      { k: "STATEMENT", v: "16 Aug 20:06", s: b.statement_label || "LAST STATEMENT — not live Coinexx", c: "warn" },
    ];
    $("pl-strip").innerHTML = cells.map((c) =>
      `<div class="pl-cell"><div class="k">${c.k}</div><div class="v ${c.c}">${c.v}</div><div class="s">${c.s}</div></div>`
    ).join("");
  }

  /* ---------- agents ---------- */
  function lastOf(agent) {
    const evs = state.events.filter((e) => (e.agent || "").toUpperCase() === agent);
    return evs.length ? evs[evs.length - 1] : null;
  }
  function renderAgents() {
    const now = Date.now();
    const seats = ["MACRO", "MICRO", "FVG"].map((name) => {
      const ev = lastOf(name);
      const p = payload(ev);
      let status = "idle";
      let statusLabel = "IDLE";
      let last = "no print yet";
      let action = "—";
      if (ev) {
        last = fmtET(ev.ts);
        action = (ev.action || "").toUpperCase();
        const age = now - (parseTs(ev.ts)?.getTime() || 0);
        if (p.quiet === true) { status = "quiet"; statusLabel = "QUIET"; }
        else if ((p.card || p.status || "").toString().toLowerCase() === "wait") { status = "wait"; statusLabel = "WAIT"; }
        else if (age < 15 * 60 * 1000) { status = "live"; statusLabel = "LIVE"; }
        else { status = "quiet"; statusLabel = "QUIET"; }
      }
      if (name === "MICRO" && !ev) {
        last = "silence is a state";
        status = "quiet";
        statusLabel = "QUIET";
      }
      if (name === "FVG" && !ev) {
        last = "no FVG print · profit area empty";
      }
      const extra = ev ? oneLine(ev) : (name === "MICRO" ? "no new row ≠ idle bug" : "waiting on desk");
      return { name, status, statusLabel, last, action, extra };
    });
    $("agents").innerHTML = seats.map((s) =>
      `<div class="seat ${s.name}">
        <div class="name">${s.name}</div>
        <div class="meta">${s.action}<br>${s.last}<br>${esc(s.extra)}</div>
        <div class="badge ${s.status}">${s.statusLabel}</div>
      </div>`
    ).join("");

    const cardEv = [...state.events].reverse().find((e) => (e.action || "").toLowerCase() === "card");
    const p = payload(cardEv);
    const st = (p.status || p.card || "WAIT").toString().toUpperCase();
    const pill = $("card-status");
    pill.textContent = st;
    pill.className = "status-pill " + st.toLowerCase();
    $("card-reason").textContent = p.skip_reason || p.reason || p.refuse || "price above unused M30 · no 50% · do not chase";
  }

  /* ---------- zones + nest ---------- */
  function collectZones() {
    const zones = [];
    const seen = new Set();
    for (const e of state.events) {
      const p = payload(e);
      const boxes = [];
      if (p.box && (p.box.distal != null || p.box.proximal != null)) {
        boxes.push({ src: e, box: p.box, kind: "htf", label: p.label, side: p.side, freshness: p.freshness, tf: e.tf, note: p.note || p.refuse });
      }
      if (p.htf_box && p.htf_box.distal != null) {
        boxes.push({ src: e, box: p.htf_box, kind: "htf", label: "HTF box (MACRO map)", side: "demand", freshness: p.htf_box.unused ? "unused" : "used", tf: p.htf_box.tf || e.tf, note: "Micro snipes nest 50%, not this box 50%" });
      }
      if (p.ltf_nest && p.ltf_nest.distal != null) {
        boxes.push({ src: e, box: p.ltf_nest, kind: "nest", label: "LTF nest", side: "nest", freshness: "hunt", tf: p.hunt_tf || e.tf, note: "Nest ≠ HTF box. Snipe nest 50%." });
      }
      if ((e.action || "").toLowerCase() === "box") {
        const b = { distal: p.distal, proximal: p.proximal, mid_50: p.mid_50, mid: p.mid };
        if (p.tape_box) {
          boxes.push({ src: e, box: p.tape_box, kind: "htf", label: (p.label || "box") + " · tape", side: p.side, freshness: p.freshness, tf: e.tf, note: p.note });
        }
        if (p.his_box) {
          boxes.push({ src: e, box: p.his_box, kind: "hold", label: (p.label || "box") + " · his approx", side: p.side, freshness: p.freshness, tf: e.tf, note: "approximate — tape is source of truth" });
        }
        if (b.distal != null) {
          boxes.push({ src: e, box: b, kind: p.freshness === "used_hold" ? "hold" : "htf", label: p.label || p.side || "box", side: p.side, freshness: p.freshness, tf: e.tf, note: p.refuse || p.note });
        }
      }
      if (p.side === "supply" || (p.label || "").toLowerCase().includes("supply")) {
        /* already pushed */
      }
      for (const z of boxes) {
        const key = [z.tf, z.box.distal, z.box.proximal, z.label].join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        zones.push(z);
      }
    }
    /* locked live map if events somehow thin */
    if (!zones.some((z) => z.box && Number(z.box.proximal) === 4392)) {
      zones.unshift({
        kind: "htf", label: "M30 unused demand", side: "demand", freshness: "unused", tf: "M30",
        box: { distal: 4373, proximal: 4392, mid_50: 4382.5 },
        note: "spot above proximal → WAIT · do not chase 4407",
      });
    }
    return zones;
  }

  function renderZones() {
    const zones = collectZones();
    const nestPresent = state.events.some((e) => payload(e).ltf_nest);
    let html = zones.map((z) => {
      const b = z.box || {};
      const mid = b.mid_50 != null ? b.mid_50 : b.mid;
      const klass = z.kind === "nest" ? "nest" : z.kind === "hold" ? "hold" : (z.side === "supply" ? "supply" : "demand");
      return `<div class="zone ${klass}">
        <div class="zh"><span class="tag">${esc(z.label || z.side || "ZONE")}</span><span class="tf">${esc(z.tf || "")} · ${esc(z.freshness || "")}</span></div>
        <div class="row"><span>proximal 100</span><span>${px(b.proximal)}</span></div>
        <div class="row"><span>mid 50</span><span class="gold">${px(mid)}</span></div>
        <div class="row"><span>distal 0</span><span>${px(b.distal)}</span></div>
        ${z.note ? `<div class="note">${esc(z.note)}</div>` : ""}
      </div>`;
    }).join("");
    if (!nestPresent) {
      html += `<div class="zone nest">
        <div class="zh"><span class="tag">LTF NEST</span><span class="tf">none</span></div>
        <div class="note">No nest. Nest ≠ HTF box. Micro snipes nest 50%, not MACRO D1/M30 50%. Hunt TFs: M1/M5/M10/M20/M30 only.</div>
      </div>`;
    }
    /* unused D1 supply from the live map if not in events */
    if (!zones.some((z) => z.side === "supply" || (z.label || "").toLowerCase().includes("supply"))) {
      html += `<div class="zone supply">
        <div class="zh"><span class="tag">D1 SUPPLY unused</span><span class="tf">D1 · unused</span></div>
        <div class="row"><span>proximal</span><span>5437.995</span></div>
        <div class="row"><span>distal</span><span>5596.805</span></div>
        <div class="note">Jan 28–29 peak. Not a long. Overhead only.</div>
      </div>`;
    }
    $("zones").innerHTML = html;
  }

  function renderFVG() {
    const fvgs = [];
    for (const e of state.events) {
      const p = payload(e);
      if (p.fvg && (p.fvg.high != null || p.fvg.low != null)) fvgs.push({ e, f: p.fvg });
    }
    if (!fvgs.length) {
      $("fvg").innerHTML = `<div class="fvg-empty">No live FVG posted. Three-line template:</div>
        <div class="fvg-lines">
          <div class="ln"><span>HIGH</span><span class="faint">—</span></div>
          <div class="ln"><span>MID</span><span class="faint">—</span></div>
          <div class="ln"><span>LOW</span><span class="faint">—</span></div>
        </div>
        <div class="note" style="margin-top:8px;color:var(--faint);font:400 10px/1.4 var(--mono)">
          FVG = PROFIT AREA. Never auto-long off a gap. Seat FVG is confirmation only.
        </div>`;
      return;
    }
    $("fvg").innerHTML = fvgs.map(({ f }) => {
      const mid = f.mid != null ? f.mid : (f.high != null && f.low != null ? (Number(f.high) + Number(f.low)) / 2 : null);
      return `<div class="fvg-lines">
        <div class="ln"><span>HIGH</span><span>${px(f.high)}</span></div>
        <div class="ln"><span>MID</span><span class="gold">${px(mid)}</span></div>
        <div class="ln"><span>LOW</span><span>${px(f.low)}</span></div>
        <div class="note">${esc(f.state || "PROFIT AREA · not a long")}</div>
      </div>`;
    }).join("");
  }

  /* ---------- book ---------- */
  function lotteryFromEvents() {
    const ev = [...state.events].reverse().find((e) => {
      const p = payload(e);
      return String(p.ticket) === "102034139" || (e.action || "") === "runner";
    });
    return ev ? payload(ev) : null;
  }
  function renderBook() {
    const open = (state.book && state.book.open) || [];
    const run = lotteryFromEvents() || {};
    let rows = open.slice();
    if (!rows.some((r) => String(r.ticket) === "102034139")) {
      rows.unshift({
        ticket: "102034139", side: "buy", lots: 0.05, entry: 4043.95, sl: 4050,
        tp: null, state: "lottery_ticket", agent: "MACRO", do_not_touch: true,
      });
    }
    const t = rows.find((r) => String(r.ticket) === "102034139") || rows[0];
    const flt = (state.book && state.book.floating_pl) || t.statement_floating || 1604.95;
    $("book").innerHTML = `
      <div class="book-ticket">
        <div><span class="tix">#${t.ticket}</span><span class="state">${(t.state || "lottery_ticket").toUpperCase()}</span></div>
        <div class="kv"><span class="k">side</span><span class="buy">BUY / LONG</span></div>
        <div class="kv"><span class="k">lots</span><span>${t.lots} <span class="s">(started ${t.started_lots || run.started_lots || 0.1})</span></span></div>
        <div class="kv"><span class="k">entry</span><span>${px(t.entry || run.open_price)}</span></div>
        <div class="kv"><span class="k">SL</span><span class="dn">${px(t.sl)} · ABOVE entry · DO NOT MOVE</span></div>
        <div class="kv"><span class="k">half-TP</span><span>taken · leftover is the runner</span></div>
        <div class="kv"><span class="k">TP / runner</span><span>none · let it run</span></div>
        <div class="kv"><span class="k">risk %</span><span>n/a on leftover · new fills 3%</span></div>
        <div class="kv"><span class="k">floating (stmt)</span><span class="up">+${num(flt)}</span></div>
        <div class="kv"><span class="k">carded by</span><span class="gold">MACRO</span></div>
        <div class="do-not">DO NOT TOUCH · DO NOT FLATTEN · next half only if leftover doubles → 0.025, leave SL 4050. Adds both closed. No third gold long.</div>
      </div>
      <div class="table-wrap"><table class="book">
        <thead><tr><th>TICKET</th><th>SIDE</th><th>ENTRY</th><th>SL</th><th>LOTS</th><th>FLT</th><th>AGENT</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td>${r.ticket}</td><td class="buy">${(r.side || "buy").toUpperCase()}</td>
          <td>${px(r.entry)}</td><td>${px(r.sl)}</td><td>${r.lots}</td>
          <td class="up">+${num(flt)}</td><td>${r.agent || "MACRO"}</td>
        </tr>`).join("")}</tbody>
      </table></div>`;
  }

  function renderStory() {
    const t = ((state.book && state.book.open) || [])[0] || {};
    const run = lotteryFromEvents() || {};
    const steps = [
      { k: "card", title: "CARD", det: "Original long off the June/July base. Adds both closed. Leftover is the only gold seat." },
      { k: "entry", title: "ENTRY  4043.95", det: "Ticket 102034139 · buy 0.05 (started 0.10) · 29 Jul 20:26 broker GMT+3" },
      { k: "half", title: "HALF-TP  TAKEN", det: "Size cut to 0.05. SL stays 4050. Do not move it to BE." },
      { k: "runner", title: "RUNNER  LOTTERY TICKET", det: "Floating +1604.95 on last statement (16 Aug 20:06). Next half only if leftover doubles → 0.025." },
      { k: "stop", title: "SL  4050  —  DO NOT MOVE", det: "SL is ABOVE entry. This is the hold. Micro never places or closes MT4. Never touch this ticket." },
    ];
    $("story").innerHTML = `<div class="story">${steps.map((s) =>
      `<div class="step ${s.k}"><div class="when">#${t.ticket || run.ticket || "102034139"}</div>
       <div class="what">${s.title}</div><div class="det">${s.det}</div></div>`
    ).join("")}</div>`;
  }

  /* ---------- pictures ---------- */
  function renderPictures() {
    const pics = [];
    const seen = new Set();
    for (const e of state.events) {
      const p = payload(e);
      const path = p.picture || p.visual;
      if (!path) continue;
      let src = String(path);
      if (src.includes("xauusd-wait-2026-08-16")) src = "images/xauusd-wait-2026-08-16.png";
      if (src.includes("xauusd-d1-sd-labeled")) src = "images/xauusd-d1-sd-labeled.png";
      if (src.startsWith("/workspace/")) {
        const base = src.split("/").pop();
        src = "images/" + base;
      }
      if (seen.has(src)) continue;
      seen.add(src);
      pics.push({
        src,
        cap: (p.card || p.status || e.action || "CARD").toString().toUpperCase() +
          " · " + (e.agent || "") + " · " + fmtET(e.ts) +
          (p.reason ? " · " + p.reason : ""),
      });
    }
    if (!seen.has("images/xauusd-wait-2026-08-16.png")) {
      pics.unshift({
        src: "images/xauusd-wait-2026-08-16.png",
        cap: "WAIT · MICRO · 16 Aug 21:35 ET · unused M30 4373–4392 · spot 4400.90 above proximal · no nest",
      });
    }
    if (!seen.has("images/xauusd-d1-sd-labeled.png")) {
      pics.push({
        src: "images/xauusd-d1-sd-labeled.png",
        cap: "D1 S/D labeled · tape through 14 Aug · unused 4223.225–4303.745 · runner 4043.95 / SL 4050",
      });
    }
    $("pictures").innerHTML = pics.map((p) =>
      `<figure class="pic-card"><img src="${p.src}" alt="${esc(p.cap)}"><figcaption class="pic-cap"><b>LABELED</b> · ${esc(p.cap)}</figcaption></figure>`
    ).join("");
  }

  /* ---------- feed ---------- */
  function renderFeed() {
    const evs = state.events.slice().sort((a, b) => {
      const da = parseTs(a.ts)?.getTime() || 0;
      const db = parseTs(b.ts)?.getTime() || 0;
      return db - da;
    });
    const liveN = evs.filter((e) => !isSample(e)).length;
    $("feed-meta").textContent = evs.length + " prints · " + liveN + " live · newest first";
    $("feed").innerHTML = evs.map((e) => {
      const k = evKey(e);
      const fresh = state.fresh.has(k) ? " fresh" : "";
      const ag = (e.agent || "?").toUpperCase();
      return `<div class="row-ev ${ag}${fresh}">
        <div class="t">${fmtET(e.ts)}</div>
        <div class="ag">${ag}</div>
        <div class="act">${esc(e.action || "")}</div>
        <div class="tf">${esc(e.tf || "")}</div>
        <div class="one">${esc(oneLine(e))}</div>
      </div>`;
    }).join("");
    const anyLive = evs.some((e) => !isSample(e));
    $("sample-banner").hidden = anyLive;
  }

  /* ---------- chart ---------- */
  function placeholderTape() {
    /* Synthetic XAUUSD-looking M30-ish bars, Jul 29 → Aug 16. NOT a live quote. */
    const out = [];
    const start = Date.UTC(2026, 6, 29, 17, 0, 0); /* 29 Jul ~ ticket era */
    let t = start / 1000;
    let c = 4048;
    const target = [
      [4043, 8], [4075, 12], [4120, 16], [4180, 20], [4224, 10],
      [4260, 14], [4304, 8], [4330, 10], [4310, 6], [4374, 18],
      [4396, 8], [4370, 6], [4401, 10],
    ];
    let bi = 0, left = target[0][1];
    for (let i = 0; i < 118; i++) {
      const dest = target[Math.min(bi, target.length - 1)][0];
      const drift = (dest - c) * 0.18;
      const w = 6 + (i % 7);
      const o = c;
      const h = o + Math.abs(drift) + w * 0.45 + (i % 3);
      const l = o - w * 0.55 - ((i * 3) % 5);
      c = o + drift + ((i % 5) - 2) * 0.8;
      if (c > h) c = h - 0.4;
      if (c < l) c = l + 0.4;
      out.push({ time: t, open: +o.toFixed(3), high: +h.toFixed(3), low: +l.toFixed(3), close: +c.toFixed(3) });
      t += 4 * 3600;
      left -= 1;
      if (left <= 0 && bi < target.length - 1) { bi += 1; left = target[bi][1]; }
    }
    /* pin last close near Sunday spot so markers make sense */
    const last = out[out.length - 1];
    last.close = 4400.9;
    last.high = Math.max(last.high, 4409);
    last.low = Math.min(last.low, 4394);
    last.open = 4396;
    return out;
  }

  function ensureChart() {
    if (state.chart) return;
    const el = $("chart");
    state.chart = LightweightCharts.createChart(el, {
      layout: { background: { color: "#0a0a08" }, textColor: "#8a8070", fontFamily: "IBM Plex Mono" },
      grid: { vertLines: { color: "#16140f" }, horzLines: { color: "#16140f" } },
      rightPriceScale: { borderColor: "#2a2416" },
      timeScale: { borderColor: "#2a2416", timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: "#c9a22755" }, horzLine: { color: "#c9a22755" } },
      width: el.clientWidth,
      height: 340,
    });
    state.series = state.chart.addCandlestickSeries({
      upColor: "#3dba7a", downColor: "#d4544a",
      borderUpColor: "#3dba7a", borderDownColor: "#d4544a",
      wickUpColor: "#3dba7a", wickDownColor: "#d4544a",
    });
    state.series.setData(placeholderTape());
    window.addEventListener("resize", () => {
      if (state.chart) state.chart.applyOptions({ width: el.clientWidth });
    });
  }

  function applyLinesAndMarkers() {
    if (!state.series) return;
    state.lines.forEach((l) => { try { state.series.removePriceLine(l); } catch (e) {} });
    state.lines = [];
    const add = (price, color, title) => {
      if (price == null || Number.isNaN(Number(price))) return;
      const line = state.series.createPriceLine({
        price: Number(price), color, lineWidth: 1, lineStyle: 2,
        axisLabelVisible: true, title,
      });
      state.lines.push(line);
    };
    add(4392, "#3dba7a", "M30 prox 4392");
    add(4382.5, "#c9a227", "M30 mid 4382.5");
    add(4373, "#3dba7a", "M30 dist 4373");
    add(4303.745, "#d4a017", "D1 prox 4304");
    add(4223.225, "#d4a017", "D1 dist 4223");
    add(4400.9, "#4aa3d4", "SPOT 4400.90");
    add(4050, "#d4544a", "SL 4050");
    add(4043.95, "#3dba7a", "ENTRY 4043.95");

    const markers = [];
    for (const e of state.events) {
      const p = payload(e);
      const t = parseTs(e.ts);
      if (!t) continue;
      const time = Math.floor(t.getTime() / 1000);
      const a = (e.action || "").toLowerCase();
      const price = p.price || (p.trade && p.trade.entry) || p.entry || p.open_price || p.spot;
      if (a === "entry" || (a === "runner" && p.open_price)) {
        markers.push({ time, position: "belowBar", color: "#3dba7a", shape: "arrowUp", text: "ENTRY " + px(p.open_price || p.entry || 4043.95) });
      } else if (a === "half_tp" || p.half_taken) {
        markers.push({ time, position: "aboveBar", color: "#d4a017", shape: "circle", text: "HALF" });
      } else if (a === "stop" || a === "close") {
        markers.push({ time, position: "aboveBar", color: "#d4544a", shape: "arrowDown", text: a.toUpperCase() });
      } else if (a === "card" && (p.status || p.card) && price) {
        markers.push({ time, position: "aboveBar", color: "#c9a227", shape: "square", text: String(p.status || p.card).toUpperCase() });
      } else if (typeof price === "number") {
        markers.push({ time, position: "inBar", color: "#4aa3d4", shape: "circle", text: px(price) });
      }
    }
    /* pin lottery ticket on the tape window start */
    const tape = placeholderTape();
    if (tape.length) {
      markers.unshift({
        time: tape[0].time, position: "belowBar", color: "#3dba7a",
        shape: "arrowUp", text: "102034139  4043.95",
      });
      markers.push({
        time: tape[tape.length - 1].time, position: "aboveBar", color: "#c9a227",
        shape: "square", text: "WAIT 4400.90",
      });
    }
    markers.sort((a, b) => a.time - b.time);
    try { state.series.setMarkers(markers); } catch (e) {}
  }

  /* ---------- ingest ---------- */
  function ingest(list) {
    if (!Array.isArray(list)) return;
    const next = [];
    const keys = new Set();
    for (const raw of list) {
      const e = normalize(raw);
      if (!e) continue;
      const k = evKey(e);
      if (keys.has(k)) continue;
      keys.add(k);
      if (state.seen.size && !state.seen.has(k)) state.fresh.add(k);
      next.push(e);
    }
    next.forEach((e) => state.seen.add(evKey(e)));
    state.events = next;
    setTimeout(() => state.fresh.clear(), 1800);
  }

  function normalize(raw) {
    if (!raw || typeof raw !== "object") return null;
    /* already bus-shaped */
    if (raw.agent && raw.action && (raw.ts || raw.ts_et)) {
      const agent = String(raw.agent).toUpperCase();
      return {
        ts: raw.ts || raw.ts_et,
        agent: agent === "MICRO" ? "MICRO" : agent === "FVG" ? "FVG" : "MACRO",
        action: raw.action,
        symbol: raw.symbol || "XAUUSD",
        tf: raw.tf || (raw.payload && raw.payload.htf_box && raw.payload.htf_box.tf) || "",
        payload: raw.payload || {},
      };
    }
    /* raw MICRO card */
    if (raw.card && (raw.agent === "micro" || raw.htf_box || raw.ts_et)) {
      return {
        ts: raw.ts_et || raw.ts,
        agent: "MICRO",
        action: "card",
        symbol: raw.symbol || "XAUUSD",
        tf: (raw.htf_box && raw.htf_box.tf) || raw.hunt_tf || "M30",
        payload: {
          card: raw.card, spot: raw.spot, macro_impulse: raw.macro_impulse,
          htf_box: raw.htf_box, ltf_nest: raw.ltf_nest, hunt_tf: raw.hunt_tf,
          entry: raw.entry, sl: raw.sl, risk_usd: raw.risk_usd, lots: raw.lots,
          reason: raw.reason, refuse: raw.refuse, picture: raw.picture,
          tickets_do_not_touch: raw.tickets_do_not_touch, quiet: raw.quiet,
        },
      };
    }
    return null;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function renderAll() {
    renderPL();
    renderAgents();
    renderZones();
    renderFVG();
    renderBook();
    renderStory();
    renderPictures();
    renderFeed();
    applyLinesAndMarkers();
  }

  async function loadJSON(url) {
    const r = await fetch(url + "?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error(url + " " + r.status);
    return r.json();
  }

  async function poll() {
    try {
      const evs = await loadJSON("events.json");
      ingest(evs);
      renderAll();
    } catch (err) {
      $("live-dot").innerHTML = '<span class="pulse"></span>POLL FAIL · ' + esc(err.message);
    }
  }

  async function boot() {
    tickClock();
    setInterval(tickClock, 1000);
    try { state.book = await loadJSON("book.json"); } catch (e) { state.book = { account: "5217539", balance: 5355.93, equity: 6960.88, floating_pl: 1604.95, closed_pl: 11828.93, margin: 202.20, free_margin: 6758.68, risk_usd_new_fills: 160.68, open: [{ ticket: "102034139", side: "buy", lots: 0.05, entry: 4043.95, sl: 4050, state: "lottery_ticket", started_lots: 0.1, agent: "MACRO" }] }; }
    ensureChart();
    await poll();
    setInterval(poll, POLL_MS);
  }

  boot();
})();
