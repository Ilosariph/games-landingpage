// Snake pit client: renders server snapshots (interpolated) and sends steering input.

const $ = (s) => document.querySelector(s);
const arena = $("#arena");
const canvas = $("#view");
const ctx = canvas.getContext("2d");
const mini = $("#mini");
const mctx = mini.getContext("2d");
const menu = $("#menu");
const menuTitle = $("#menuTitle");
const menuMsg = $("#menuMsg");
const nameInput = $("#name");
const playBtn = $("#playBtn");
const statusEl = $("#status");
const lbEl = $("#lb");
const statsEl = $("#stats");
const onlineEl = $("#onlineCount");

let ws = null;
let retry = 500;
let worldR = 3000;
let snapMs = 66;
let prev = null;
let cur = null;
let curAt = 0;
let meId = 0;
let joining = false;
let lastLb = "";

let W = 0;
let H = 0;
let dpr = 1;
let zoom = 0.8;
let sentView = 0;

const input = { a: 0, b: false };
let sent = { a: NaN, b: false, t: 0 };
const pointers = new Map();
let mouseBoost = false;
let keyBoost = false;
const keys = { left: false, right: false };

try {
  nameInput.value = localStorage.getItem("pit-name") || "";
} catch {}

// ── Networking ──

function connect() {
  statusEl.hidden = false;
  statusEl.textContent = "Connecting…";
  playBtn.disabled = true;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    retry = 500;
    statusEl.hidden = true;
    playBtn.disabled = false;
    sentView = 0;
  };
  ws.onmessage = (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    if (m.t === "hello") {
      worldR = m.worldR;
      snapMs = m.snapMs;
    } else if (m.t === "s") {
      onSnapshot(m);
    } else if (m.t === "dead") {
      onDeath(m);
    }
  };
  ws.onclose = () => {
    meId = 0;
    joining = false;
    prev = cur = null;
    showMenu("Join the pit", "Lost connection — reconnecting…");
    statusEl.hidden = false;
    statusEl.textContent = "Reconnecting…";
    playBtn.disabled = true;
    setTimeout(connect, retry);
    retry = Math.min(retry * 2, 8000);
  };
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function parseSnapshot(m) {
  const snakes = new Map();
  for (const [id, hue, name, score, r, boost, pts] of m.sn) {
    snakes.set(id, { id, hue, name, score, r, boost, pts });
  }
  const food = new Map();
  const f = m.f;
  for (let i = 0; i < f.length; i += 5) {
    food.set(f[i], { x: f[i + 1], y: f[i + 2], v: f[i + 3], hue: f[i + 4] });
  }
  return { snakes, food, cx: m.c[0], cy: m.c[1], me: m.me };
}

function onSnapshot(m) {
  prev = cur;
  cur = parseSnapshot(m);
  curAt = performance.now();
  onlineEl.textContent = m.p;

  if (m.me && !meId) {
    meId = m.me;
    joining = false;
    menu.hidden = true;
    canvas.focus?.();
  }
  meId = m.me;

  const lbKey = JSON.stringify(m.lb) + meId;
  if (lbKey !== lastLb) {
    lastLb = lbKey;
    lbEl.replaceChildren(
      ...m.lb.map(([id, name, score]) => {
        const li = document.createElement("li");
        if (id === meId) li.className = "me";
        const n = document.createElement("span");
        n.textContent = name;
        const s = document.createElement("b");
        s.textContent = score;
        li.append(n, s);
        return li;
      }),
    );
  }

  const me = meId && cur.snakes.get(meId);
  statsEl.hidden = !me;
  if (me) {
    const rank = m.lb.findIndex(([id]) => id === meId) + 1;
    statsEl.innerHTML = `length <b>${me.score}</b>${rank ? ` · rank #${rank}` : ""}`;
  }
}

function onDeath(m) {
  meId = 0;
  input.b = false;
  const how = m.killer ? `Ran into <b>${escapeHtml(m.killer)}</b>.` : "Hit the wall.";
  showMenu("You died", `${how} Final length ${m.score}.`, true);
  playBtn.textContent = "Play again";
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function showMenu(title, msgHtml, delay = false) {
  menuTitle.textContent = title;
  menuMsg.innerHTML = msgHtml;
  menu.hidden = false;
  if (delay) {
    playBtn.disabled = true;
    setTimeout(() => (playBtn.disabled = ws?.readyState !== WebSocket.OPEN), 700);
  }
}

menu.addEventListener("submit", (e) => {
  e.preventDefault();
  if (joining || meId) return;
  const name = nameInput.value.trim();
  try {
    localStorage.setItem("pit-name", name);
  } catch {}
  joining = true;
  send({ t: "join", name });
  nameInput.blur();
  // Avoid the arena sitting half off-screen on small viewports.
  const r = arena.getBoundingClientRect();
  if (r.top < 0 || r.bottom > innerHeight) arena.scrollIntoView({ behavior: "smooth", block: "center" });
});

// ── Input ──

function steerFrom(x, y) {
  input.a = Math.atan2(y - H / 2, x - W / 2);
}

canvas.addEventListener("pointermove", (e) => {
  if (e.pointerType === "mouse" || pointers.keys().next().value === e.pointerId) steerFrom(e.offsetX, e.offsetY);
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, true);
});
canvas.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse") {
    if (e.button === 0) mouseBoost = true;
  } else {
    pointers.set(e.pointerId, true);
    if (pointers.size === 1) steerFrom(e.offsetX, e.offsetY);
  }
});
const pointerEnd = (e) => {
  if (e.pointerType === "mouse") mouseBoost = false;
  pointers.delete(e.pointerId);
};
canvas.addEventListener("pointerup", pointerEnd);
canvas.addEventListener("pointercancel", pointerEnd);
canvas.addEventListener("pointerleave", (e) => e.pointerType === "mouse" && (mouseBoost = false));
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

const typing = () => document.activeElement === nameInput;
addEventListener("keydown", (e) => {
  if (!meId || typing()) return;
  if (e.code === "Space") keyBoost = true;
  else if (e.code === "ArrowLeft" || e.code === "KeyA") keys.left = true;
  else if (e.code === "ArrowRight" || e.code === "KeyD") keys.right = true;
  else return;
  e.preventDefault();
});
addEventListener("keyup", (e) => {
  if (e.code === "Space") keyBoost = false;
  else if (e.code === "ArrowLeft" || e.code === "KeyA") keys.left = false;
  else if (e.code === "ArrowRight" || e.code === "KeyD") keys.right = false;
});
addEventListener("blur", () => {
  mouseBoost = keyBoost = keys.left = keys.right = false;
  pointers.clear();
});

function pumpInput(now) {
  if (!meId) return;
  if (keys.left) input.a -= 0.07;
  if (keys.right) input.a += 0.07;
  input.b = mouseBoost || keyBoost || pointers.size >= 2;
  const changed = Math.abs(input.a - sent.a) > 0.01 || input.b !== sent.b || Number.isNaN(sent.a);
  if (changed && now - sent.t > 40) {
    input.a = Math.atan2(Math.sin(input.a), Math.cos(input.a));
    send({ t: "in", a: Math.round(input.a * 1000) / 1000, b: input.b ? 1 : 0 });
    sent = { a: input.a, b: input.b, t: now };
  }
}

// ── Fullscreen ──

$("#fsBtn").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else arena.requestFullscreen?.().catch(() => {});
});
if (!document.fullscreenEnabled) $("#fsBtn").hidden = true;

// ── Rendering ──

function resize() {
  const r = canvas.getBoundingClientRect();
  dpr = Math.min(2, devicePixelRatio || 1);
  W = r.width;
  H = r.height;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
}
new ResizeObserver(resize).observe(canvas);
resize();

function targetZoom(r) {
  const base = Math.min(1, Math.max(0.55, Math.hypot(W, H) / 2 / 620));
  return base / (1 + Math.max(0, (r || 9) - 9) / 20);
}

function maybeSendView(now) {
  const r = Math.round(Math.hypot(W, H) / 2 / zoom + 200);
  if (Math.abs(r - sentView) > 60 && now - (maybeSendView.t || 0) > 300) {
    maybeSendView.t = now;
    sentView = r;
    send({ t: "view", r });
  }
}

const lerp = (a, b, t) => a + (b - a) * t;

function interpolate(alpha) {
  const snakes = [];
  for (const s of cur.snakes.values()) {
    const p = prev?.snakes.get(s.id);
    if (!p) {
      snakes.push(s);
      continue;
    }
    const pts = new Array(s.pts.length);
    const pl = p.pts.length;
    for (let i = 0; i < s.pts.length; i++) pts[i] = i < pl ? lerp(p.pts[i], s.pts[i], alpha) : s.pts[i];
    snakes.push({ ...s, r: lerp(p.r, s.r, alpha), pts });
  }
  snakes.sort((a, b) => (a.id === meId) - (b.id === meId) || a.score - b.score);
  return snakes;
}

function drawBackground(camX, camY) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#07080c";
  ctx.fillRect(0, 0, W, H);

  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * (W / 2 - camX * zoom), dpr * (H / 2 - camY * zoom));
  ctx.beginPath();
  ctx.arc(0, 0, worldR, 0, Math.PI * 2);
  ctx.fillStyle = "#121722";
  ctx.fill();

  // Hex-ish dot lattice clipped to the arena.
  ctx.save();
  ctx.clip();
  const step = 56;
  const halfW = W / 2 / zoom;
  const halfH = H / 2 / zoom;
  const x0 = Math.floor((camX - halfW) / step) - 1;
  const x1 = Math.ceil((camX + halfW) / step) + 1;
  const y0 = Math.floor((camY - halfH) / step) - 1;
  const y1 = Math.ceil((camY + halfH) / step) + 1;
  ctx.fillStyle = "#1e2533";
  for (let gy = y0; gy <= y1; gy++) {
    const off = gy & 1 ? step / 2 : 0;
    for (let gx = x0; gx <= x1; gx++) ctx.fillRect(gx * step + off - 2.5, gy * step - 2.5, 5, 5);
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(0, 0, worldR, 0, Math.PI * 2);
  ctx.lineWidth = 14;
  ctx.strokeStyle = "rgba(255, 70, 90, 0.55)";
  ctx.stroke();
}

function drawFood(alpha, now, view) {
  for (const [id, f] of cur.food) {
    const p = prev?.food.get(id);
    const x = p ? lerp(p.x, f.x, alpha) : f.x;
    const y = p ? lerp(p.y, f.y, alpha) : f.y;
    if (x < view.l || x > view.r || y < view.t || y > view.b) continue;
    const pulse = 1 + 0.18 * Math.sin(now / 300 + id);
    const rad = Math.min(14, 3 + Math.sqrt(f.v) * 2.4) * pulse;
    ctx.fillStyle = `hsla(${f.hue}, 100%, 60%, 0.18)`;
    ctx.beginPath();
    ctx.arc(x, y, rad * 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `hsl(${f.hue}, 100%, 66%)`;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSnake(s, view, now) {
  const pts = s.pts;
  const n = pts.length / 2;
  if (n < 2) return;
  const r = s.r;

  if (s.boost) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i * 2], pts[i * 2 + 1]);
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.lineWidth = r * 2 + 16 + 4 * Math.sin(now / 60);
    ctx.strokeStyle = `hsla(${s.hue}, 100%, 65%, 0.25)`;
    ctx.stroke();
  }

  // Dark outline so overlapping snakes stay readable.
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 1; i < n; i++) ctx.lineTo(pts[i * 2], pts[i * 2 + 1]);
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.lineWidth = r * 2 + 3;
  ctx.strokeStyle = `hsl(${s.hue}, 60%, 18%)`;
  ctx.stroke();

  const light = `hsl(${s.hue}, 85%, 62%)`;
  const dark = `hsl(${s.hue}, 75%, 52%)`;
  for (let i = n - 1; i >= 0; i--) {
    const x = pts[i * 2];
    const y = pts[i * 2 + 1];
    if (x < view.l - r || x > view.r + r || y < view.t - r || y > view.b + r) continue;
    ctx.fillStyle = i % 6 < 3 ? light : dark;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Eyes
  const hx = pts[0];
  const hy = pts[1];
  const dir = s.id === meId ? input.a : Math.atan2(hy - pts[3], hx - pts[2]);
  const body = Math.atan2(hy - pts[3], hx - pts[2]);
  for (const side of [-1, 1]) {
    const ea = body + side * 0.75;
    const ex = hx + Math.cos(ea) * r * 0.55;
    const ey = hy + Math.sin(ea) * r * 0.55;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(ex, ey, r * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(ex + Math.cos(dir) * r * 0.14, ey + Math.sin(dir) * r * 0.14, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawNames(snakes, camX, camY) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = "600 12px system-ui, sans-serif";
  ctx.textAlign = "center";
  for (const s of snakes) {
    if (s.id === meId) continue;
    const x = (s.pts[0] - camX) * zoom + W / 2;
    const y = (s.pts[1] - camY) * zoom + H / 2 + (s.r + 14) * zoom + 6;
    if (x < -50 || x > W + 50 || y < -20 || y > H + 20) continue;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillText(s.name, x + 1, y + 1);
    ctx.fillStyle = "rgba(235,240,255,0.85)";
    ctx.fillText(s.name, x, y);
  }
}

function drawMinimap(camX, camY, me) {
  const S = mini.width;
  const k = (S / 2 - 4) / worldR;
  mctx.clearRect(0, 0, S, S);
  mctx.beginPath();
  mctx.arc(S / 2, S / 2, S / 2 - 3, 0, Math.PI * 2);
  mctx.fillStyle = "rgba(10, 13, 20, 0.6)";
  mctx.fill();
  mctx.lineWidth = 2;
  mctx.strokeStyle = "rgba(255, 70, 90, 0.5)";
  mctx.stroke();
  // Visible snakes as faint dots, you as a bright one.
  if (cur) {
    for (const s of cur.snakes.values()) {
      if (s.id === meId) continue;
      mctx.fillStyle = `hsla(${s.hue}, 80%, 60%, 0.6)`;
      mctx.fillRect(S / 2 + s.pts[0] * k - 1.5, S / 2 + s.pts[1] * k - 1.5, 3, 3);
    }
  }
  mctx.beginPath();
  mctx.arc(S / 2 + camX * k, S / 2 + camY * k, me ? 4 : 3, 0, Math.PI * 2);
  mctx.fillStyle = me ? "#7dffb0" : "rgba(255,255,255,0.5)";
  mctx.fill();
}

let camX = 0;
let camY = 0;

function frame(now) {
  requestAnimationFrame(frame);
  pumpInput(now);
  if (!W || !H) return;

  if (!cur) {
    drawBackground(camX, camY);
    drawMinimap(camX, camY, null);
    return;
  }

  const alpha = prev ? Math.min(1, (now - curAt) / snapMs) : 1;
  const snakes = interpolate(alpha);
  const me = meId ? snakes.find((s) => s.id === meId) : null;
  if (me) {
    camX = me.pts[0];
    camY = me.pts[1];
  } else {
    // Ease toward the spectate target instead of jumping.
    const tx = prev ? lerp(prev.cx, cur.cx, alpha) : cur.cx;
    const ty = prev ? lerp(prev.cy, cur.cy, alpha) : cur.cy;
    const far = Math.hypot(tx - camX, ty - camY) > 1500;
    camX = far ? tx : lerp(camX, tx, 0.12);
    camY = far ? ty : lerp(camY, ty, 0.12);
  }
  zoom = lerp(zoom, targetZoom(me?.r), 0.04);
  maybeSendView(now);

  drawBackground(camX, camY);
  const pad = 40;
  const view = {
    l: camX - W / 2 / zoom - pad,
    r: camX + W / 2 / zoom + pad,
    t: camY - H / 2 / zoom - pad,
    b: camY + H / 2 / zoom + pad,
  };
  drawFood(alpha, now, view);
  for (const s of snakes) drawSnake(s, view, now);
  drawNames(snakes, camX, camY);
  drawMinimap(camX, camY, me);
}

connect();
requestAnimationFrame(frame);
