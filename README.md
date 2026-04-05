# Kirevo

Kirevo is a local-first Markdown memory workspace for people and AI agents.

This repository contains an MVP implementation with:

- Markdown topic CRUD
- topic indexing and search
- wiki-link graph visualization
- 4-layer importance scoring
- context bundle API
- web page import into Markdown topics
- Electron desktop shell

## Structure

- [src/server.mjs](/Users/riku/git/kirevo/src/server.mjs): HTTP server entrypoint
- [src/app-server.mjs](/Users/riku/git/kirevo/src/app-server.mjs): reusable local app server for Node/Electron
- [electron/main.mjs](/Users/riku/git/kirevo/electron/main.mjs): Electron main process
- [src/lib/store.mjs](/Users/riku/git/kirevo/src/lib/store.mjs): topic CRUD and read/context flows
- [src/lib/indexer.mjs](/Users/riku/git/kirevo/src/lib/indexer.mjs): topic indexing, links, graph data
- [src/lib/web-import.mjs](/Users/riku/git/kirevo/src/lib/web-import.mjs): web import pipeline
- [public/index.html](/Users/riku/git/kirevo/public/index.html): local UI
- [data/memory/topics](/Users/riku/git/kirevo/data/memory/topics): Markdown topic storage

## Run

```bash
npm start
```

Open `http://localhost:4312`.

## Run Desktop

```bash
npm run desktop
```

## CLI

```bash
npm run cli -- topics list
npm run cli -- topics read topic-welcome-to-kirevo
npm run cli -- context get topic-welcome-to-kirevo
npm run cli -- index rebuild
```

The CLI is JSON-first and intended for agent use from Codex or Claude Code.

Available command groups:

- `topics list|read|save|delete|create-from-link`
- `context get`
- `graph show`
- `import preview|run`
- `index rebuild`

The current implementation depends on the system `sqlite3` CLI being available in `PATH`.

Verified locally on 2026-04-06:

- `npm test`
- `node src/cli.mjs topics list`
- `node src/cli.mjs topics read topic-welcome-to-kirevo`
- `node src/cli.mjs context get topic-welcome-to-kirevo --depth 2 --max-topics 4`
- `node src/cli.mjs graph show --query guide`
- `node src/cli.mjs index rebuild`

## Package Desktop App

```bash
npm run make
```

Local build artifacts are generated under `out/`.

## Publish Desktop Release

```bash
npm run publish
```

Publishing uses Electron Forge's GitHub publisher and targets `ymmtr6/kirevo`. The included GitHub Actions workflow publishes on `v*` tags.

## Test

```bash
npm test
```

## Data Model

- Primary source of truth: Markdown files under `data/memory/topics`
- Derived index: `data/memory/.kirevo/index.sqlite`
- Events and fetch history: stored in SQLite tables
- Import artifacts: `data/memory/.kirevo/ingest/`
- Git tracks sample topics under `data/memory/topics`, while `.kirevo` generated artifacts are ignored

## Current Scope

This MVP runs both as a local web app and as an Electron desktop app. It uses Node.js standard APIs plus the system `sqlite3` CLI. In packaged Electron builds, writable app data is stored under Electron `userData`, not inside the app bundle.
