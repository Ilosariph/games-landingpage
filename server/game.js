// Authoritative slither-style simulation. Pure logic, no networking.

export const WORLD_R = 3000;
export const TICK_MS = 1000 / 30;

const SEG = 7; // distance between body points
const SPEED = 4.2; // px per tick
const BOOST_SPEED = 9;
const TURN = 0.11; // rad per tick for a thin snake
const START_SCORE = 20;
const MIN_BOOST_SCORE = 25;
const BOOST_COST = 0.3; // score per tick
const FOOD_TARGET = 1100;
const FOOD_CAP = 2600;
const MIN_SNAKES = 14; // bots fill the arena up to this
const CELL = 128;

const BOT_NAMES = [
  "noodle", "sir hiss", "kaa", "danger rope", "wiggles", "slinky", "zigzag",
  "spaghetti", "monty", "lil nope", "boa vista", "ouroboros", "worm on a string",
  "snek", "jörmungandr", "hissy fit", "the long one", "pretzel", "basilisk", "linguine",
];

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const cellKey = (cx, cy) => (cx + 100) * 1000 + (cy + 100);

export const segCount = (score) => Math.min(800, Math.floor(12 + score * 0.3));
export const radius = (score) => 8 + Math.min(16, Math.sqrt(score) / 3);

export class Game {
  constructor() {
    this.snakes = new Map();
    this.food = new Map();
    this.nextId = 1;
    this.tickN = 0;
    this.grid = new Map();
    while (this.food.size < FOOD_TARGET) this.addFood();
  }

  randomPoint(maxR) {
    const r = Math.sqrt(Math.random()) * maxR;
    const a = rand(0, Math.PI * 2);
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }

  addFood(x, y, v, hue) {
    if (this.food.size >= FOOD_CAP) return;
    if (x === undefined) ({ x, y } = this.randomPoint(WORLD_R - 30));
    const id = this.nextId++;
    this.food.set(id, {
      id,
      x,
      y,
      v: v ?? [1, 1, 1, 2, 2, 3][Math.floor(Math.random() * 6)],
      hue: hue ?? Math.floor(rand(0, 360)),
    });
  }

  isClear(x, y, dist) {
    for (const s of this.snakes.values()) {
      for (let i = 0; i < s.pts.length; i += 3) {
        const p = s.pts[i];
        if ((p.x - x) ** 2 + (p.y - y) ** 2 < dist * dist) return false;
      }
    }
    return true;
  }

  spawn(name, bot = false) {
    let p = this.randomPoint(WORLD_R * 0.8);
    for (let i = 0; i < 30 && !this.isClear(p.x, p.y, 400); i++) p = this.randomPoint(WORLD_R * 0.8);
    const angle = Math.atan2(-p.y, -p.x) + rand(-1, 1); // roughly toward the centre
    const len = segCount(START_SCORE) * SEG + 20;
    const s = {
      id: this.nextId++,
      name,
      bot,
      hue: Math.floor(rand(0, 360)),
      score: START_SCORE,
      angle,
      target: angle,
      boost: false,
      boosting: false,
      r: radius(START_SCORE),
      path: [
        { x: p.x - Math.cos(angle) * len, y: p.y - Math.sin(angle) * len },
        { x: p.x, y: p.y },
      ],
      pts: [],
    };
    this.layoutBody(s);
    this.snakes.set(s.id, s);
    return s;
  }

  // Body points sit every SEG px along the path the head travelled, so the
  // body follows the head's exact trail and points move continuously.
  layoutBody(s) {
    const n = segCount(s.score);
    const path = s.path;
    const head = path[path.length - 1];
    const pts = [{ x: head.x, y: head.y }];
    let need = SEG;
    let acc = 0;
    let k = path.length - 1;
    for (; k > 0 && pts.length < n; k--) {
      const a = path[k];
      const b = path[k - 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d === 0) continue;
      while (pts.length < n && acc + d >= need) {
        const t = (need - acc) / d;
        pts.push({ x: a.x + dx * t, y: a.y + dy * t });
        need += SEG;
      }
      acc += d;
    }
    while (pts.length < n) pts.push({ ...pts[pts.length - 1] });
    if (k > 1) path.splice(0, k - 1);
    s.pts = pts;
  }

  buildGrid() {
    const grid = new Map();
    for (const s of this.snakes.values()) {
      for (const p of s.pts) {
        const key = cellKey(Math.floor(p.x / CELL), Math.floor(p.y / CELL));
        let cell = grid.get(key);
        if (!cell) grid.set(key, (cell = []));
        cell.push({ s, x: p.x, y: p.y });
      }
    }
    this.grid = grid;
  }

  /** Returns the snake owning a body point within `rad` (+ its radius) of x,y. */
  bodyNear(x, y, self, rad) {
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const cell = this.grid.get(cellKey(cx + i, cy + j));
        if (!cell) continue;
        for (const e of cell) {
          if (e.s === self) continue;
          const rr = rad + e.s.r;
          if ((e.x - x) ** 2 + (e.y - y) ** 2 < rr * rr) return e.s;
        }
      }
    }
    return null;
  }

  kill(s, killer) {
    if (!this.snakes.has(s.id)) return null;
    this.snakes.delete(s.id);
    const count = Math.ceil(s.pts.length / 2);
    const v = Math.max(0.6, (s.score * 0.8) / count);
    for (let i = 0; i < s.pts.length; i += 2) {
      const p = s.pts[i];
      this.addFood(
        p.x + rand(-s.r, s.r) * 0.6,
        p.y + rand(-s.r, s.r) * 0.6,
        Math.round(v * rand(0.7, 1.3) * 10) / 10,
        s.hue,
      );
    }
    return { id: s.id, bot: s.bot, score: Math.floor(s.score), killer: killer ? killer.name : null };
  }

  botThink(s) {
    if ((this.tickN + s.id) % 4) return;
    const h = s.pts[0];
    const look = 80 + s.r * 3;
    const wallR = WORLD_R - 80;
    const danger = (off) => {
      const a = s.angle + off;
      for (const dist of [look * 0.5, look]) {
        const x = h.x + Math.cos(a) * dist;
        const y = h.y + Math.sin(a) * dist;
        if (x * x + y * y > wallR * wallR) return true;
        if (this.bodyNear(x, y, s, s.r + 20)) return true;
      }
      return false;
    };

    if (danger(0)) {
      s.boost = false;
      for (const off of [-0.5, 0.5, -1, 1, -1.6, 1.6, -2.4, 2.4]) {
        if (!danger(off)) {
          s.target = s.angle + off;
          return;
        }
      }
      s.target = s.angle + Math.PI * 0.8;
      return;
    }

    let best = null;
    let bestScore = Infinity;
    for (const f of this.food.values()) {
      const d2 = (f.x - h.x) ** 2 + (f.y - h.y) ** 2;
      if (d2 > 450 * 450) continue;
      const sc = d2 / (f.v + 0.5);
      if (sc < bestScore) {
        bestScore = sc;
        best = f;
      }
    }
    if (best) s.target = Math.atan2(best.y - h.y, best.x - h.x);
    else s.target = s.angle + rand(-0.5, 0.5);
    s.boost = s.score > 80 && Math.random() < 0.03;
  }

  /** Advance one tick. Returns the list of deaths that happened. */
  step() {
    this.tickN++;
    for (const s of this.snakes.values()) if (s.bot) this.botThink(s);

    for (const s of this.snakes.values()) {
      s.r = radius(s.score);
      const turn = TURN * Math.max(0.45, 1 - (s.r - 8) / 30);
      s.angle = wrap(s.angle + clamp(wrap(s.target - s.angle), -turn, turn));
      s.boosting = s.boost && s.score > MIN_BOOST_SCORE;
      const speed = s.boosting ? BOOST_SPEED : SPEED;
      const head = s.path[s.path.length - 1];
      s.path.push({ x: head.x + Math.cos(s.angle) * speed, y: head.y + Math.sin(s.angle) * speed });
      if (s.boosting) {
        s.score -= BOOST_COST;
        if (this.tickN % 4 === 0) {
          const tail = s.pts[s.pts.length - 1];
          this.addFood(tail.x + rand(-4, 4), tail.y + rand(-4, 4), 1, s.hue);
        }
      }
      this.layoutBody(s);
    }

    this.buildGrid();

    const deaths = [];
    const dying = [];
    for (const s of this.snakes.values()) {
      const h = s.pts[0];
      if (h.x * h.x + h.y * h.y > (WORLD_R - s.r) ** 2) {
        dying.push([s, null]);
        continue;
      }
      // Head vs. other bodies; only half the head radius counts so grazes are forgiving.
      const killer = this.bodyNear(h.x, h.y, s, s.r * 0.5);
      if (killer) dying.push([s, killer]);
    }
    for (const [s, killer] of dying) {
      const d = this.kill(s, killer);
      if (d) deaths.push(d);
    }
    if (dying.length) this.buildGrid();

    for (const s of this.snakes.values()) {
      const h = s.pts[0];
      const eatR = s.r + 10;
      const pullR = s.r + 70;
      for (const f of this.food.values()) {
        const dx = h.x - f.x;
        const dy = h.y - f.y;
        if (Math.abs(dx) > pullR || Math.abs(dy) > pullR) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 < eatR * eatR) {
          s.score += f.v;
          this.food.delete(f.id);
        } else if (d2 < pullR * pullR) {
          const d = Math.sqrt(d2);
          const pull = Math.min(d, 7);
          f.x += (dx / d) * pull;
          f.y += (dy / d) * pull;
        }
      }
    }

    for (let i = 0; i < 6 && this.food.size < FOOD_TARGET; i++) this.addFood();
    if (this.tickN % 15 === 0 && this.snakes.size < MIN_SNAKES) {
      this.spawn(`${BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]} (bot)`, true);
    }
    return deaths;
  }

  leader() {
    let best = null;
    for (const s of this.snakes.values()) if (!best || s.score > best.score) best = s;
    return best;
  }

  leaderboard(n = 10) {
    return [...this.snakes.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, n)
      .map((s) => [s.id, s.name, Math.floor(s.score)]);
  }

  /** Everything within `view` of (cx, cy), compactly encoded. */
  visible(cx, cy, view) {
    const sn = [];
    for (const s of this.snakes.values()) {
      const reach = view + s.r;
      let seen = false;
      for (let i = 0; i < s.pts.length; i += 4) {
        const p = s.pts[i];
        if (Math.abs(p.x - cx) < reach && Math.abs(p.y - cy) < reach) {
          seen = true;
          break;
        }
      }
      if (!seen) continue;
      const flat = [];
      // Every other point: plenty for rendering at radius >= 8.
      for (let i = 0; i < s.pts.length; i += 2) flat.push(Math.round(s.pts[i].x), Math.round(s.pts[i].y));
      sn.push([s.id, s.hue, s.name, Math.floor(s.score), Math.round(s.r * 10) / 10, s.boosting ? 1 : 0, flat]);
    }
    const f = [];
    for (const p of this.food.values()) {
      if (Math.abs(p.x - cx) < view && Math.abs(p.y - cy) < view) {
        f.push(p.id, Math.round(p.x), Math.round(p.y), p.v, p.hue);
      }
    }
    return { sn, f };
  }
}
