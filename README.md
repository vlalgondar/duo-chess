# Duo Chess

Online 2v2 chess for four friends. Two teams of two share one board; a team's move must be
**proposed by one teammate and accepted by the other** before it commits. Solo teams (3-player
games) move directly. Spectators can watch.

## Stack

| Layer | Choice |
|---|---|
| Client | React 18 + TypeScript + Vite + Tailwind + Zustand |
| Board | `react-chessboard` |
| Rules | `chess.js` (runs on client *and* server) |
| Server | Cloudflare Workers + Durable Objects (one Durable Object per room) |
| Transport | Native WebSocket, JSON messages, validated with `zod` |
| Hosting | Vercel (client) + Cloudflare (server) |

pnpm workspace monorepo:

```
packages/shared   @duo/shared   pure TS: types, protocol, game engine, clock. No I/O.
packages/client   @duo/client   React app (Vite)
packages/server   @duo/server   Cloudflare Worker + Durable Object
```

## Prerequisites

- Node.js **22+** (see `.nvmrc`; run `nvm use` if you use nvm)
- pnpm **10+** (`corepack enable` will pick up the version pinned in `package.json`)
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier) for the server
- A [Vercel account](https://vercel.com/signup) (free tier) for the client

## Setup

```bash
pnpm install
cp packages/client/.env.example packages/client/.env
```

`packages/client/.env` points the client at your local server (`ws://localhost:8787/ws` by
default — matches `wrangler dev`'s default port). The server has no secrets and needs no `.env`
file; its only runtime config is `ALLOWED_ORIGINS` in `packages/server/wrangler.toml`.

## Development

Run the server and client in two terminals:

```bash
pnpm -F @duo/server dev   # wrangler dev, http://localhost:8787
pnpm -F @duo/client dev   # vite dev,     http://localhost:5173
```

Open `http://localhost:5173`, create a room, and open the same room's join link in a second tab
to test with two players.

## Testing

```bash
pnpm typecheck              # tsc --noEmit across all packages
pnpm lint                   # eslint
pnpm test                   # vitest — unit tests + the multi-client DO harness
pnpm test:e2e                # playwright, real browsers against wrangler dev + vite preview
pnpm verify                 # all four, in order — this is what must pass before every commit
pnpm -F @duo/shared test    # engine tests only (fast, no server/browser startup)
```

## Building

```bash
pnpm build                  # builds @duo/shared, @duo/client (dist/), @duo/server (tsc check)
```

## Deployment

Both sides are free-tier: Vercel's hobby plan for the client, Cloudflare Workers' free plan for
the server (Durable Objects + the request volume four friends generate cost nothing).

### Backend — Cloudflare Workers

1. `pnpm -F @duo/server exec wrangler login` (one-time, opens a browser to authorize).
2. From `packages/server`, deploy:
   ```bash
   pnpm -F @duo/server exec wrangler deploy
   ```
   This publishes to `https://duo-chess.<your-cloudflare-subdomain>.workers.dev` and runs the
   `v1` Durable Object SQLite migration already declared in `wrangler.toml` automatically on
   first deploy.
3. `wrangler.toml`'s `ALLOWED_ORIGINS` var already includes the default production client
   origin, `https://duo-chess.vercel.app` (see below), alongside the local dev origins used by
   `wrangler dev`. If you deploy the client under a different Vercel project name or attach a
   custom domain, add that origin to the comma-separated list and redeploy — a request whose
   `Origin` header isn't in this list is rejected with `403` at the WebSocket upgrade.
4. `pnpm -F @duo/server exec wrangler tail` streams live logs from the deployed Worker.

### Frontend — Vercel

1. Push this repo to GitHub (or your git host of choice) and import it into Vercel.
2. Project settings:
   - **Root Directory:** `packages/client`
   - **Build Command:** `pnpm build` (or leave the framework preset default — Vite is
     auto-detected)
   - **Output Directory:** `dist`
3. Environment variable:
   - `VITE_WS_URL` = `wss://duo-chess.<your-cloudflare-subdomain>.workers.dev/ws`
     (the `wss://` scheme, host from the `wrangler deploy` output above, `/ws` path — no
     trailing slash, no room code; the client appends `/:code` itself)
4. `packages/client/vercel.json` already includes the SPA rewrite so deep links like
   `/join/K7P2QX` resolve to `index.html` instead of 404ing.
5. Deploy. By default Vercel assigns `https://<project-name>.vercel.app` — if your project is
   named `duo-chess`, that's `https://duo-chess.vercel.app`, matching the origin already
   allowlisted in `wrangler.toml`. If you rename the project or attach a custom domain, update
   `ALLOWED_ORIGINS` (step 3 above) to match and redeploy the server.

### Verifying a deploy

Open the deployed client URL, create a room, and open the room's join link in a second browser
or device. `wrangler tail` should show the WebSocket upgrade and message traffic; a mismatched
origin shows up there as a `403` with no room activity.
