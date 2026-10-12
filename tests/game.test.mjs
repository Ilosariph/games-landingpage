import { test } from "node:test";
import assert from "node:assert/strict";
import { Game, WORLD_R, segCount } from "../server/game.js";

test("spawned snake has the right number of evenly spaced points", () => {
  const g = new Game();
  const s = g.spawn("t");
  assert.equal(s.pts.length, segCount(s.score));
  for (let i = 1; i < s.pts.length; i++) {
    const d = Math.hypot(s.pts[i].x - s.pts[i - 1].x, s.pts[i].y - s.pts[i - 1].y);
    assert.ok(Math.abs(d - 7) < 0.01, `gap ${d}`);
  }
});

test("bots fill the arena and the simulation stays sane", () => {
  const g = new Game();
  for (let i = 0; i < 30 * 60; i++) g.step();
  assert.ok(g.snakes.size >= 10);
  for (const s of g.snakes.values()) {
    const h = s.pts[0];
    assert.ok(Math.hypot(h.x, h.y) < WORLD_R, "head inside world");
    assert.ok(s.path.length < 2000, "path history is trimmed");
  }
});

test("hitting another body kills the snake and drops food", () => {
  const g = new Game();
  const a = g.spawn("a");
  const b = g.spawn("b");
  // Put b's head on a's body.
  b.path = [{ x: a.pts[5].x - 200, y: a.pts[5].y }, { x: a.pts[5].x, y: a.pts[5].y }];
  b.angle = b.target = 0;
  g.layoutBody(b);
  const before = g.food.size;
  const deaths = g.step();
  assert.ok(deaths.some((d) => d.id === b.id && d.killer === "a"));
  assert.ok(!g.snakes.has(b.id));
  assert.ok(g.food.size > before);
});

test("eating food grows score", () => {
  const g = new Game();
  const s = g.spawn("s");
  const h = s.pts[0];
  g.addFood(h.x + Math.cos(s.angle) * 5, h.y + Math.sin(s.angle) * 5, 3, 0);
  const before = s.score;
  g.step();
  assert.ok(s.score >= before + 3);
});
