# siwi.li games landing page

Landing page linking to [Nonogram](https://nonogram.siwi.li), [Sudoku](https://sudoku.siwi.li), [Minesweeper](https://minesweeper.siwi.li) and [Battleships](https://battleships.siwi.li), plus **Snake pit**: a live multiplayer slither.io-style game embedded in the page. Everyone who opens the page shares one arena; bots keep it busy when few people are around.

A small Node server (no npm dependencies) serves `public/` and runs the authoritative game loop over a WebSocket at `/ws`.

## Run

```sh
docker compose up -d --build   # port 5000 (expects the external `proxy` network)
npm start                      # → http://localhost:5000 (Node >= 20)
```

The reverse proxy in front must forward WebSocket upgrades for `/ws` (Traefik and Caddy do this by default; for nginx set `proxy_http_version 1.1` plus the `Upgrade`/`Connection` headers).

| Env | Default | |
| --- | --- | --- |
| `PORT` | `5000` | HTTP + WebSocket port |
| `MAX_CLIENTS` | `150` | Max concurrent WebSocket connections |

## Test

```sh
npm test                       # game simulation tests (node --test, no deps)
```

## Layout

| Path | Purpose |
| --- | --- |
| `server/game.js` | Simulation: movement, growth, collisions, food, bots |
| `server/server.js` | Static file server, game loop (30 Hz), snapshots (15 Hz) |
| `server/ws.js` | Minimal WebSocket implementation |
| `public/js/slither.js` | Client: input, interpolation, canvas rendering, HUD |
| `public/index.html`, `public/styles.css` | Landing page |
| `Dockerfile`, `docker-compose.yml` | Container image and sample compose |
