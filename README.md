# siwi.li games landing page

Landing page linking to [Nonogram](https://nonogram.siwi.li), [Sudoku](https://sudoku.siwi.li), [Minesweeper](https://minesweeper.siwi.li), [Battleships](https://battleships.siwi.li), [Connect Four](https://connect-four.siwi.li), [Tic-Tac-Toe](https://tic-tac-toe.siwi.li), [Solitaire](https://solitaire.siwi.li) and [Binoxxo](https://binoxxo.siwi.li), plus **Snake pit**: a live multiplayer slither.io-style game embedded in the page. Everyone who opens the page shares one arena; bots keep it busy when few people are around.

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

## Games (submodules)

Every game repo is a git submodule under `games/<slug>` (relative URLs `../<slug>.git`, tracking `main`). They're only there for convenient editing — the landing page image doesn't use them (`games` is in `.dockerignore`), so builds work whether or not the submodules are checked out.

```sh
git clone --recurse-submodules git@github.com:Ilosariph/games-landingpage.git
git submodule update --init                # in an existing clone
git submodule update --remote --merge      # pull latest main of every game
git submodule add ../<slug>.git games/<slug> && git config -f .gitmodules submodule.games/<slug>.branch main   # new game
```

Commit inside `games/<slug>` and push from there; then commit the bumped pointer here (optional — nothing deploys from it).

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
| `games/<slug>` | Game repos as submodules (not part of the image) |
