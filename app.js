const LIVE_BASE = "https://geek-talk-incidents-organizer.trycloudflare.com";
const GOLD_URL = "https://api.gold-api.com/price/XAU";
const FALLBACK = {
  102034139: { tag: "LOTTERY", lots: 0.05, open: 4043.95, sl: 4050 },
  102177113: { tag: "LEFTOVER", lots: 0.03, open: 4389.25, sl: 4389.25 },
};
const LVL = {
  lotOpen: 4043.95,
  lotSl: 4050,
  lateMid: 4164.99,
  d1Lo: 4224,
  d1Hi: 4304,
  d1Mid: 4264,
  leftOpen: 4389.25,
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
function buyPl(lots, price, open) {
  if (!Number.isFinite(lots) || !Number.isFinite(price) || !Number.isFinite(open)) return null;
  return lots * 100 * (price - open);
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

function resolvePos(id) {
  const known = FALLBACK[id];
  const list = book && Array.isArray(book.positions) ? book.positions : null;
  const live = list ? list.find(function (p) { return String(p.ticket) === String(id); }) : null;
  if (live) {
    return {
      present: true,
      ticket: live.ticket,
      lots: num(live.lots) != null ? num(live.lots) : known.lots,
      open: num(live.open) != null ? num(live.open) : known.open,
      sl: num(live.sl) != null ? num(live.sl) : known.sl,
      profit: num(live.profit),
    };
  }
  return { present: false, ticket: id, lots: known.lots, open: known.open, sl: known.sl, profit: null, awaiting: !list };
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
  if (pos.present || pos.awaiting) return buyPl(pos.lots, bid, pos.open);
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

function namedLevels(bid, fvg, sup) {
  return [
    { key: "sl", px: LVL.lotSl, label: "4050", sub: "SL LOCKED", who: "LOT", kind: "point" },
    { key: "open", px: LVL.lotOpen, label: fmtPx(LVL.lotOpen), sub: "LOT OPEN", who: "LOT", kind: "point" },
    { key: "late", px: LVL.lateMid, label: fmtPx(LVL.lateMid), sub: "LATE CHASE", who: "LOT", kind: "point" },
    { key: "d1", px: LVL.d1Mid, label: "4224–4304", sub: "D1 50% 4264", who: "LOT", kind: "band", lo: LVL.d1Lo, hi: LVL.d1Hi },
    { key: "be", px: LVL.leftOpen, label: fmtPx(LVL.leftOpen), sub: "LEFT BE", who: "LEFT", kind: "point" },
    { key: "bid", px: bid, label: Number.isFinite(bid) ? fmtPx(bid) : "—", sub: "LIVE BID", who: "BOTH", kind: "live" },
    { key: "fvg", px: fvg.mid, label: fmtPx(fvg.lo) + "–" + fmtPx(fvg.hi), sub: "FVG", who: "LEFT", kind: "band", lo: fvg.lo, hi: fvg.hi },
    { key: "sup", px: sup.mid, label: fmtPx(sup.lo) + "–" + fmtPx(sup.hi), sub: "SUPPLY", who: "LEFT", kind: "band", lo: sup.lo, hi: sup.hi },
  ];
}

function tileState(px, bid) {
  if (!Number.isFinite(px) || !Number.isFinite(bid)) return "dim";
  if (Math.abs(px - bid) < 0.08) return "at";
  return px < bid ? "below" : "above";
}

function impliedFor(who, lot, left, px, bid) {
  if (who === "LOT") return buyPl(lot.lots, px, lot.open);
  if (who === "LEFT") return buyPl(left.lots, px, left.open);
  const a = nowProfit(lot, bid);
  const b = nowProfit(left, bid);
  if (a == null && b == null) return null;
  return (a || 0) + (b || 0);
}

function fillLevels(lot, left, bid, fvg, sup) {
  const el = $("levelGrid");
  if (!el) return;
  const tiles = namedLevels(bid, fvg, sup);
  el.innerHTML = tiles.map(function (t) {
    const st = t.kind === "live" ? "at" : tileState(t.px, bid);
    const dollars = t.kind === "live"
      ? impliedFor("BOTH", lot, left, bid, bid)
      : impliedFor(t.who, lot, left, t.px, bid);
    return "<div class=\"tile " + st + "\"><div class=\"tk\">" + esc(t.sub) + "</div><div class=\"tv\">" + esc(t.label) + "</div><div class=\"td\">" + esc(t.who + "  " + fmtMoney(dollars)) + "</div></div>";
  }).join("");
}

function drawPath(lot, left, bid, fvg, sup) {
  const el = $("pathSvg");
  if (!el) return;
  const marks = [
    { px: LVL.lotSl, label: "4050 SL" },
    { px: LVL.lotOpen, label: "4044" },
    { px: LVL.lateMid, label: "4165 LATE" },
    { px: LVL.d1Mid, label: "4264 D1", lo: LVL.d1Lo, hi: LVL.d1Hi },
    { px: LVL.leftOpen, label: "4389 BE" },
    { px: fvg.mid, label: "FVG", lo: fvg.lo, hi: fvg.hi },
    { px: sup.mid, label: "SUP", lo: sup.lo, hi: sup.hi },
  ];
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
    const leftT = [
      { px: fvg.mid, y: 142, lab: fmtMoney(buyPl(left.lots, fvg.mid, left.open)), lift: 16 },
      { px: sup.mid, y: 158, lab: fmtMoney(buyPl(left.lots, sup.mid, left.open)), lift: 22 },
      { px: LVL.leftOpen, y: 150, lab: "$0 DIES", lift: -10 },
    ];
    leftT.forEach(function (t) {
      const xt = xOf(t.px);
      svg += "<path d=\"" + curve(xb, 126, xt, t.y, t.lift) + "\" fill=\"none\" stroke=\"#7ec8c8\" stroke-width=\"1.15\" />";
      svg += "<text x=\"" + xt.toFixed(1) + "\" y=\"" + (t.y + 10) + "\" text-anchor=\"middle\" fill=\"#7ec8c8\" font-size=\"9\" font-family=\"ui-monospace,SFMono-Regular,Menlo,monospace\">" + esc(t.lab) + "</text>";
    });
  }
  svg += "</svg>";
  el.innerHTML = svg;
}

function fillBook(lot, left, bid) {
  const lotNow = nowProfit(lot, bid);
  const leftNow = nowProfit(left, bid);
  const fl = book && num(book.floating_pl) != null ? num(book.floating_pl) : ((lotNow != null || leftNow != null) ? (lotNow || 0) + (leftNow || 0) : null);
  const eq = book && num(book.equity);
  const bal = book && num(book.balance);
  const floatEl = $("float");
  if (floatEl) {
    floatEl.textContent = fmtMoney(fl);
    floatEl.className = "huge" + (fl != null && fl < 0 ? " down" : "");
  }
  if ($("eq")) $("eq").textContent = fmtMoney(eq);
  if ($("bal")) $("bal").textContent = fmtMoney(bal);
  const lotAbs = Math.abs(lotNow || 0);
  const leftAbs = Math.abs(leftNow || 0);
  const tot = lotAbs + leftAbs;
  const lotPct = tot > 0 ? (lotAbs / tot) * 100 : 0;
  const leftPct = tot > 0 ? (leftAbs / tot) * 100 : 0;
  if ($("lotShare")) $("lotShare").textContent = fmtMoney(lotNow) + "  " + lotPct.toFixed(0) + "%";
  if ($("leftShare")) $("leftShare").textContent = fmtMoney(leftNow) + "  " + leftPct.toFixed(0) + "%";
  if ($("lotBar")) $("lotBar").style.width = lotPct.toFixed(1) + "%";
  if ($("leftBar")) $("leftBar").style.width = leftPct.toFixed(1) + "%";
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

function fillKpis(lot, left) {
  const el = $("kpis");
  if (!el) return;
  const lotPer = lot.lots * 100;
  const leftPer = left.lots * 100;
  const floor = buyPl(lot.lots, lot.sl, lot.open);
  const cells = [
    { k: "LOTTERY", v: "$" + lotPer.toFixed(0) + "/$1", s: "#" + lot.ticket + "  0.05 lot" },
    { k: "LEFTOVER", v: "$" + leftPer.toFixed(0) + "/$1", s: "#" + left.ticket + "  0.03 lot" },
    { k: "LEFT RISK", v: "$0", s: "BE  " + fmtPx(left.sl) },
    { k: "LOCKED FLOOR", v: fmtMoney(floor), s: "lottery SL 4050" },
    { k: "FOMC MINUTES", v: fmtCountdown(fomcWhen()), s: "Wed 19 Aug 2:00 PM ET" },
  ];
  el.innerHTML = cells.map(function (c) {
    return "<div class=\"cell\"><div class=\"k\">" + esc(c.k) + "</div><div class=\"kv\">" + esc(c.v) + "</div><div class=\"ks\">" + esc(c.s) + "</div></div>";
  }).join("");
}

function fillMatrix(lot, left, bid, fvg, sup) {
  const el = $("matGrid");
  if (!el) return;
  const cols = [
    { k: "SL", px: LVL.lotSl, hide: false },
    { k: "OPEN", px: LVL.lotOpen, hide: true },
    { k: "LATE", px: LVL.lateMid, hide: true },
    { k: "D1", px: LVL.d1Mid, hide: false },
    { k: "BE", px: LVL.leftOpen, hide: false },
    { k: "BID", px: bid, hide: false },
    { k: "FVG", px: fvg.mid, hide: false },
    { k: "SUP", px: sup.mid, hide: false },
  ];
  function cell(n, hide) {
    const cls = !Number.isFinite(n) ? "z" : (n > 0.005 ? "up" : (n < -0.005 ? "dn" : "z"));
    return "<div class=\"mcell " + cls + (hide ? " hide-sm" : "") + "\">" + esc(fmtMoney(n)) + "</div>";
  }
  let html = "<div class=\"mrow head\"><div class=\"mcell\"></div>";
  cols.forEach(function (c) {
    html += "<div class=\"mcell" + (c.hide ? " hide-sm" : "") + "\">" + esc(c.k) + "</div>";
  });
  html += "</div>";
  html += "<div class=\"mrow\"><div class=\"mcell\">LOT</div>";
  cols.forEach(function (c) { html += cell(buyPl(lot.lots, c.px, lot.open), c.hide); });
  html += "</div>";
  html += "<div class=\"mrow\"><div class=\"mcell\">LEFT</div>";
  cols.forEach(function (c) { html += cell(buyPl(left.lots, c.px, left.open), c.hide); });
  html += "</div>";
  el.innerHTML = html;
}

function drawFlow(lot, left, bid, fvg) {
  const el = $("flowSvg");
  if (!el) return;
  const lotNow = nowProfit(lot, bid);
  const lotFvg = buyPl(lot.lots, fvg.mid, lot.open);
  const leftFvg = buyPl(left.lots, fvg.mid, left.open);
  const bothFvg = (lotFvg || 0) + (leftFvg || 0);
  const lotD1 = buyPl(lot.lots, LVL.d1Mid, lot.open);
  const branches = [
    { k: "leftover dies @ BE", s: "lottery keeps running", v: lotNow },
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
  const lot = resolvePos(102034139);
  const left = resolvePos(102177113);
  const fvg = fvgBand();
  const sup = supplyBand();
  fillHeader(bid);
  fillBook(lot, left, bid);
  fillLevels(lot, left, bid, fvg, sup);
  drawPath(lot, left, bid, fvg, sup);
  fillKpis(lot, left);
  fillMatrix(lot, left, bid, fvg, sup);
  drawFlow(lot, left, bid, fvg);
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
  await Promise.all([pollBook(), pollEvents(), pollGold()]);
  refresh();
}

refresh();
pollAll();
setInterval(pollAll, 2000);
setInterval(refreshNewsClock, 1000);
window.addEventListener("resize", function () { refresh(); });
