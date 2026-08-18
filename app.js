import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const LIVE_BASE = "https://geek-talk-incidents-organizer.trycloudflare.com";
const GOLD_URL = "https://api.gold-api.com/price/XAU";
const TICKET_META = {
  102034139: { tag: "LOTTERY", sub: "SL 4050" },
  102177113: { tag: "LEFTOVER", sub: "BREAK-EVEN" },
};

const INK = 0x050505;
const GOLD = 0xc9a227;
const GOLD_HI = 0xe8c37a;
const GOLD_DIM = 0x6a5420;
const RIBBON_N = 220;
const DUST_N = 2800;
const HOME_POS = new THREE.Vector3(0, 9.6, 22.5);
const HOME_TARGET = new THREE.Vector3(0, 3.4, 0);

const canvas = document.getElementById("stage");
const clock = new THREE.Clock();
const pointer = new THREE.Vector2(-2, -2);
const raycaster = new THREE.Raycaster();

let scene, camera, renderer, controls;
let dust, dustBase, dustShiver = 0;
let ribbon, ribbonPos, ribbonCol;
let titleMesh, holoGroup;
let monolithGroup, eventGroup;
let pickables = [];
let hover = null;
let book = null;
let events = [];
let prices = [];
let lastBid = null;
let liveOk = false;
let goldPx = null;
let userDriving = false;
let lastInput = 0;
let focusGoal = null;
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
  const ctx = c.getContext("2d");
  return { c, ctx };
}

function paintPanel(ctx, w, h, eyebrow, title, sub, foot) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(8, 7, 4, 0.88)";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(201, 162, 39, 0.55)";
  ctx.lineWidth = 2;
  ctx.strokeRect(10, 10, w - 20, h - 20);
  ctx.strokeStyle = "rgba(232, 195, 122, 0.18)";
  ctx.lineWidth = 1;
  ctx.strokeRect(16, 16, w - 32, h - 32);
  ctx.fillStyle = "#8a7020";
  ctx.font = "500 22px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(eyebrow || "", 36, 52);
  ctx.fillStyle = "#e8c37a";
  ctx.font = "600 54px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(title || "—", 36, 118);
  ctx.fillStyle = "#c9a227";
  ctx.font = "500 24px ui-monospace, SFMono-Regular, Menlo, monospace";
  if (sub) ctx.fillText(sub, 36, 160);
  ctx.fillStyle = "#6a5420";
  ctx.font = "500 18px ui-monospace, SFMono-Regular, Menlo, monospace";
  if (foot) ctx.fillText(foot, 36, h - 36);
}

function canvasTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function makeHolo(w, h, cw, ch) {
  const { c, ctx } = makeCanvas(cw, ch);
  paintPanel(ctx, cw, ch, "", "—", "", "");
  const tex = canvasTexture(c);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.userData = { ctx, canvas: c, tex, kind: "holo" };
  return mesh;
}

function setHolo(mesh, eyebrow, title, sub, foot) {
  const { ctx, canvas, tex } = mesh.userData;
  paintPanel(ctx, canvas.width, canvas.height, eyebrow, title, sub, foot);
  tex.needsUpdate = true;
}

function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(INK);
  scene.fog = new THREE.FogExp2(INK, 0.016);

  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  camera.position.copy(HOME_POS);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 6;
  controls.maxDistance = 48;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.target.copy(HOME_TARGET);
  controls.addEventListener("start", () => {
    userDriving = true;
    lastInput = performance.now();
    focusGoal = null;
  });
  controls.addEventListener("end", () => {
    lastInput = performance.now();
  });

  scene.add(new THREE.AmbientLight(0x2a2414, 0.7));
  const key = new THREE.DirectionalLight(0xf0d080, 1.15);
  key.position.set(8, 18, 8);
  scene.add(key);
  const fill = new THREE.PointLight(0xffe9a0, 2.1, 50, 2);
  fill.position.set(0, 10, 3);
  scene.add(fill);
  const rim = new THREE.PointLight(0x8a7020, 1.2, 40, 2);
  rim.position.set(-10, 6, -8);
  scene.add(rim);

  const grid = new THREE.GridHelper(90, 90, GOLD_DIM, 0x1c1608);
  grid.position.y = 0.001;
  const gmat = grid.material;
  if (Array.isArray(gmat)) {
    gmat.forEach((m) => { m.transparent = true; m.opacity = 0.32; m.depthWrite = false; });
  } else {
    gmat.transparent = true;
    gmat.opacity = 0.32;
    gmat.depthWrite = false;
  }
  scene.add(grid);

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(22, 64),
    new THREE.MeshStandardMaterial({
      color: 0x0a0804,
      metalness: 0.7,
      roughness: 0.55,
      transparent: true,
      opacity: 0.55,
    }),
  );
  disc.rotation.x = -Math.PI / 2;
  scene.add(disc);

  resize();
}

function initDust() {
  const geo = new THREE.BufferGeometry();
  dustBase = new Float32Array(DUST_N * 3);
  const col = new Float32Array(DUST_N * 3);
  const sizes = new Float32Array(DUST_N);
  for (let i = 0; i < DUST_N; i += 1) {
    const i3 = i * 3;
    const r = 6 + Math.random() * 26;
    const a = Math.random() * Math.PI * 2;
    dustBase[i3] = Math.cos(a) * r;
    dustBase[i3 + 1] = 0.3 + Math.random() * 14;
    dustBase[i3 + 2] = Math.sin(a) * r * 0.72;
    const g = 0.62 + Math.random() * 0.38;
    col[i3] = g;
    col[i3 + 1] = 0.48 + Math.random() * 0.28;
    col[i3 + 2] = 0.12 + Math.random() * 0.12;
    sizes[i] = 0.035 + Math.random() * 0.07;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(dustBase.slice(), 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.055,
    vertexColors: true,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  dust = new THREE.Points(geo, mat);
  scene.add(dust);
}

function initRibbon() {
  const geo = new THREE.BufferGeometry();
  ribbonPos = new Float32Array(RIBBON_N * 2 * 3);
  ribbonCol = new Float32Array(RIBBON_N * 2 * 3);
  const idx = [];
  for (let i = 0; i < RIBBON_N; i += 1) {
    const x = -16 + (i / (RIBBON_N - 1)) * 32;
    for (let row = 0; row < 2; row += 1) {
      const o = (i * 2 + row) * 3;
      ribbonPos[o] = x;
      ribbonPos[o + 1] = 4.2;
      ribbonPos[o + 2] = -6 + (row ? 0.22 : -0.22);
      const k = i / (RIBBON_N - 1);
      ribbonCol[o] = 0.55 + k * 0.45;
      ribbonCol[o + 1] = 0.38 + k * 0.28;
      ribbonCol[o + 2] = 0.08 + k * 0.08;
    }
    if (i < RIBBON_N - 1) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  geo.setAttribute("position", new THREE.BufferAttribute(ribbonPos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(ribbonCol, 3));
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.88,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  ribbon = new THREE.Mesh(geo, mat);
  scene.add(ribbon);
}

function ingestPrice(px) {
  if (!Number.isFinite(px) || px <= 0) return;
  const prev = prices.length ? prices[prices.length - 1] : null;
  prices.push(px);
  if (prices.length > RIBBON_N) prices.shift();
  if (prev != null && Math.abs(px - prev) > 0.01) {
    dustShiver = Math.min(1.5, dustShiver + 0.62);
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
  const span = Math.max(1.2, max - min);
  const n = prices.length;
  for (let i = 0; i < RIBBON_N; i += 1) {
    const src = i < RIBBON_N - n ? prices[0] : prices[i - (RIBBON_N - n)];
    const y = 4.15 + ((src - min) / span) * 3.4;
    const x = -16 + (i / (RIBBON_N - 1)) * 32;
    const wave = Math.sin(i * 0.085 + performance.now() * 0.0007) * 0.12;
    for (let row = 0; row < 2; row += 1) {
      const o = (i * 2 + row) * 3;
      ribbonPos[o] = x;
      ribbonPos[o + 1] = y;
      ribbonPos[o + 2] = -6 + wave + (row ? 0.22 : -0.22);
    }
  }
  ribbon.geometry.attributes.position.needsUpdate = true;
}

function initHolos() {
  const { c, ctx } = makeCanvas(1024, 220);
  ctx.fillStyle = "rgba(8,7,4,0.2)";
  ctx.fillRect(0, 0, 1024, 220);
  ctx.fillStyle = "#e8c37a";
  ctx.font = "600 72px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("XAUUSD DESK", 40, 100);
  ctx.fillStyle = "#8a7020";
  ctx.font = "500 28px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("5217539  ·  COINEXX DEMO  ·  GOLD ONLY", 40, 160);
  const tex = canvasTexture(c);
  titleMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 3.4),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.95, depthWrite: false }),
  );
  titleMesh.position.set(0, 12.6, -11);
  scene.add(titleMesh);

  holoGroup = new THREE.Group();
  const keys = ["equity", "float", "bid", "asof"];
  keys.forEach((key, i) => {
    const mesh = makeHolo(5.4, 2.35, 512, 256);
    mesh.position.set(-9.2 + i * 6.15, 9.7, -10.2);
    mesh.userData.key = key;
    holoGroup.add(mesh);
  });
  scene.add(holoGroup);
}

function refreshHolos() {
  if (!holoGroup) return;
  const eq = book && Number.isFinite(book.equity) ? book.equity : null;
  const fl = book && Number.isFinite(book.floating_pl) ? book.floating_pl : null;
  const bid = book && Number.isFinite(book.bid) ? book.bid : goldPx;
  const asof = book && book.asof ? book.asof : null;
  const src = liveOk ? "LIVE FEED" : "LOCAL / GOLD-API";
  holoGroup.children.forEach((mesh) => {
    const k = mesh.userData.key;
    if (k === "equity") setHolo(mesh, "EQUITY", fmtMoney(eq), book ? "bal " + fmtMoney(book.balance) : "awaiting book", src);
    if (k === "float") setHolo(mesh, "FLOAT", fmtMoney(fl), book ? book.symbol || "XAUUSD" : "XAUUSD", src);
    if (k === "bid") setHolo(mesh, "BID", fmtPx(bid), book && Number.isFinite(book.ask) ? "ask " + fmtPx(book.ask) : "gold-api", src);
    if (k === "asof") setHolo(mesh, "LIVE ASOF", asof ? fmtAsof(asof).split(" ET")[0] : "—", liveOk ? "Coinexx tape" : "feed idle", src);
  });
}

function ticketMeta(ticket) {
  return TICKET_META[ticket] || TICKET_META[String(ticket)] || { tag: "TICKET", sub: String(ticket) };
}

function profitHeight(profit) {
  const mag = Math.abs(Number(profit) || 0);
  return 2.3 + Math.sqrt(mag) * 0.22;
}

function makeMonolith(pos) {
  const group = new THREE.Group();
  group.userData.kind = "ticket";
  group.userData.ticket = pos.ticket;
  const mat = new THREE.MeshStandardMaterial({
    color: 0x14110a,
    metalness: 0.86,
    roughness: 0.22,
    emissive: GOLD,
    emissiveIntensity: 0.28,
  });
  const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1, 1.7), mat);
  pillar.userData.kind = "ticket";
  pillar.userData.ticket = pos.ticket;
  group.add(pillar);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.35, 0.035, 8, 48),
    new THREE.MeshStandardMaterial({ color: GOLD, metalness: 0.9, roughness: 0.2, emissive: GOLD, emissiveIntensity: 0.35 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.04;
  group.add(ring);
  const plaque = makeHolo(2.35, 2.9, 384, 480);
  plaque.position.set(0, 2.2, 0.95);
  group.add(plaque);
  group.userData.pillar = pillar;
  group.userData.plaque = plaque;
  group.userData.mat = mat;
  plaque.userData.kind = "ticket";
  plaque.userData.ticket = pos.ticket;
  pickables.push(pillar, plaque);
  return group;
}

function paintTicket(group, pos) {
  const meta = ticketMeta(pos.ticket);
  const profit = Number(pos.profit) || 0;
  const h = profitHeight(profit);
  group.userData.targetH = h;
  const pillar = group.userData.pillar;
  if (pillar.scale.y < 0.2) pillar.scale.y = h;
  const glow = 0.22 + clamp(Math.abs(profit) / 1800, 0, 1.15);
  group.userData.mat.emissive.setHex(profit >= 0 ? GOLD : 0x6a2020);
  group.userData.baseEmissive = glow;
  if (hover !== group && hover !== pillar) group.userData.mat.emissiveIntensity = glow;
  const plaque = group.userData.plaque;
  const { ctx, canvas, tex } = plaque.userData;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(8,7,4,0.9)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(201,162,39,0.6)";
  ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);
  ctx.fillStyle = "#8a7020";
  ctx.font = "600 26px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(meta.tag, 28, 56);
  ctx.fillStyle = "#e8c37a";
  ctx.font = "600 34px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("#" + pos.ticket, 28, 104);
  ctx.fillStyle = "#c9a227";
  ctx.font = "500 22px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText((pos.type || "buy").toUpperCase() + "  " + (pos.lots || "—") + " lot", 28, 150);
  ctx.fillText("open " + fmtPx(pos.open), 28, 186);
  ctx.fillText(meta.sub + (pos.sl ? "  sl " + fmtPx(pos.sl) : ""), 28, 222);
  ctx.fillStyle = profit >= 0 ? "#e8c37a" : "#d46a6a";
  ctx.font = "600 40px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(fmtMoney(profit), 28, 290);
  ctx.fillStyle = "#6a5420";
  ctx.font = "500 18px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("click to focus", 28, canvas.height - 32);
  tex.needsUpdate = true;
}

function syncMonoliths(positions) {
  if (!monolithGroup) {
    monolithGroup = new THREE.Group();
    scene.add(monolithGroup);
  }
  const want = new Map((positions || []).map((p) => [String(p.ticket), p]));
  const have = new Map();
  monolithGroup.children.forEach((g) => have.set(String(g.userData.ticket), g));
  have.forEach((g, k) => {
    if (!want.has(k)) {
      pickables = pickables.filter((o) => o.parent !== g);
      monolithGroup.remove(g);
    }
  });
  const keys = Array.from(want.keys());
  keys.forEach((k, i) => {
    let g = have.get(k);
    if (!g) {
      g = makeMonolith(want.get(k));
      monolithGroup.add(g);
    }
    const x = keys.length === 1 ? 0 : -5.4 + i * (10.8 / Math.max(1, keys.length - 1));
    g.position.x = x;
    g.position.z = 0.2;
    paintTicket(g, want.get(k));
  });
}

function eventLine(ev) {
  const p = ev.payload || {};
  return p.note || p.refuse || p.status || p.side || ev.action || "";
}

function paintEvent(mesh, ev) {
  const { ctx, canvas, tex } = mesh.userData;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(10,8,4,0.78)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(201,162,39,0.4)";
  ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  ctx.fillStyle = "#8a7020";
  ctx.font = "600 22px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(((ev.agent || "DESK") + "  ·  " + (ev.action || "")).toUpperCase(), 24, 42);
  ctx.fillStyle = "#e8c37a";
  ctx.font = "500 20px ui-monospace, SFMono-Regular, Menlo, monospace";
  const mid = [ev.tf, ev.symbol, (ev.payload && ev.payload.status) || ""].filter(Boolean).join("  ·  ");
  ctx.fillText(mid, 24, 74);
  ctx.fillStyle = "#c9a227";
  ctx.font = "500 18px ui-monospace, SFMono-Regular, Menlo, monospace";
  const note = String(eventLine(ev)).slice(0, 64);
  ctx.fillText(note, 24, 106);
  tex.needsUpdate = true;
}

function syncEvents(list) {
  if (!eventGroup) {
    eventGroup = new THREE.Group();
    scene.add(eventGroup);
  }
  const last = (Array.isArray(list) ? list : []).slice(-8).reverse();
  while (eventGroup.children.length > last.length) {
    const gone = eventGroup.children[eventGroup.children.length - 1];
    pickables = pickables.filter((o) => o !== gone);
    eventGroup.remove(gone);
  }
  last.forEach((ev, i) => {
    let mesh = eventGroup.children[i];
    if (!mesh) {
      mesh = makeHolo(6.4, 1.45, 640, 160);
      mesh.userData.kind = "event";
      eventGroup.add(mesh);
      pickables.push(mesh);
    }
    const t = (i / Math.max(1, last.length - 1)) - 0.5;
    mesh.userData.baseY = 1.55 + (i % 2) * 0.18;
    mesh.position.set(t * 18, mesh.userData.baseY, 7.2 - Math.abs(t) * 1.1);
    mesh.rotation.y = -t * 0.28;
    mesh.userData.event = ev;
    paintEvent(mesh, ev);
  });
}

function worldCenter(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  return box.getCenter(new THREE.Vector3());
}

function focusObject(obj, dist) {
  if (!obj) return;
  userDriving = true;
  lastInput = performance.now();
  const center = worldCenter(obj);
  const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3()).length();
  const d = Math.max(dist || 9, size * 1.7);
  const dir = camera.position.clone().sub(controls.target).normalize();
  if (dir.lengthSq() < 0.01) dir.set(0, 0.35, 1).normalize();
  focusGoal = {
    pos: center.clone().add(dir.multiplyScalar(d)),
    target: center.clone(),
  };
}

function resetCamera() {
  userDriving = true;
  lastInput = performance.now();
  focusGoal = { pos: HOME_POS.clone(), target: HOME_TARGET.clone() };
}

function ticketByIndex(idx) {
  if (!monolithGroup || !monolithGroup.children.length) return null;
  const ordered = monolithGroup.children.slice().sort((a, b) => {
    const ta = Number(a.userData.ticket);
    const tb = Number(b.userData.ticket);
    if (ta === 102034139) return -1;
    if (tb === 102034139) return 1;
    return ta - tb;
  });
  return ordered[idx] || null;
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
  let o = obj;
  while (o && o.parent && !o.userData.kind) o = o.parent;
  return o;
}

function hoverRoot(obj) {
  if (!obj) return null;
  if (obj.userData.kind === "ticket" && obj.parent && obj.parent.userData.kind === "ticket") return obj.parent;
  return rootPickable(obj);
}

function setHover(obj) {
  const next = hoverRoot(obj);
  if (hover === next) return;
  if (hover && hover.userData && hover.userData.mat) {
    hover.userData.mat.emissiveIntensity = hover.userData.baseEmissive || 0.28;
  } else if (hover && hover.material && hover.userData.kind === "event") {
    hover.material.opacity = 0.92;
  }
  hover = next;
  canvas.style.cursor = next ? "pointer" : "grab";
  if (!next) return;
  if (next.userData.mat) {
    next.userData.mat.emissiveIntensity = (next.userData.baseEmissive || 0.28) + 0.85;
  } else if (next.userData.kind === "event" && next.material) {
    next.material.opacity = 1;
  }
}

function onPointerMove(ev) {
  lastInput = performance.now();
  setHover(pickFromEvent(ev));
}

function onPointerDown(ev) {
  pointerDown = { x: ev.clientX, y: ev.clientY, t: performance.now() };
  userDriving = true;
  lastInput = performance.now();
}

function onPointerUp(ev) {
  if (!pointerDown) return;
  const dx = ev.clientX - pointerDown.x;
  const dy = ev.clientY - pointerDown.y;
  const dt = performance.now() - pointerDown.t;
  pointerDown = null;
  if (dx * dx + dy * dy > 36 || dt > 500) return;
  const obj = pickFromEvent(ev);
  if (!obj) return;
  const root = hoverRoot(obj) || obj;
  focusObject(root, root.userData.kind === "event" ? 7 : 10);
}

function onKey(ev) {
  if (ev.key === "1") focusObject(ticketByIndex(0), 10);
  if (ev.key === "2") focusObject(ticketByIndex(1), 10);
  if (ev.key === "0") resetCamera();
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
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
    if (lastBid != null && data.bid !== lastBid) dustShiver = Math.min(1.6, dustShiver + 0.7);
    lastBid = data.bid;
    ingestPrice(data.bid);
  }
  syncMonoliths(Array.isArray(data.positions) ? data.positions : []);
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
  events = list;
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
    const bx = dustBase[i3];
    const by = dustBase[i3 + 1];
    const bz = dustBase[i3 + 2];
    pos[i3] = bx + Math.sin(t * 0.31 + i * 0.17) * 0.08 + (Math.sin(t * 9 + i) * shiver * 0.18);
    pos[i3 + 1] = by + Math.cos(t * 0.27 + i * 0.11) * 0.12 + shiver * Math.sin(t * 11 + i * 0.3) * 0.2;
    pos[i3 + 2] = bz + Math.sin(t * 0.22 + i * 0.09) * 0.08;
  }
  dust.geometry.attributes.position.needsUpdate = true;
  dustShiver = Math.max(0, dustShiver - dt * 1.6);
}

function tickMonoliths(t, dt) {
  if (!monolithGroup) return;
  monolithGroup.children.forEach((g) => {
    const pillar = g.userData.pillar;
    const target = g.userData.targetH || 3;
    pillar.scale.y += (target - pillar.scale.y) * Math.min(1, dt * 3.2);
    pillar.position.y = pillar.scale.y / 2;
    const plaque = g.userData.plaque;
    plaque.position.y = Math.max(1.6, pillar.scale.y * 0.58);
    g.position.y = 0;
    g.rotation.y = Math.sin(t * 0.18 + g.position.x) * 0.03;
  });
}

function tickFocus(dt) {
  if (!focusGoal) return;
  camera.position.lerp(focusGoal.pos, clamp(dt * 2.4, 0, 1));
  controls.target.lerp(focusGoal.target, clamp(dt * 2.4, 0, 1));
  if (camera.position.distanceTo(focusGoal.pos) < 0.08) focusGoal = null;
}

function tickDrift(t, dt) {
  if (focusGoal) return;
  if (userDriving && performance.now() - lastInput < 7000) return;
  userDriving = false;
  const q = new THREE.Quaternion();
  q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.045);
  camera.position.sub(controls.target).applyQuaternion(q).add(controls.target);
  camera.position.y += Math.sin(t * 0.17) * 0.01;
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;
  tickDust(t, dt);
  updateRibbon();
  tickMonoliths(t, dt);
  tickFocus(dt);
  tickDrift(t, dt);
  if (titleMesh) titleMesh.position.y = 12.6 + Math.sin(t * 0.35) * 0.08;
  if (holoGroup) holoGroup.children.forEach((m, i) => {
    m.position.y = 9.7 + Math.sin(t * 0.4 + i) * 0.06;
  });
  if (eventGroup) eventGroup.children.forEach((m, i) => {
    m.position.y = (m.userData.baseY || 1.55) + Math.sin(t * 0.5 + i * 0.7) * 0.08;
  });
  controls.update();
  renderer.render(scene, camera);
}

function bindInput() {
  window.addEventListener("resize", resize);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);
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
