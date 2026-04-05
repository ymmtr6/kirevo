# Kirevo Implementation Plan

## 1. 前提整理

- 設計資料: [Kirevo_開発設計資料_codex向け_v2.md](/Users/riku/sandbox/Kirevo_開発設計資料_codex向け_v2.md)
- 現状リポジトリは空であり、既存実装の継承はない
- 初期ターゲットは個人利用向け MVP
- 一次データは Markdown、派生データは SQLite を採用する

## 2. 実装方針

MVP の要求をそのまま満たすには、ローカル完結のデスクトップ寄り構成が最も素直です。初期実装は `Electron + React + TypeScript + Node.js` を前提にします。

理由:

- ファイル監視、ローカル書き込み、SQLite、Web 取り込みを 1 プロセス系で扱いやすい
- Markdown エディタとグラフ UI を同一アプリで閉じられる
- 将来 `Reader API` や `MCP adapter` を backend package として切り出しやすい

代替として `Tauri` も成立しますが、現時点では TypeScript 中心で立ち上げ速度を優先します。

## 3. 初期アーキテクチャ

```text
kirevo/
  app/
    desktop/
      src/main/        # Electron main, fs, watcher, sqlite bridge
      src/preload/     # IPC bridge
      src/renderer/    # React UI
  packages/
    core/              # domain model, types, layer engine
    markdown/          # frontmatter, topic parse/save, section/link extraction
    indexer/           # sqlite schema, sync, watcher handlers
    ingestion/         # fetch, readability, turndown, duplicate detection
    api/               # Reader/Writer use cases
  data/
    memory/
      topics/
      .kirevo/
```

責務分離:

- `packages/core`: 型、Topic 規約、layer score
- `packages/markdown`: Markdown を正として扱う read/write
- `packages/indexer`: Markdown から SQLite 派生データを同期
- `packages/ingestion`: Web URL から topic を生成
- `packages/api`: UI が呼ぶ `listTopics/readTopic/saveTopic/importWebPage`
- `app/desktop`: UI とローカル実行基盤

## 4. 技術選定

- Monorepo: `pnpm workspace`
- Frontend: `React`, `TypeScript`, `Vite`
- Desktop shell: `Electron`
- Editor: `CodeMirror 6`
- Graph: `React Flow`
- Markdown/frontmatter: `gray-matter`, `remark`, `mdast`
- File watcher: `chokidar`
- Database: `better-sqlite3` + SQLite FTS5
- Web ingestion: `undici` or native fetch, `jsdom`, `@mozilla/readability`, `turndown`
- Validation: `zod`
- Test: `vitest`

補足:

- SQLite は同期アクセスでも MVP では十分
- `better-sqlite3` は watcher/indexer と相性がよく、実装が単純
- wiki link は MVP では正規表現 + remark 補助で十分

## 5. 実装フェーズ

### Phase 0: Bootstrapping

目的:

- モノレポとアプリ骨格を立てる
- 開発を止めないための共通基盤を先に固定する

作業:

- `pnpm workspace` 初期化
- Electron + React + Vite 雛形作成
- `packages/*` の workspace 構成作成
- lint / format / test 基盤追加
- `data/memory/topics` と `.kirevo` の初期化処理追加

完了条件:

- デスクトップアプリが起動する
- renderer から backend bridge を呼べる
- テストが 1 本以上動く

### Phase 1: Core Memory CRUD

目的:

- Markdown topic の新規作成、読み込み、保存を成立させる

作業:

- `TopicFrontmatter`, `Topic`, `TopicSummary` 型定義
- frontmatter parse/serialize 実装
- slug/id 生成ルール実装
- atomic write 実装
- `saveTopic`, `readTopic`, `listTopicFiles` 実装
- Topic List と Editor の最小 UI 実装

完了条件:

- topic の新規作成・編集・保存ができる
- UTF-8 Markdown が壊れず保存される
- frontmatter 付き topic を round-trip できる

### Phase 2: Indexer and Search Foundation

目的:

- Markdown を SQLite に同期し、一覧と検索の土台を作る

作業:

- SQLite schema migration 実装
- topic parser で metadata/body/sections/links 抽出
- `topics`, `topic_tags`, `topic_sections`, `topic_links`, `topic_events` 同期
- FTS5 インデックス更新
- file watcher 実装
- `listTopics`, `searchTopics` API 実装

完了条件:

- 保存または外部変更が index に反映される
- タイトル検索と本文検索が動く
- section と link が DB に保存される

### Phase 3: Graph and Layer Engine

目的:

- topic 間関連と重要度可視化を成立させる

作業:

- wiki link 抽出 (`[[slug]]`, `[[slug|label]]`)
- inbound/outbound link count 更新
- layer score 計算関数実装
- percentile ベース layer 判定実装
- `manual_layer`, `pinned` の優先ルール反映
- graph nodes/edges API 実装
- Graph Viewer と Metadata Panel 実装
- backlinks UI 実装

完了条件:

- wiki link が graph に出る
- layer が 1-4 で表示される
- 選択 topic の関連 topic を辿れる

### Phase 4: Read Tracking and Context API

目的:

- 単なる保管ではなく、読み込み優先制御の核を実装する

作業:

- `readTopic` 時の read event 記録
- `last_read_at`, `read_count` 更新
- `readTopicContext` 実装
- layer を考慮した related topic 展開
- section 単位返却モード実装

完了条件:

- topic を開くと read event が残る
- 関連 topic を束ねた context bundle を返せる

### Phase 5: Web Ingestion MVP

目的:

- URL から通常 topic と同等に扱える web topic を作る

作業:

- URL validation 実装
- fetch wrapper 実装
- HTML 取得と raw 保存
- Readability 抽出
- Turndown 変換
- post-process で code/list/link 補正
- canonical URL と hash による duplicate check
- web topic frontmatter/template 生成
- `previewWebImport`, `importWebPage` 実装
- Web Import Dialog 実装

完了条件:

- URL から Markdown topic を生成できる
- source metadata が保存される
- preview と duplicate 検知が機能する

### Phase 6: Hardening

目的:

- MVP として壊れにくい状態にする

作業:

- エラーログ整備
- indexing 失敗時の再試行導線
- import failure fallback topic
- 主要ユースケースの統合テスト
- サンプル topic / seed data 整備

完了条件:

- 主要フローで破損しない
- 失敗時に復旧可能な情報が残る

## 6. 実装順序の理由

この順序にする理由は、`graph` と `web ingestion` がどちらも `Markdown -> parser -> SQLite index` を前提にしているためです。先に CRUD と indexer を固めると、その後の機能は追加実装になり、作り直しが減ります。

逆に Graph から始めると、保存仕様や link 同期仕様が後で変わりやすく、手戻りが大きいです。

## 7. 直近の具体タスク

最初の実装ターンでは以下を着手対象にするのが妥当です。

1. `pnpm` workspace と Electron/React の雛形を作る
2. `packages/core` に型定義を置く
3. `packages/markdown` に frontmatter parse/save を実装する
4. `data/memory/topics` の topic CRUD を動かす
5. Topic List + Editor の最小 UI をつなぐ

この時点では SQLite と graph はまだ入れず、保存フォーマットを先に安定させます。

## 8. リスクと先回り

- `Web ingestion` はサイト差異が大きい
  - MVP は site-specific parser を作らず、Readability ベースで始める
- 日本語タイトルの slug 生成は不安定
  - 初期は ASCII 化優先、失敗時は timestamp fallback
- 外部編集との競合が起きる
  - watcher 再読込と dirty state 警告を後続で入れる
- layer percentile は件数が少ないと荒れる
  - 初期件数が少ない間は閾値ベース fallback を併用する

## 9. テスト戦略

- Unit
  - frontmatter parse/serialize
  - wiki link extraction
  - section extraction
  - layer scoring
  - duplicate detection
- Integration
  - topic save -> watcher -> index sync
  - readTopic -> event write -> score recompute
  - importWebPage -> markdown save -> index reflect
- Fixture
  - manual topic
  - web topic
  - broken frontmatter
  - extraction failure HTML

## 10. MVP 判定ライン

以下が揃えば MVP 実装完了と判断できます。

- topic を Markdown として作成、編集、保存できる
- topic 一覧と検索が使える
- wiki link が graph に出る
- layer が自動計算される
- URL から web topic を取り込める
- source metadata を保持できる

## 11. CLI 設計

### 11.1 目的

`kirevo` CLI は Claude Code / Codex などの agent が安定して叩けるローカル interface とする。人間向けの対話 UI ではなく、`stdin/stdout` と終了コードが明確な JSON-first CLI を優先する。

### 11.2 設計方針

- コマンド構造は `kirevo <resource> <action>`
- デフォルト出力は JSON
- 失敗時は `stderr` に短い説明、`stdout` には JSON error を返せるようにする
- interactive prompt は持たない
- 既存の `store/indexer/web-import` を直接呼び、HTTP API と二重実装しない

### 11.3 初期コマンド

- `kirevo topics list`
- `kirevo topics read <topic-id-or-slug>`
- `kirevo topics save --file <topic.md>`
- `kirevo topics save --stdin`
- `kirevo topics delete <topic-id-or-slug>`
- `kirevo topics create-from-link --source <topic-id> --target <slug>`
- `kirevo context get <topic-id-or-slug>`
- `kirevo graph show`
- `kirevo import preview <url>`
- `kirevo import run <url>`
- `kirevo index rebuild`

### 11.4 出力契約

- success: `{ "ok": true, ... }`
- failure: `{ "ok": false, "error": { "code": "...", "message": "..." } }`
- exit code
  - `0`: success
  - `2`: validation error
  - `3`: not found
  - `4`: conflict
  - `5`: internal error

### 11.5 agent 向け重要操作

- `topics list`: 候補 topic の抽出
- `topics read`: 単一 topic の安定取得
- `context get`: 関連 topic を束ねた context bundle の取得
- `import preview` / `import run`: Web knowledge ingestion
- `index rebuild`: 外部編集後の明示同期

### 11.6 実装メモ

- `src/cli.mjs`: CLI entrypoint
- `src/lib/cli-parser.mjs`: 引数解析
- package `bin` で `kirevo` コマンドを公開
- 保存系は Markdown raw input を優先し、frontmatter 付き `.md` をそのまま ingest できるようにする

## 12. 次にやるべきこと

次のターンでは Phase 0 と Phase 1 をまとめて着手し、まず topic CRUD が動く縦切りを作るのが適切です。ここが通れば、以降の indexer, graph, ingestion は積み上げで実装できます。
