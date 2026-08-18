const LIVE_BASE = "https://geek-talk-incidents-organizer.trycloudflare.com";
const GOLD_URL = "https://api.gold-api.com/price/XAU";
const LOTTERY_ID = "102034139";
const LOTTERY_FB = { tag: "LOTTERY", lots: 0.05, open: 4043.95, sl: 4050 };
const LVL = {
  lotOpen: 4043.95,
  lotSl: 4050,
  lateMid: 4164.99,
  d1Lo: 4224,
  d1Hi: 4304,
  d1Mid: 4264,
  fvgLo: 4407,
  fvgHi: 4414,
  fvgMid: 4410.5,
  supLo: 4424,
  supHi: 4446,
  supMid: 4435,
};
const FOMC_ET = "2026-08-19T14:00:00-04:00";
const TAPE_N = 180;

let book = null;
let goldPx = null;
let liveOk = false;
let lastEvents = [];
let liveFvg = null;
let liveSupply = null;
let newsCard = null;
let prices = [];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function isSell(type) {
  return String(type || "").toLowerCase() === "sell";
}
function posPl(lots, price, open, type) {
  if (!Number.isFinite(lots) || !Number.isFinite(price) || !Number.isFinite(open)) return null;
  const delta = isSell(type) ? (open - price) : (price - open);
  return lots * 100 * delta;
}
function buyPl(lots, price, open, type) {
  return posPl(lots, price, open, type);
}
function fmtMoney(n) {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : n > 0 ? "+" : "";
  return sign + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPx(n) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtAsof(s) {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(s);
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }) + " ET";
}
function liveBid() {
  if (book && Number.isFinite(book.bid)) return book.bid;
  if (Number.isFinite(goldPx)) return goldPx;
  return null;
}
function $(id) { return document.getElementById(id); }

async function getJSON(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(function () { ctrl.abort(); }, ms || 4500);
  try {
    const r = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

function readFvg(p) {
  if (!p || typeof p !== "object") return null;
  const n = p.fvg && typeof p.fvg === "object" ? p.fvg : {};
  const low = num(p.gap_low != null ? p.gap_low : (n.fvg_low != null ? n.fvg_low : (n.low != null ? n.low : n.lo)));
  const high = num(p.gap_high != null ? p.gap_high : (n.fvg_high != null ? n.fvg_high : (n.high != null ? n.high : n.hi)));
  const mid = num(p.gap_mid != null ? p.gap_mid : (n.fvg_mid != null ? n.fvg_mid : n.mid));
  const unused = p.fill_state === "unused" || n.unused === true;
  if (low == null && high == null && mid == null) return null;
  return {
    low: low,
    high: high,
    mid: mid != null ? mid : (low != null && high != null ? (low + high) / 2 : null),
    unused: unused,
  };
}

function parseDeskEvents(list) {
  lastEvents = Array.isArray(list) ? list : [];
  liveFvg = null;
  liveSupply = null;
  newsCard = null;
  for (let i = lastEvents.length - 1; i >= 0; i -= 1) {
    const ev = lastEvents[i];
    const p = ev && ev.payload ? ev.payload : {};
    if (!newsCard && (((ev.action || "").toLowerCase() === "news") || (ev.agent || "").toUpperCase() === "NEWS" || p.kind === "NEWS")) {
      newsCard = ev;
    }
    if (!liveFvg) {
      const g = readFvg(p);
      if (g && g.unused && g.mid != null && g.mid >= 4395) liveFvg = g;
    }
    if (!liveSupply && Array.isArray(p.supply) && p.supply.length >= 2) {
      const a = num(p.supply[0]);
      const b = num(p.supply[1]);
      if (a != null && b != null) liveSupply = { lo: Math.min(a, b), hi: Math.max(a, b), mid: (a + b) / 2 };
    }
  }
}

function ticketFromLive(p) {
  const isLot = String(p.ticket) === LOTTERY_ID;
  const side = isSell(p.type) ? "SHORT" : "LONG";
  return {
    present: true,
    ticket: p.ticket,
    tag: isLot ? "LOTTERY" : side,
    lots: num(p.lots),
    open: num(p.open),
    sl: num(p.sl),
    profit: num(p.profit),
    type: p.type,
  };
}

function liveTickets() {
  const list = book && Array.isArray(book.positions) ? book.positions : null;
  if (!list) {
    return [];
  }
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const p = list[i];
    if (!p) continue;
    out.push(ticketFromLive(p));
  }
  return out;
}

function lotteryOf(tickets) {
  for (let i = 0; i < tickets.length; i += 1) {
    if (tickets[i].tag === "LOTTERY") return tickets[i];
  }
  return null;
}
function addsOf(tickets) {
  return tickets.filter(function (t) { return t.tag !== "LOTTERY"; });
}

function addSlPx(adds) {
  const sls = [];
  for (let i = 0; i < adds.length; i += 1) {
    if (Number.isFinite(adds[i].sl)) sls.push(adds[i].sl);
  }
  if (!sls.length) return null;
  return sls[0];
}

function addPlAt(adds, px) {
  let sum = 0;
  let any = false;
  for (let i = 0; i < adds.length; i += 1) {
    const n = posPl(adds[i].lots, px, adds[i].open, adds[i].type);
    if (n != null) {
      sum += n;
      any = true;
    }
  }
  return any ? sum : null;
}

function fvgBand() {
  if (liveFvg && liveFvg.mid != null) {
    return {
      lo: liveFvg.low != null ? liveFvg.low : LVL.fvgLo,
      hi: liveFvg.high != null ? liveFvg.high : LVL.fvgHi,
      mid: liveFvg.mid,
    };
  }
  return { lo: LVL.fvgLo, hi: LVL.fvgHi, mid: LVL.fvgMid };
}

function supplyBand() {
  if (liveSupply) return liveSupply;
  return { lo: LVL.supLo, hi: LVL.supHi, mid: LVL.supMid };
}

function nowProfit(pos, bid) {
  if (!pos) return null;
  if (pos.present && pos.profit != null) return pos.profit;
  if (pos.present || pos.awaiting) return posPl(pos.lots, bid, pos.open, pos.type);
  return null;
}

function fomcWhen() {
  if (newsCard && newsCard.payload && Array.isArray(newsCard.payload.events)) {
    const hit = newsCard.payload.events.find(function (e) { return /FOMC/i.test((e && e.event) || ""); });
    if (hit && hit.when_et) {
      const d = new Date(hit.when_et);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  if (newsCard && newsCard.payload && /FOMC/i.test(String(newsCard.payload.event || ""))) {
    const d = new Date(newsCard.payload.when_et);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date(FOMC_ET);
}

function fmtCountdown(when) {
  const ms = when.getTime() - Date.now();
  if (!Number.isFinite(ms)) return "—";
  if (ms <= 0) return "now";
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return d + "d " + (h % 24) + "h " + (m % 60) + "m";
  return h + "h " + (m % 60) + "m";
}

function newsHold() {
  const p = newsCard && newsCard.payload ? newsCard.payload : {};
  if (p.event && /HORMUZ|OIL/i.test(String(p.event))) return String(p.event).replace(/_/g, " ") + " HOLD";
  if (p.book_effect === "hold" && p.event) return String(p.event).replace(/_/g, " ") + " HOLD";
  if (p.headline && /hormuz/i.test(p.headline)) return "HORMUZ HOLD";
  return "HORMUZ HOLD";
}

function ingestPrice(px) {
  if (!Number.isFinite(px) || px <= 0) return;
  prices.push(px);
  if (prices.length > TAPE_N) prices.shift();
}

function drawTape() {
  const cv = $("tape-cv");
  if (!cv) return;
  const wrap = cv.parentElement;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, wrap.clientWidth);
  const h = Math.max(1, wrap.clientHeight);
  if (cv.width !== Math.floor(w * dpr) || cv.height !== Math.floor(h * dpr)) {
    cv.width = Math.floor(w * dpr);
    cv.height = Math.floor(h * dpr);
  }
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const bid = liveBid();
  const lab = $("tape-lab");
  if (lab) lab.textContent = Number.isFinite(bid) ? fmtPx(bid) : "";
  if (!prices.length) return;
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < prices.length; i += 1) {
    mn = Math.min(mn, prices[i]);
    mx = Math.max(mx, prices[i]);
  }
  const span = Math.max(0.4, mx - mn);
  const pad = 6;
  ctx.beginPath();
  for (let i = 0; i < prices.length; i += 1) {
    const x = (i / Math.max(1, TAPE_N - 1)) * (w - 2);
    const y = pad + (1 - (prices[i] - mn) / span) * (h - pad * 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "#c9a227";
  ctx.lineWidth = 1.1;
  ctx.stroke();
  const last = prices[prices.length - 1];
  const lx = ((prices.length - 1) / Math.max(1, TAPE_N - 1)) * (w - 2);
  const ly = pad + (1 - (last - mn) / span) * (h - pad * 2);
  ctx.beginPath();
  ctx.arc(lx, ly, 2.4, 0, Math.PI * 2);
  ctx.fillStyle = "#7ec8c8";
  ctx.fill();
  if (Number.isFinite(bid)) {
    const by = pad + (1 - (bid - mn) / span) * (h - pad * 2);
    ctx.beginPath();
    ctx.setLineDash([3, 3]);
    ctx.moveTo(0, by);
    ctx.lineTo(w, by);
    ctx.strokeStyle = "rgba(126,200,200,.45)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function namedLevels(bid, fvg, sup, addSl) {
  const tiles = [
    { key: "sl", px: LVL.lotSl, label: "4050", sub: "SL LOCKED", who: "LOT", kind: "point" },
    { key: "open", px: LVL.lotOpen, label: fmtPx(LVL.lotOpen), sub: "LOT OPEN", who: "LOT", kind: "point" },
    { key: "late", px: LVL.lateMid, label: fmtPx(LVL.lateMid), sub: "LATE CHASE", who: "LOT", kind: "point" },
    { key: "d1", px: LVL.d1Mid, label: "4224–4304", sub: "D1 50% 4264", who: "LOT", kind: "band", lo: LVL.d1Lo, hi: LVL.d1Hi },
  ];
  if (Number.isFinite(addSl)) {
    tiles.push({ key: "asl", px: addSl, label: fmtPx(addSl), sub: "ADD SL", who: "ADD", kind: "point" });
  }
  tiles.push(
    { key: "bid", px: bid, label: Number.isFinite(bid) ? fmtPx(bid) : "—", sub: "LIVE BID", who: "BOTH", kind: "live" },
    { key: "fvg", px: fvg.mid, label: fmtPx(fvg.lo) + "–" + fmtPx(fvg.hi), sub: "FVG", who: "ADD", kind: "band", lo: fvg.lo, hi: fvg.hi },
    { key: "sup", px: sup.mid, label: fmtPx(sup.lo) + "–" + fmtPx(sup.hi), sub: "SUPPLY", who: "ADD", kind: "band", lo: sup.lo, hi: sup.hi }
  );
  return tiles;
}

function tileState(px, bid) {
  if (!Number.isFinite(px) || !Number.isFinite(bid)) return "dim";
  if (Math.abs(px - bid) < 0.08) return "at";
  return px < bid ? "below" : "above";
}

function impliedFor(who, lot, adds, px, bid) {
  if (who === "LOT") return lot ? buyPl(lot.lots, px, lot.open) : null;
  if (who === "ADD") return addPlAt(adds, px);
  const a = nowProfit(lot, bid);
  const b = addPlNow(adds, bid);
  if (a == null && b == null) return null;
  return (a || 0) + (b || 0);
}

function addPlNow(adds, bid) {
  let sum = 0;
  let any = false;
  for (let i = 0; i < adds.length; i += 1) {
    const n = nowProfit(adds[i], bid);
    if (n != null) {
      sum += n;
      any = true;
    }
  }
  return any ? sum : null;
}

function fillLevels(lot, adds, bid, fvg, sup, addSl) {
  const el = $("levelGrid");
  if (!el) return;
  const tiles = namedLevels(bid, fvg, sup, addSl);
  el.innerHTML = tiles.map(function (t) {
    const st = t.kind === "live" ? "at" : tileState(t.px, bid);
    const dollars = t.kind === "live"
      ? impliedFor("BOTH", lot, adds, bid, bid)
      : impliedFor(t.who, lot, adds, t.px, bid);
    return "<div class=\"tile " + st + "\"><div class=\"tk\">" + esc(t.sub) + "</div><div class=\"tv\">" + esc(t.label) + "</div><div class=\"td\">" + esc(t.who + "  " + fmtMoney(dollars)) + "</div></div>";
  }).join("");
}

function drawPath(lot, adds, bid, fvg, sup, addSl) {
  const el = $("pathSvg");
  if (!el) return;
  const marks = [
    { px: LVL.lateMid, label: "4165 LATE" },
    { px: LVL.d1Mid, label: "4264 D1", lo: LVL.d1Lo, hi: LVL.d1Hi },
    { px: fvg.mid, label: "FVG", lo: fvg.lo, hi: fvg.hi },
    { px: sup.mid, label: "SUP", lo: sup.lo, hi: sup.hi },
  ];
  if (lot) {
    marks.push({ px: LVL.lotSl, label: "4050 SL" });
    marks.push({ px: LVL.lotOpen, label: "4044" });
  }
  if (Number.isFinite(addSl)) marks.push({ px: addSl, label: fmtPx(addSl) + " SL" });
  if (Number.isFinite(bid)) marks.push({ px: bid, label: fmtPx(bid), live: true });
  const xs = marks.map(function (m) { return m.px; }).concat([fvg.lo, fvg.hi, LVL.d1Lo, LVL.d1Hi, sup.lo, sup.hi]);
  let lo = Math.min.apply(null, xs.filter(Number.isFinite));
  let hi = Math.max.apply(null, xs.filter(Number.isFinite));
  const pad = Math.max(6, (hi - lo) * 0.03);
  lo -= pad; hi += pad;
  function xOf(px) { return 18 + ((px - lo) / (hi - lo)) * 964; }
  function curve(x0, y0, x1, y1, lift) {
    const mid = (x0 + x1) / 2;
    return "M" + x0.toFixed(1) + " " + y0 + " C " + mid.toFixed(1) + " " + (y0 + lift) + ", " + mid.toFixed(1) + " " + (y1 - lift) + ", " + x1.toFixed(1) + " " + y1;
  }
  let svg = "<svg viewBox=\"0 0 1000 168\" preserveAspectRatio=\"none\" aria-hidden=\"true\">";
  svg += "<line x1=\"18\" y1=\"84\" x2=\"982\" y2=\"84\" stroke=\"#6a5420\" stroke-width=\"1\" />";
  marks.forEach(function (m) {
    if (m.lo != null && m.hi != null) {
      const x1 = xOf(m.lo);
      const x2 = xOf(m.hi);
      svg += "<rect x=\"" + x1.toFixed(1) + "\" y=\"78\" width=\"" + Math.max(2, x2 - x1).toFixed(1) + "\" height=\"12\" fill=\"rgba(201,162,39,0.16)\" />";
    }
  });
  marks.forEach(function (m) {
    if (m.live) return;
    const x = xOf(m.px);
    svg += "<line x1=\"" + x.toFixed(1) + "\" y1=\"74\" x2=\"" + x.toFixed(1) + "\" y2=\"94\" stroke=\"#c9a227\" stroke-width=\"1\" />";
    svg += "<text x=\"" + x.toFixed(1) + "\" y=\"108\" text-anchor=\"middle\" fill=\"#6a5420\" font-size=\"9\" font-family=\"ui-monospace,SFMono-Regular,Menlo,monospace\">" + esc(m.label) + "</text>";
  });
  if (Number.isFinite(bid)) {
    const xb = xOf(bid);
    svg += "<line x1=\"" + xb.toFixed(1) + "\" y1=\"18\" x2=\"" + xb.toFixed(1) + "\" y2=\"150\" stroke=\"#7ec8c8\" stroke-width=\"1.4\" />";
    svg += "<circle cx=\"" + xb.toFixed(1) + "\" cy=\"42\" r=\"3.2\" fill=\"#7ec8c8\" />";
    svg += "<circle cx=\"" + xb.toFixed(1) + "\" cy=\"126\" r=\"3.2\" fill=\"#7ec8c8\" />";
    svg += "<text x=\"" + (xb + 6).toFixed(1) + "\" y=\"18\" fill=\"#7ec8c8\" font-size=\"9\" font-family=\"ui-monospace,SFMono-Regular,Menlo,monospace\">" + esc(fmtPx(bid)) + "</text>";
    if (lot) {
      const lotT = [
        { px: LVL.d1Mid, y: 28, lab: fmtMoney(buyPl(lot.lots, LVL.d1Mid, lot.open)), lift: -18 },
        { px: LVL.lateMid, y: 56, lab: fmtMoney(buyPl(lot.lots, LVL.lateMid, lot.open)), lift: 16 },
        { px: LVL.lotSl, y: 30, lab: fmtMoney(buyPl(lot.lots, LVL.lotSl, lot.open)), lift: -22 },
      ];
      lotT.forEach(function (t) {
        const xt = xOf(t.px);
        svg += "<path d=\"" + curve(xb, 42, xt, t.y, t.lift) + "\" fill=\"none\" stroke=\"#7ec8c8\" stroke-width=\"1.15\" />";
        svg += "<text x=\"" + xt.toFixed(1) + "\" y=\"" + (t.y - 5) + "\" text-anchor=\"middle\" fill=\"#7ec8c8\" font-size=\"9\" font-family=\"ui-monospace,SFMono-Regular,Menlo,monospace\">" + esc(t.lab) + "</text>";
      });
    }
    if (adds.length) {
      const addT = [];
      if (Number.isFinite(addSl)) {
        addT.push({ px: addSl, y: 150, lab: fmtMoney(addPlAt(adds, addSl)), lift: -10 });
      }
      if (Number.isFinite(fvg.mid) && fvg.mid > bid) {
        addT.push({ px: fvg.mid, y: 142, lab: fmtMoney(addPlAt(adds, fvg.mid)), lift: 16 });
      }
      if (Number.isFinite(sup.mid) && sup.mid > bid) {
        addT.push({ px: sup.mid, y: 158, lab: fmtMoney(addPlAt(adds, sup.mid)), lift: 22 });
      }
      addT.forEach(function (t) {
        const xt = xOf(t.px);
        svg += "<path d=\"" + curve(xb, 126, xt, t.y, t.lift) + "\" fill=\"none\" stroke=\"#7ec8c8\" stroke-width=\"1.15\" />";
        svg += "<text x=\"" + xt.toFixed(1) + "\" y=\"" + (t.y + 10) + "\" text-anchor=\"middle\" fill=\"#7ec8c8\" font-size=\"9\" font-family=\"ui-monospace,SFMono-Regular,Menlo,monospace\">" + esc(t.lab) + "</text>";
      });
    }
  }
  svg += "</svg>";
  el.innerHTML = svg;
}

function fillBook(tickets, bid) {
  const profits = tickets.map(function (t) { return nowProfit(t, bid); });
  let fl = book && num(book.floating_pl);
  if (fl == null) {
    fl = null;
    for (let i = 0; i < profits.length; i += 1) {
      if (profits[i] == null) continue;
      fl = (fl == null ? 0 : fl) + profits[i];
    }
  }
  const eq = book && num(book.equity);
  const bal = book && num(book.balance);
  const floatEl = $("float");
  if (floatEl) {
    floatEl.textContent = fmtMoney(fl);
    floatEl.className = "huge" + (fl != null && fl < 0 ? " down" : "");
  }
  if ($("eq")) $("eq").textContent = fmtMoney(eq);
  if ($("bal")) $("bal").textContent = fmtMoney(bal);
  const bars = $("bars");
  if (!bars) return;
  const abs = profits.map(function (n) { return Math.abs(n || 0); });
  let tot = 0;
  for (let i = 0; i < abs.length; i += 1) tot += abs[i];
  bars.innerHTML = tickets.map(function (t, i) {
    const pct = tot > 0 ? (abs[i] / tot) * 100 : 0;
    const side = t.tag === "SHORT" ? "SHORT" : (t.tag === "LOTTERY" ? "LOTTERY" : "LONG");
    const lab = t.tag === "LOTTERY"
      ? "LOTTERY"
      : (side + " #" + t.ticket + "  " + (Number.isFinite(t.lots) ? String(t.lots) : "—") + "  SL " + fmtPx(t.sl));
    const cls = t.tag === "LOTTERY" ? "lot" : (t.tag === "SHORT" ? "short" : "add");
    return "<div class=\"bar-row\"><div class=\"bar-lab\"><span>" + esc(lab) + "</span><b>" + esc(fmtMoney(profits[i]) + "  " + pct.toFixed(0) + "%") + "</b></div><div class=\"track\"><i class=\"" + cls + "\" style=\"width:" + pct.toFixed(1) + "%\"></i></div></div>";
  }).join("");
}

function fillHeader(bid) {
  if ($("acct")) $("acct").textContent = book && book.login ? String(book.login) : "5217539";
  const live = $("live");
  if (live) {
    live.textContent = liveOk ? "LIVE" : "STALE";
    live.className = "pill " + (liveOk ? "live" : "stale");
  }
  if ($("hold")) $("hold").textContent = newsHold();
  if ($("bidlab")) $("bidlab").textContent = fmtPx(bid);
  if ($("asof")) $("asof").textContent = book && book.asof ? fmtAsof(book.asof) : "—";
}

function fillKpis(lot, adds, addSl) {
  const el = $("kpis");
  if (!el) return;
  const lotPer = lot && Number.isFinite(lot.lots) ? lot.lots * 100 : null;
  let addLots = 0;
  let addAny = false;
  let eachPer = null;
  let sameLots = true;
  for (let i = 0; i < adds.length; i += 1) {
    if (!Number.isFinite(adds[i].lots)) continue;
    addAny = true;
    addLots += adds[i].lots;
    const p = adds[i].lots * 100;
    if (eachPer == null) eachPer = p;
    else if (p !== eachPer) sameLots = false;
  }
  const addPer = addAny ? addLots * 100 : null;
  const floor = lot ? buyPl(lot.lots, lot.sl, lot.open) : null;
  const addStop = Number.isFinite(addSl) ? addPlAt(adds, addSl) : null;
  let addSub = "none";
  if (adds.length) {
    const eachTxt = eachPer != null && sameLots ? ("  $" + eachPer.toFixed(0) + "/$1 each") : "";
    addSub = adds.length + "×" + (sameLots && adds[0] && Number.isFinite(adds[0].lots) ? String(adds[0].lots) : "") + " lot" + eachTxt;
  }
  const cells = [
    { k: "LOTTERY", v: lotPer != null ? ("$" + lotPer.toFixed(0) + "/$1") : "—", s: lot ? ("#" + lot.ticket + "  " + (Number.isFinite(lot.lots) ? lot.lots : "—") + " lot") : "flat" },
    { k: "ADD", v: addPer != null ? ("$" + addPer.toFixed(0) + "/$1") : "—", s: addSub },
    { k: "LEFT RISK", v: adds.length ? fmtMoney(addStop) : "$0", s: adds.length ? ("SL  " + fmtPx(addSl)) : "flat" },
    { k: "LOCKED FLOOR", v: fmtMoney(floor), s: "lottery SL 4050" },
    { k: "FOMC MINUTES", v: fmtCountdown(fomcWhen()), s: "Wed 19 Aug 2:00 PM ET" },
  ];
  el.innerHTML = cells.map(function (c) {
    return "<div class=\"cell\"><div class=\"k\">" + esc(c.k) + "</div><div class=\"kv\">" + esc(c.v) + "</div><div class=\"ks\">" + esc(c.s) + "</div></div>";
  }).join("");
}

function fillMatrix(lot, adds, bid, fvg, sup, addSl) {
  const el = $("matGrid");
  if (!el) return;
  const cols = [
    { k: "SL", px: LVL.lotSl, hide: false },
    { k: "OPEN", px: LVL.lotOpen, hide: true },
    { k: "LATE", px: LVL.lateMid, hide: true },
    { k: "D1", px: LVL.d1Mid, hide: false },
    { k: Number.isFinite(addSl) ? String(Math.round(addSl)) : "STOP", px: addSl, hide: false },
    { k: "BID", px: bid, hide: false },
    { k: "FVG", px: fvg.mid, hide: false },
    { k: "SUP", px: sup.mid, hide: false },
  ];
  function cell(n, hide) {
    const cls = !Number.isFinite(n) ? "z" : (n > 0.005 ? "up" : (n < -0.005 ? "dn" : "z"));
    return "<div class=\"mcell " + cls + (hide ? " hide-sm" : "") + "\">" + esc(fmtMoney(n)) + "</div>";
  }
  function row(label, pos) {
    let html = "<div class=\"mrow\"><div class=\"mcell\">" + esc(label) + "</div>";
    cols.forEach(function (c) {
      html += cell(pos ? posPl(pos.lots, c.px, pos.open, pos.type) : null, c.hide);
    });
    html += "</div>";
    return html;
  }
  let html = "<div class=\"mrow head\"><div class=\"mcell\"></div>";
  cols.forEach(function (c) {
    html += "<div class=\"mcell" + (c.hide ? " hide-sm" : "") + "\">" + esc(c.k) + "</div>";
  });
  html += "</div>";
  if (lot) html += row("LOT", lot);
  adds.forEach(function (a) {
    const short = "#" + String(a.ticket).slice(-3);
    html += row(short, a);
  });
  el.innerHTML = html;
}

function drawFlow(lot, adds, bid, fvg, addSl) {
  const el = $("flowSvg");
  if (!el) return;
  const lotNow = nowProfit(lot, bid);
  const lotFvg = lot ? buyPl(lot.lots, fvg.mid, lot.open) : null;
  const addFvg = addPlAt(adds, fvg.mid);
  const bothFvg = (lotFvg == null && addFvg == null) ? null : ((lotFvg || 0) + (addFvg || 0));
  const lotD1 = lot ? buyPl(lot.lots, LVL.d1Mid, lot.open) : null;
  const addStop = Number.isFinite(addSl) ? addPlAt(adds, addSl) : null;
  const branches = [
    { k: adds.length ? ("adds stop @ " + fmtPx(addSl)) : "adds flat", s: "lottery keeps running", v: addStop },
    { k: "both hold to FVG", s: fmtPx(fvg.mid), v: bothFvg },
    { k: "lottery to D1 50%", s: "4264 unused", v: lotD1 },
  ];
  const max = Math.max.apply(null, branches.map(function (b) { return Math.abs(b.v || 0); }).concat([1]));
  let svg = "<svg viewBox=\"0 0 640 130\" preserveAspectRatio=\"none\" aria-hidden=\"true\">";
  svg += "<rect x=\"8\" y=\"48\" width=\"86\" height=\"34\" fill=\"none\" stroke=\"#6a5420\" stroke-width=\"1\" />";
  svg += "<text x=\"51\" y=\"62\" text-anchor=\"middle\" fill=\"#6a5420\" font-size=\"8\" font-family=\"ui-monospace,Menlo,monospace\">NOW</text>";
  const fl = book && num(book.floating_pl);
  svg += "<text x=\"51\" y=\"76\" text-anchor=\"middle\" fill=\"#e8c37a\" font-size=\"10\" font-family=\"ui-monospace,Menlo,monospace\">" + esc(fmtMoney(fl != null ? fl : lotNow)) + "</text>";
  branches.forEach(function (b, i) {
    const y = 18 + i * 40;
    const thick = 2 + (Math.abs(b.v || 0) / max) * 10;
    svg += "<path d=\"M94 65 C 170 " + (65) + ", 210 " + (y + 10) + ", 290 " + (y + 10) + "\" fill=\"none\" stroke=\"#c9a227\" stroke-width=\"" + thick.toFixed(1) + "\" opacity=\"0.85\" />";
    svg += "<text x=\"300\" y=\"" + (y + 6) + "\" fill=\"#6a5420\" font-size=\"9\" font-family=\"ui-monospace,Menlo,monospace\">" + esc(b.k) + "</text>";
    svg += "<text x=\"300\" y=\"" + (y + 18) + "\" fill=\"#e8c37a\" font-size=\"11\" font-family=\"ui-monospace,Menlo,monospace\">" + esc(fmtMoney(b.v)) + "  " + esc(b.s) + "</text>";
  });
  svg += "</svg>";
  el.innerHTML = svg;
}

function eventNote(ev) {
  const p = ev && ev.payload ? ev.payload : {};
  return p.note || p.headline || p.refuse || p.status || p.reason || p.event || ev.action || "";
}

function fillTicker() {
  const el = $("ticker");
  if (!el) return;
  const last = lastEvents.slice(-14).reverse();
  if (!last.length) {
    el.textContent = "awaiting events";
    return;
  }
  const bits = last.map(function (ev) {
    return "<span class=\"bit\"><b>" + esc((ev.agent || "DESK") + " · " + (ev.action || "")) + "</b>  " + esc(String(eventNote(ev)).slice(0, 90)) + "</span>";
  }).join("");
  el.innerHTML = bits + bits;
}

function refresh() {
  const bid = liveBid();
  const tickets = liveTickets();
  const lot = lotteryOf(tickets);
  const adds = addsOf(tickets);
  const addSl = addSlPx(adds);
  const fvg = fvgBand();
  const sup = supplyBand();
  fillHeader(bid);
  fillBook(tickets, bid);
  fillLevels(lot, adds, bid, fvg, sup, addSl);
  drawPath(lot, adds, bid, fvg, sup, addSl);
  fillKpis(lot, adds, addSl);
  fillMatrix(lot, adds, bid, fvg, sup, addSl);
  drawFlow(lot, adds, bid, fvg, addSl);
  fillTicker();
  drawTape();
}

function refreshNewsClock() {
  const cells = document.querySelectorAll("#kpis .cell");
  if (cells.length >= 5) {
    const kv = cells[4].querySelector(".kv");
    if (kv) kv.textContent = fmtCountdown(fomcWhen());
  }
}

async function pollBook() {
  let data = null;
  try {
    data = await getJSON(LIVE_BASE + "/book.json", 4000);
    liveOk = true;
  } catch (err) {
    try {
      data = await getJSON("./book.json", 4000);
      liveOk = false;
    } catch (err2) {
      liveOk = false;
      return;
    }
  }
  if (!data || typeof data !== "object") return;
  book = data;
  if (Number.isFinite(data.bid)) ingestPrice(data.bid);
}

async function pollEvents() {
  let data = null;
  try {
    data = await getJSON(LIVE_BASE + "/events.json", 4000);
  } catch (err) {
    try {
      data = await getJSON("./events.json", 4000);
    } catch (err2) {
      return;
    }
  }
  const list = Array.isArray(data) ? data : (data && (data.events || data.items)) || [];
  parseDeskEvents(list);
}

async function pollGold() {
  try {
    const data = await getJSON(GOLD_URL, 4000);
    const px = data && Number(data.price);
    if (Number.isFinite(px)) {
      goldPx = px;
      ingestPrice(px);
    }
  } catch (err) { /* optional */ }
}

async function pollAll() {
  try {
    await Promise.all([pollBook(), pollEvents(), pollGold()]);
    refresh();
  } catch (err) { /* keep HUD painted */ }
}

try { refresh(); } catch (err) { /* keep HUD painted */ }
pollAll();
setInterval(pollAll, 2000);
setInterval(function () { try { refreshNewsClock(); } catch (err) { /* keep HUD painted */ } }, 1000);
window.addEventListener("resize", function () { try { refresh(); } catch (err) { /* keep HUD painted */ } });
