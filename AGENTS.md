# Repository Guidelines

## Project Structure & Module Organization
- `server.js` hosts the Express + Socket.io server, manages rooms, betting rounds, and timers.
- `poker.js` contains the deck utilities and hand evaluator shared by the server.
- Static client assets live in `public/` (`index.html`, `style.css`, `client.js`) and are served automatically via `express.static`.
- Runtime state is in-memory only; restarting the server wipes rooms, so keep any persistent tooling or notes outside the repo.

## Build, Test, and Development Commands
- `npm install` – fetch dependencies (`express`, `socket.io`). Run once per clone.
- `npm start` (or `node server.js`) – launches the LAN table on http://localhost:3000 and serves the front-end bundle.
- Use `node --watch server.js` during backend iteration to reload on changes; front-end files auto-refresh through the browser.

## Coding Style & Naming Conventions
- Stick to CommonJS modules, `const`/`let`, and 4-space indentation as seen in `server.js` and `poker.js`.
- Favor descriptive socket event names (`roomStateUpdate`, `yourTurn`) and camelCase handler functions.
- Keep client-side DOM helpers pure and colocated in `public/client.js`; CSS classes follow the `.seat-*` pattern already in `style.css`.
- Run `node --check` or an editor-integrated linter before committing; no automated formatter exists, so match the current style manually.

## Testing Guidelines
- No formal suite exists yet; introduce module-level tests under `tests/` and invoke them with `node --test tests/poker.test.js`.
- Prioritize deterministic simulations of `Deck` shuffles and `evaluateHand` rankings; stub randomness where possible.
- For socket flows, lean on integration harnesses (e.g., `socket.io-client`) to assert room lifecycle events before touching UI code.

## Commit & Pull Request Guidelines
- Use concise, present-tense commit messages (`deal: fix blind rotation`, `client: render showdown cards`).
- Each PR should explain the problem, the solution, and manual test evidence (commands run, browser steps, or screenshots of the table state).
- Reference related issues or TODOs inline; highlight any migrations to shared game logic so reviewers can focus on multiplayer side effects.

## Security & Configuration Tips
- Ports default to 3000; if your deployment needs a different port, parameterize `PORT` via `process.env.PORT` but keep local default intact.
- Never log real player data in production builds—use anonymized IDs when adding telemetry or analytics hooks.
