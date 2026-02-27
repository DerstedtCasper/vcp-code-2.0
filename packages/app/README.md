## Usage

Dependencies for these templates are managed with [pnpm](https://pnpm.io) using `pnpm up -Lri`.

This is the reason you see a `pnpm-lock.yaml`. That said, any package manager will work. This file can safely be removed once you clone a template.

```bash
$ npm install # or pnpm install or yarn install
```

### Learn more on the [Solid Website](https://solidjs.com) and come chat with us on our [Discord](https://discord.com/invite/solidjs)

## Available Scripts

In the project directory, you can run:

### `npm run dev` or `npm start`

Runs the app in the development mode.<br>
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

The page will reload if you make edits.<br>

### `npm run build`

Builds the app for production to the `dist` folder.<br>
It correctly bundles Solid in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.<br>
Your app is ready to be deployed!

## Local Full-Stack Dev

If you are working on the app against a local opencode backend, prefer the root command so frontend and backend start together:

```bash
# from repo root
bun run dev:web
```

This command starts:

- Backend: `packages/opencode` on `http://127.0.0.1:4096`
- Frontend: `packages/app` on `http://127.0.0.1:4444`

Optional overrides:

- `KILO_DEV_SERVER_HOST` (default `127.0.0.1`)
- `KILO_DEV_SERVER_PORT` (default `4096`)
- `KILO_DEV_WEB_PORT` (default `4444`)
- `KILO_DEV_HEALTH_TIMEOUT_MS` (default `60000`)

## E2E Testing

Playwright starts the Vite dev server automatically via `webServer`, and UI tests need an opencode backend (defaults to `localhost:4096`).
Use the local runner to create a temp sandbox, seed data, and run the tests.

```bash
bunx playwright install
bun run test:e2e:local
bun run test:e2e:local -- --grep "settings"
```

Environment options:

- `PLAYWRIGHT_SERVER_HOST` / `PLAYWRIGHT_SERVER_PORT` (backend address, default: `localhost:4096`)
- `PLAYWRIGHT_PORT` (Vite dev server port, default: `3000`)
- `PLAYWRIGHT_BASE_URL` (override base URL, default: `http://localhost:<PLAYWRIGHT_PORT>`)

## Deployment

You can deploy the `dist` folder to any static host provider (netlify, surge, now, etc.)
