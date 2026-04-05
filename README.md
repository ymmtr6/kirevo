# Kirevo

Kirevo is a local-first Markdown memory workspace for people and AI agents.

This repository contains an MVP implementation with:

- Markdown topic CRUD
- topic indexing and search
- wiki-link graph visualization
- 4-layer importance scoring
- context bundle API
- web page import into Markdown topics

## Structure

- [src/server.mjs](/Users/riku/git/kirevo/src/server.mjs): HTTP server and API routing
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

## Test

```bash
npm test
```

## Data Model

- Primary source of truth: Markdown files under `data/memory/topics`
- Derived index: `data/memory/.kirevo/index.json`
- Events: `data/memory/.kirevo/events.json`
- Import artifacts: `data/memory/.kirevo/ingest/`
- Git tracks sample topics under `data/memory/topics`, while `.kirevo` generated artifacts are ignored

## Current Scope

This MVP is implemented as a dependency-free local web app using Node.js standard APIs. It does not yet include Electron packaging, SQLite, or a production-grade HTML extraction pipeline.
