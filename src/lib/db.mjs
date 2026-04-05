import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { DB_PATH } from "./paths.mjs";

const execFileAsync = promisify(execFile);
let databaseReadyPromise;

export async function initializeDatabase() {
  if (!databaseReadyPromise) {
    databaseReadyPromise = initializeDatabaseOnce().catch((error) => {
      databaseReadyPromise = null;
      throw error;
    });
  }
  await databaseReadyPromise;
}

async function initializeDatabaseOnce() {
  let exists = true;
  try {
    await fs.access(DB_PATH);
  } catch {
    exists = false;
  }

  if (exists) {
    return;
  }

  await runSql(`
    CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      summary TEXT,
      body TEXT,
      layer INTEGER NOT NULL DEFAULT 4,
      manual_layer INTEGER,
      pinned INTEGER NOT NULL DEFAULT 0,
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_url TEXT,
      canonical_url TEXT,
      site_name TEXT,
      source_hash TEXT,
      author TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      fetched_at TEXT,
      last_read_at TEXT,
      read_count INTEGER NOT NULL DEFAULT 0,
      write_count INTEGER NOT NULL DEFAULT 0,
      inbound_link_count INTEGER NOT NULL DEFAULT 0,
      outbound_link_count INTEGER NOT NULL DEFAULT 0,
      score REAL NOT NULL DEFAULT 0,
      file_mtime TEXT
    );

    CREATE TABLE IF NOT EXISTS topic_tags (
      topic_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (topic_id, tag),
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS topic_links (
      from_topic_id TEXT NOT NULL,
      to_topic_id TEXT NOT NULL,
      link_type TEXT NOT NULL DEFAULT 'wiki',
      created_at TEXT NOT NULL,
      PRIMARY KEY (from_topic_id, to_topic_id, link_type),
      FOREIGN KEY (from_topic_id) REFERENCES topics(id) ON DELETE CASCADE,
      FOREIGN KEY (to_topic_id) REFERENCES topics(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS topic_sections (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL,
      ord INTEGER NOT NULL,
      heading TEXT,
      level INTEGER,
      content TEXT NOT NULL,
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS topic_events (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_id TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS source_fetches (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_url TEXT NOT NULL,
      canonical_url TEXT,
      site_name TEXT,
      request_url TEXT,
      final_url TEXT,
      status TEXT NOT NULL,
      http_status INTEGER,
      content_type TEXT,
      raw_path TEXT,
      normalized_path TEXT,
      extracted_title TEXT,
      extracted_author TEXT,
      extracted_summary TEXT,
      source_hash TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS topic_sections_fts USING fts5(
      topic_id UNINDEXED,
      heading,
      content
    );
  `);
}

export async function runSql(sql) {
  await execFileAsync(
    "sqlite3",
    ["-cmd", ".timeout 5000", "-cmd", "PRAGMA foreign_keys = ON;", DB_PATH, sql],
    { maxBuffer: 20 * 1024 * 1024 }
  );
}

export async function queryJson(sql) {
  const { stdout } = await execFileAsync(
    "sqlite3",
    ["-cmd", ".timeout 5000", "-cmd", "PRAGMA foreign_keys = ON;", "-json", DB_PATH, sql],
    { maxBuffer: 20 * 1024 * 1024 }
  );
  const trimmed = stdout.trim();
  return trimmed ? JSON.parse(trimmed) : [];
}

export function sqlString(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function sqlBoolean(value) {
  return value ? "1" : "0";
}

export function sqlNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? String(Number(value)) : String(fallback);
}
