import * as THREE from "three";

const LIVE_BASE = "https://geek-talk-incidents-organizer.trycloudflare.com";
const GOLD_URL = "https://api.gold-api.com/price/XAU";
const TICKET_META = {
  102034139: { tag: "LOTTERY", sub: "SL 4050" },
  102177113: { tag: "LEFTOVER", sub: "BREAK-EVEN" },
};

const INK = 0x050505;
const GOLD = 0xc9a227;
const VIEW_H = 8.2;
const CAM_Y = 1.35;
const CAM_Z = 22;
const LOOK_Y = 0.55;
const RIBBON_N = 180;
const DUST_N = 360;
const NUDGE_MAX = 1.55;
const ZOOM_MIN = 0.86;
const ZOOM_MAX = 1.18;

const canvas = document.getElementById("stage");
const clock = new THREE.Clock();
const pointer = new THREE.Vector2(-2, -2);
const raycaster = new THREE.Raycaster();

let scene, camera, renderer;
let dust, dustBase, dustShiver = 0;
let ribbon, ribbonPos;
let titleMesh, holoGroup, ticketGroup, eventGroup, hairline;
let pickables = [];
let hover = null;
let selected = null;
let book = null;
let prices = [];
let lastBid = null;
let liveOk = false;
let goldPx = null;
let nudgeX = 0;
let nudgeY = 0;
let zoom = 1;
let drag = null;
let pointerDown = null;

function fmtMoney(n) {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
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

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

async function getJSON(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 4500);
  try {
    const r = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, ctx: c.getContext("2d") };
}

function canvasTexture(c) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function paintCard(ctx, w, h, eyebrow, title, lines, foot, lit) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = lit ? "rgba(14, 12, 6, 0.92)" : "rgba(8, 7, 4, 0.78)";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = lit ? "rgba(232, 195, 122, 0.72)" : "rgba(201, 162, 39, 0.38)";
  ctx.lineWidth = lit ? 2.5 : 1.25;
  ctx.strokeRect(10, 10, w - 20, h - 20);
  ctx.fillStyle = "#6a5420";
  ctx.font = "500 20px ui-monospace, SFMono-Regular, Menlo, monospace";
  if (eyebrow) ctx.fillText(eyebrow, 28, 42);
  ctx.fillStyle = "#e8c37a";
  ctx.font = "600 44px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(title || "—", 28, 96);
  ctx.fillStyle = "#c9a227";
  ctx.font = "500 20px ui-monospace, SFMono-Regular, Menlo, monospace";
  (lines || []).forEach((line, i) => {
    if (line) ctx.fillText(line, 28, 132 + i * 26);
  });
  ctx.fillStyle = "#6a5420";
  ctx.font = "500 16px ui-monospace, SFMono-Regular, Menlo, monospace";
  if (foot) ctx.fillText(foot, 28, h - 28);
}

function makePlane(w, h, cw, ch, kind) {
  const { c, ctx } = makeCanvas(cw, ch);
  paintCard(ctx, cw, ch, "", "—", [], "", false);
  const tex = canvasTexture(c);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0.94,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.userData = { ctx, canvas: c, tex, kind, w, h };
  return mesh;
}

function setCard(mesh, eyebrow, title, lines, foot, lit) {
  const { ctx, canvas, tex } = mesh.userData;
  paintCard(ctx, canvas.width, canvas.height, eyebrow, title, lines, foot, lit);
  tex.needsUpdate = true;
}

function makeGlow(w, h) {
  const mat = new THREE.MeshBasicMaterial({
    color: GOLD,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.08, h * 1.14), mat);
  glow.position.z = -0.04;
  glow.userData.kind = "glow";
  return glow;
}

function applyCamera() {
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  const hh = VIEW_H / zoom;
  const hw = hh * aspect;
  camera.left = -hw;
  camera.right = hw;
  camera.top = hh;
  camera.bottom = -hh;
  camera.position.set(nudgeX, CAM_Y + nudgeY, CAM_Z);
  camera.lookAt(nudgeX * 0.38, LOOK_Y + nudgeY * 0.42, 0);
  camera.updateProjectionMatrix();
}

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  applyCamera();
}

function resetView() {
  nudgeX = 0;
  nudgeY = 0;
  zoom = 1;
  applyCamera();
}

function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(INK);

  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 80);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  scene.add(new THREE.AmbientLight(0x2a2414, 0.55));

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(48, 22),
    new THREE.MeshBasicMaterial({
      color: 0x0a0804,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -5.15, 0.4);
  scene.add(floor);

  hairline = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 0.012),
    new THREE.MeshBasicMaterial({
      color: GOLD,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    }),
  );
  hairline.position.set(0, 3.18, -0.2);
  scene.add(hairline);

  applyCamera();
  resize();
}

function initDust() {
  const geo = new THREE.BufferGeometry();
  dustBase = new Float32Array(DUST_N * 3);
  const col = new Float32Array(DUST_N * 3);
  for (let i = 0; i < DUST_N; i += 1) {
    const i3 = i * 3;
    dustBase[i3] = (Math.random() - 0.5) * 28;
    dustBase[i3 + 1] = -4.6 + Math.random() * 12.2;
    dustBase[i3 + 2] = -1.4 + Math.random() * 2.6;
    const g = 0.58 + Math.random() * 0.4;
    col[i3] = g;
    col[i3 + 1] = 0.46 + Math.random() * 0.24;
    col[i3 + 2] = 0.12 + Math.random() * 0.1;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(dustBase.slice(), 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  dust = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      size: 0.035,
      vertexColors: true,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    }),
  );
  scene.add(dust);
}

function initRibbon() {
  const geo = new THREE.BufferGeometry();
  ribbonPos = new Float32Array(RIBBON_N * 2 * 3);
  const col = new Float32Array(RIBBON_N * 2 * 3);
  const idx = [];
  for (let i = 0; i < RIBBON_N; i += 1) {
    const x = -12.4 + (i / (RIBBON_N - 1)) * 24.8;
    for (let row = 0; row < 2; row += 1) {
      const o = (i * 2 + row) * 3;
      ribbonPos[o] = x;
      ribbonPos[o + 1] = 2.55;
      ribbonPos[o + 2] = -0.08 + (row ? 0.015 : -0.015);
      const k = i / (RIBBON_N - 1);
      col[o] = 0.52 + k * 0.42;
      col[o + 1] = 0.36 + k * 0.26;
      col[o + 2] = 0.08 + k * 0.07;
    }
    if (i < RIBBON_N - 1) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  geo.setAttribute("position", new THREE.BufferAttribute(ribbonPos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  ribbon = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  scene.add(ribbon);
}

function ingestPrice(px) {
  if (!Number.isFinite(px) || px <= 0) return;
  const prev = prices.length ? prices[prices.length - 1] : null;
  prices.push(px);
  if (prices.length > RIBBON_N) prices.shift();
  if (prev != null && Math.abs(px - prev) > 0.01) {
    dustShiver = Math.min(0.7, dustShiver + 0.22);
  }
}

function updateRibbon() {
  if (!prices.length) return;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < prices.length; i += 1) {
    min = Math.min(min, prices[i]);
    max = Math.max(max, prices[i]);
  }
  const span = Math.max(0.8, max - min);
  const n = prices.length;
  for (let i = 0; i < RIBBON_N; i += 1) {
    const src = i < RIBBON_N - n ? prices[0] : prices[i - (RIBBON_N - n)];
    const y = 2.38 + ((src - min) / span) * 0.58;
    const x = -12.4 + (i / (RIBBON_N - 1)) * 24.8;
    for (let row = 0; row < 2; row += 1) {
      const o = (i * 2 + row) * 3;
      ribbonPos[o] = x;
      ribbonPos[o + 1] = y + (row ? 0.035 : -0.035);
      ribbonPos[o + 2] = -0.06;
    }
  }
  ribbon.geometry.attributes.position.needsUpdate = true;
}

function initHolos() {
  const { c, ctx } = makeCanvas(1400, 220);
  ctx.clearRect(0, 0, 1400, 220);
  ctx.fillStyle = "#e8c37a";
  ctx.font = "500 64px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("XAUUSD DESK", 48, 88);
  ctx.fillStyle = "#6a5420";
  ctx.font = "500 26px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("5217539   ·   COINEXX DEMO   ·   GOLD ONLY", 48, 150);
  const tex = canvasTexture(c);
  titleMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(13.6, 2.1),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.96, depthWrite: false }),
  );
  titleMesh.position.set(0, 6.55, -0.35);
  titleMesh.rotation.x = -0.06;
  scene.add(titleMesh);

  holoGroup = new THREE.Group();
  ["equity", "float", "bid", "asof"].forEach((key, i) => {
    const mesh = makePlane(5.15, 2.05, 512, 256, "holo");
    const glow = makeGlow(5.15, 2.05);
    const g = new THREE.Group();
    g.add(glow);
    g.add(mesh);
    g.position.set(-8.55 + i * 5.7, 4.55, -0.18);
    g.rotation.x = -0.05;
    g.userData = { key, mesh, glow, kind: "holo" };
    mesh.userData.key = key;
    holoGroup.add(g);
  });
  scene.add(holoGroup);
}

function refreshHolos() {
  if (!holoGroup) return;
  const eq = book && Number.isFinite(book.equity) ? book.equity : null;
  const fl = book && Number.isFinite(book.floating_pl) ? book.floating_pl : null;
  const bid = book && Number.isFinite(book.bid) ? book.bid : goldPx;
  const asof = book && book.asof ? book.asof : null;
  const src = liveOk ? "LIVE" : "LOCAL / GOLD-API";
  holoGroup.children.forEach((g) => {
    const mesh = g.userData.mesh;
    const k = g.userData.key;
    if (k === "equity") {
      setCard(mesh, "EQUITY", fmtMoney(eq), [book ? "bal  " + fmtMoney(book.balance) : "awaiting book"], src, false);
    }
    if (k === "float") {
      setCard(mesh, "FLOAT", fmtMoney(fl), [book ? book.symbol || "XAUUSD" : "XAUUSD"], src, false);
    }
    if (k === "bid") {
      setCard(mesh, "BID", fmtPx(bid), [book && Number.isFinite(book.ask) ? "ask  " + fmtPx(book.ask) : "gold-api"], src, false);
    }
    if (k === "asof") {
      const stamp = asof ? fmtAsof(asof) : "";
      const time = stamp && stamp !== "—" ? stamp.split(", ").pop().replace(" ET", "") : "—";
      const day = stamp && stamp.includes(",") ? stamp.split(",")[0] : (liveOk ? "Coinexx tape" : "feed idle");
      setCard(mesh, "ASOF", time, [day + (stamp.endsWith(" ET") ? "  ET" : "")], src, false);
    }
  });
}

function ticketMeta(ticket) {
  return TICKET_META[ticket] || TICKET_META[String(ticket)] || { tag: "TICKET", sub: String(ticket) };
}

function paintTicket(group, pos) {
  const meta = ticketMeta(pos.ticket);
  const profit = Number(pos.profit) || 0;
  const mesh = group.userData.mesh;
  const { ctx, canvas, tex } = mesh.userData;
  const lit = selected === group || hover === group;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = lit ? "rgba(16, 13, 6, 0.94)" : "rgba(8, 7, 4, 0.84)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = lit ? "rgba(232, 195, 122, 0.8)" : "rgba(201, 162, 39, 0.42)";
  ctx.lineWidth = lit ? 3 : 1.4;
  ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);
  ctx.fillStyle = "#6a5420";
  ctx.font = "600 22px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(meta.tag, 32, 52);
  ctx.fillStyle = "#e8c37a";
  ctx.font = "600 36px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("#" + pos.ticket, 32, 100);
  ctx.fillStyle = "#c9a227";
  ctx.font = "500 20px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText((pos.type || "buy").toUpperCase() + "   " + (pos.lots || "—") + " lot", 32, 142);
  ctx.fillText("open  " + fmtPx(pos.open) + (pos.sl ? "    sl  " + fmtPx(pos.sl) : ""), 32, 172);
  ctx.fillText(meta.sub, 32, 202);
  ctx.fillStyle = profit >= 0 ? "#e8c37a" : "#c46a6a";
  ctx.font = "600 42px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(fmtMoney(profit), 32, 262);
  ctx.fillStyle = "#6a5420";
  ctx.font = "500 16px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(selected === group ? "pinned" : "P/L", 32, canvas.height - 30);
  tex.needsUpdate = true;
  group.userData.pos = pos;
}

function makeTicket(pos) {
  const group = new THREE.Group();
  const mesh = makePlane(7.15, 3.55, 640, 360, "ticket");
  const glow = makeGlow(7.15, 3.55);
  group.add(glow);
  group.add(mesh);
  group.rotation.x = -0.045;
  group.userData = { kind: "ticket", ticket: pos.ticket, mesh, glow, baseZ: 0.12 };
  mesh.userData.kind = "ticket";
  mesh.userData.ticket = pos.ticket;
  pickables.push(mesh);
  return group;
}

function syncTickets(positions) {
  if (!ticketGroup) {
    ticketGroup = new THREE.Group();
    scene.add(ticketGroup);
  }
  const want = new Map((positions || []).map((p) => [String(p.ticket), p]));
  const have = new Map();
  ticketGroup.children.forEach((g) => have.set(String(g.userData.ticket), g));
  have.forEach((g, k) => {
    if (!want.has(k)) {
      pickables = pickables.filter((o) => o.parent !== g);
      if (selected === g) selected = null;
      if (hover === g) hover = null;
      ticketGroup.remove(g);
    }
  });
  const keys = Array.from(want.keys()).sort((a, b) => {
    if (a === "102034139") return -1;
    if (b === "102034139") return 1;
    return Number(a) - Number(b);
  });
  keys.forEach((k, i) => {
    let g = have.get(k);
    if (!g) {
      g = makeTicket(want.get(k));
      ticketGroup.add(g);
    }
    const x = keys.length === 1 ? 0 : -5.15 + i * (10.3 / Math.max(1, keys.length - 1));
    g.position.x = x;
    g.position.y = 0.05;
    g.position.z = g.userData.baseZ;
    paintTicket(g, want.get(k));
  });
}

function eventLine(ev) {
  const p = ev.payload || {};
  return p.note || p.refuse || p.status || p.side || ev.action || "";
}

function paintEvent(mesh, ev, lit) {
  const { ctx, canvas, tex } = mesh.userData;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = lit ? "rgba(16, 13, 6, 0.9)" : "rgba(8, 7, 4, 0.7)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = lit ? "rgba(232, 195, 122, 0.55)" : "rgba(201, 162, 39, 0.28)";
  ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  ctx.fillStyle = "#6a5420";
  ctx.font = "600 20px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(((ev.agent || "DESK") + "  ·  " + (ev.action || "")).toUpperCase(), 22, 40);
  ctx.fillStyle = "#e8c37a";
  ctx.font = "500 18px ui-monospace, SFMono-Regular, Menlo, monospace";
  const mid = [ev.tf, ev.symbol, (ev.payload && ev.payload.status) || ""].filter(Boolean).join("  ·  ");
  ctx.fillText(mid, 22, 68);
  ctx.fillStyle = "#c9a227";
  ctx.font = "500 16px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(String(eventLine(ev)).slice(0, 52), 22, 96);
  tex.needsUpdate = true;
}

function syncEvents(list) {
  if (!eventGroup) {
    eventGroup = new THREE.Group();
    scene.add(eventGroup);
  }
  const last = (Array.isArray(list) ? list : []).slice(-6).reverse();
  while (eventGroup.children.length > last.length) {
    const gone = eventGroup.children[eventGroup.children.length - 1];
    const mesh = gone.userData.mesh || gone;
    pickables = pickables.filter((o) => o !== mesh);
    if (selected === gone) selected = null;
    if (hover === gone) hover = null;
    eventGroup.remove(gone);
  }
  last.forEach((ev, i) => {
    let g = eventGroup.children[i];
    if (!g) {
      const mesh = makePlane(4.55, 1.28, 520, 140, "event");
      const glow = makeGlow(4.55, 1.28);
      g = new THREE.Group();
      g.add(glow);
      g.add(mesh);
      g.userData = { kind: "event", mesh, glow };
      mesh.userData.kind = "event";
      eventGroup.add(g);
      pickables.push(mesh);
    }
    const n = Math.max(1, last.length - 1);
    const t = last.length === 1 ? 0 : (i / n) - 0.5;
    g.position.set(t * 20.4, -3.55, 0.28);
    g.rotation.x = -0.03;
    g.userData.event = ev;
    paintEvent(g.userData.mesh, ev, selected === g || hover === g);
  });
}

function pickFromEvent(ev) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pickables, true);
  return hits.length ? hits[0].object : null;
}

function rootPickable(obj) {
  if (!obj) return null;
  if (obj.userData && obj.userData.mesh) return obj;
  if (obj.parent && obj.parent.userData && obj.parent.userData.mesh) return obj.parent;
  let o = obj;
  while (o && o.parent && !(o.userData && o.userData.kind)) o = o.parent;
  return o && o.userData && o.userData.kind ? o : null;
}

function setGlow(g, amount) {
  if (g && g.userData && g.userData.glow && g.userData.glow.material) {
    g.userData.glow.material.opacity = amount;
  }
}

function refreshPickVisual(g) {
  if (!g || !g.userData) return;
  const lit = hover === g || selected === g;
  setGlow(g, selected === g ? 0.22 : (hover === g ? 0.14 : 0));
  if (g.userData.kind === "ticket" && g.userData.pos) paintTicket(g, g.userData.pos);
  if (g.userData.kind === "event" && g.userData.event) paintEvent(g.userData.mesh, g.userData.event, lit);
}

function setHover(obj) {
  const next = rootPickable(obj);
  if (hover === next) return;
  const prev = hover;
  hover = next;
  canvas.style.cursor = next ? "pointer" : "grab";
  refreshPickVisual(prev);
  refreshPickVisual(hover);
}

function selectObject(obj) {
  const next = rootPickable(obj);
  if (!next || !next.userData) return;
  if (next.userData.kind !== "ticket" && next.userData.kind !== "event") return;
  const prev = selected;
  selected = selected === next ? null : next;
  refreshPickVisual(prev);
  refreshPickVisual(selected);
  refreshPickVisual(hover);
}

function ticketByIndex(idx) {
  if (!ticketGroup || !ticketGroup.children.length) return null;
  const ordered = ticketGroup.children.slice().sort((a, b) => {
    const ta = Number(a.userData.ticket);
    const tb = Number(b.userData.ticket);
    if (ta === 102034139) return -1;
    if (tb === 102034139) return 1;
    return ta - tb;
  });
  return ordered[idx] || null;
}

function onPointerMove(ev) {
  if (drag) {
    const dx = ev.clientX - drag.x;
    const dy = ev.clientY - drag.y;
    nudgeX = clamp(drag.nx - dx * 0.008, -NUDGE_MAX, NUDGE_MAX);
    nudgeY = clamp(drag.ny + dy * 0.008, -NUDGE_MAX * 0.65, NUDGE_MAX * 0.65);
    applyCamera();
    canvas.style.cursor = "grabbing";
    return;
  }
  setHover(pickFromEvent(ev));
}

function onPointerDown(ev) {
  pointerDown = { x: ev.clientX, y: ev.clientY, t: performance.now() };
  drag = { x: ev.clientX, y: ev.clientY, nx: nudgeX, ny: nudgeY };
}

function onPointerUp(ev) {
  const start = pointerDown;
  pointerDown = null;
  drag = null;
  canvas.style.cursor = hover ? "pointer" : "grab";
  if (!start) return;
  const dx = ev.clientX - start.x;
  const dy = ev.clientY - start.y;
  const dt = performance.now() - start.t;
  if (dx * dx + dy * dy > 36 || dt > 650) return;
  const obj = pickFromEvent(ev);
  if (obj) selectObject(obj);
}

function onWheel(ev) {
  ev.preventDefault();
  const dir = ev.deltaY > 0 ? 1 : -1;
  zoom = clamp(zoom * (1 + dir * 0.04), ZOOM_MIN, ZOOM_MAX);
  applyCamera();
}

function onKey(ev) {
  if (ev.key === "0") {
    resetView();
    return;
  }
  if (ev.key === "1") selectObject(ticketByIndex(0));
  if (ev.key === "2") selectObject(ticketByIndex(1));
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
  if (Number.isFinite(data.bid)) {
    if (lastBid != null && data.bid !== lastBid) dustShiver = Math.min(0.8, dustShiver + 0.28);
    lastBid = data.bid;
    ingestPrice(data.bid);
  }
  syncTickets(Array.isArray(data.positions) ? data.positions : []);
  refreshHolos();
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
  syncEvents(list);
}

async function pollGold() {
  try {
    const data = await getJSON(GOLD_URL, 4000);
    const px = data && Number(data.price);
    if (Number.isFinite(px)) {
      goldPx = px;
      ingestPrice(px);
      if (!book) refreshHolos();
    }
  } catch (err) {
    /* gold-api optional; ribbon still lives from last prices */
  }
}

async function pollAll() {
  await Promise.all([pollBook(), pollEvents(), pollGold()]);
}

function tickDust(t, dt) {
  if (!dust) return;
  const pos = dust.geometry.attributes.position.array;
  const shiver = dustShiver;
  for (let i = 0; i < DUST_N; i += 1) {
    const i3 = i * 3;
    pos[i3] = dustBase[i3] + Math.sin(t * 0.09 + i * 0.13) * 0.06;
    pos[i3 + 1] = dustBase[i3 + 1] + Math.cos(t * 0.07 + i * 0.09) * 0.05 + shiver * Math.sin(t * 3 + i) * 0.04;
    pos[i3 + 2] = dustBase[i3 + 2] + Math.sin(t * 0.05 + i * 0.07) * 0.03;
  }
  dust.geometry.attributes.position.needsUpdate = true;
  dustShiver = Math.max(0, dustShiver - dt * 0.7);
}

function tickSelected(t) {
  if (!ticketGroup) return;
  ticketGroup.children.forEach((g) => {
    const on = selected === g;
    const z = g.userData.baseZ + (on ? 0.16 : 0);
    g.position.z += (z - g.position.z) * 0.08;
    if (g.userData.glow) {
      const want = on ? 0.22 : (hover === g ? 0.14 : 0);
      g.userData.glow.material.opacity += (want - g.userData.glow.material.opacity) * 0.12;
    }
  });
  if (eventGroup) {
    eventGroup.children.forEach((g) => {
      if (!g.userData.glow) return;
      const want = selected === g ? 0.18 : (hover === g ? 0.1 : 0);
      g.userData.glow.material.opacity += (want - g.userData.glow.material.opacity) * 0.12;
    });
  }
  if (hairline) hairline.material.opacity = 0.16 + Math.sin(t * 0.35) * 0.03;
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;
  tickDust(t, dt);
  updateRibbon();
  tickSelected(t);
  renderer.render(scene, camera);
}

function bindInput() {
  window.addEventListener("resize", resize);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointerleave", () => {
    drag = null;
    pointerDown = null;
    setHover(null);
    canvas.style.cursor = "grab";
  });
  canvas.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKey);
  canvas.style.cursor = "grab";
}

initScene();
initDust();
initRibbon();
initHolos();
bindInput();
refreshHolos();
pollAll();
setInterval(pollAll, 2000);
animate();
