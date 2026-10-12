// HTTP static server + WebSocket game endpoint (/ws). No dependencies.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { upgrade } from "./ws.js";
import { Game, TICK_MS, WORLD_R } from "./game.js";

const PORT = Number(process.env.PORT) || 5000;
const MAX_CLIENTS = Number(process.env.MAX_CLIENTS) || 150;
const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const SNAP_EVERY = 2; // ticks per snapshot (15 Hz)

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

const server = http.createServer(async (req, res) => {
  const base = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  } catch {
    res.writeHead(400, base).end();
    return;
  }
  if (pathname === "/healthz") {
    res.writeHead(200, { ...base, "Content-Type": "text/plain" }).end("ok");
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { ...base, Allow: "GET, HEAD" }).end();
    return;
  }
  if (pathname.endsWith("/")) pathname += "index.html";
  const file = path.join(PUBLIC, path.normalize(pathname));
  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403, base).end();
    return;
  }
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, {
      ...base,
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      // Revalidate so new deployments are picked up immediately.
      "Cache-Control": "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    res.writeHead(404, { ...base, "Content-Type": "text/plain" }).end("not found");
  }
});

// ── Game ──

const game = new Game();
const clients = new Set();
const bySnake = new Map(); // snake id → client

const cleanName = (n) =>
  String(n ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .trim()
    .slice(0, 16) || "anonymous";

server.on("upgrade", (req, sock, head) => {
  if (!req.url.startsWith("/ws") || clients.size >= MAX_CLIENTS) {
    sock.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
    return;
  }
  const ws = upgrade(req, sock, head);
  if (!ws) return;

  const client = { ws, snake: null, view: 1000, cam: null, msgs: 0 };
  clients.add(client);
  ws.send(JSON.stringify({ t: "hello", worldR: WORLD_R, snapMs: TICK_MS * SNAP_EVERY }));

  ws.on("message", (raw) => {
    if (++client.msgs > 90) return ws.destroy(); // per-second budget, reset by the loop
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.t === "in" && client.snake) {
      if (Number.isFinite(m.a)) client.snake.target = m.a;
      client.snake.boost = !!m.b;
    } else if (m.t === "join" && !client.snake) {
      const s = game.spawn(cleanName(m.name));
      client.snake = s;
      bySnake.set(s.id, client);
    } else if (m.t === "view" && Number.isFinite(m.r)) {
      client.view = Math.min(2600, Math.max(400, m.r));
    }
  });

  ws.on("close", () => {
    clients.delete(client);
    if (client.snake) {
      bySnake.delete(client.snake.id);
      game.kill(client.snake, null);
    }
  });
});

setInterval(() => {
  const deaths = game.step();
  for (const d of deaths) {
    const c = bySnake.get(d.id);
    if (!c) continue;
    bySnake.delete(d.id);
    c.cam = { x: c.snake.pts[0].x, y: c.snake.pts[0].y, until: Date.now() + 4000 };
    c.snake = null;
    c.ws.send(JSON.stringify({ t: "dead", score: d.score, killer: d.killer }));
  }

  if (game.tickN % SNAP_EVERY) return;
  const lb = game.leaderboard();
  const leader = game.leader();
  const players = bySnake.size;
  for (const c of clients) {
    if (c.ws.buffered > 512 * 1024) continue; // slow client: skip a frame
    let cx = 0;
    let cy = 0;
    if (c.snake) {
      cx = c.snake.pts[0].x;
      cy = c.snake.pts[0].y;
    } else if (c.cam && Date.now() < c.cam.until) {
      cx = c.cam.x;
      cy = c.cam.y;
    } else if (leader) {
      cx = leader.pts[0].x;
      cy = leader.pts[0].y;
    }
    const { sn, f } = game.visible(cx, cy, c.view);
    c.ws.send(
      JSON.stringify({
        t: "s",
        me: c.snake ? c.snake.id : 0,
        c: [Math.round(cx), Math.round(cy)],
        sn,
        f,
        lb,
        p: players,
      }),
    );
  }
}, TICK_MS);

// Reset message budgets and drop dead connections.
setInterval(() => {
  for (const c of clients) c.msgs = 0;
}, 1000);
setInterval(() => {
  for (const c of clients) {
    if (!c.ws.alive) {
      c.ws.destroy();
      continue;
    }
    c.ws.alive = false;
    c.ws.ping();
  }
}, 25000);

server.listen(PORT, () => console.log(`games-landingpage listening on :${PORT}`));

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(0));
