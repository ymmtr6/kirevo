import fs from "node:fs/promises";
import path from "node:path";
import {
  INGEST_NORMALIZED_DIR,
  INGEST_RAW_DIR,
  KIREVO_DIR,
  LOGS_DIR,
  MEMORY_DIR,
  SETTINGS_PATH,
  TOPICS_DIR
} from "./paths.mjs";

export async function ensureAppDirs() {
  await fs.mkdir(MEMORY_DIR, { recursive: true });
  await fs.mkdir(TOPICS_DIR, { recursive: true });
  await fs.mkdir(KIREVO_DIR, { recursive: true });
  await fs.mkdir(LOGS_DIR, { recursive: true });
  await fs.mkdir(INGEST_RAW_DIR, { recursive: true });
  await fs.mkdir(INGEST_NORMALIZED_DIR, { recursive: true });
  await ensureJsonFile(SETTINGS_PATH, { port: 4312 });
}

export async function ensureJsonFile(filePath, initialValue) {
  try {
    await fs.access(filePath);
  } catch {
    await atomicWriteFile(filePath, JSON.stringify(initialValue, null, 2));
  }
}

export async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function atomicWriteFile(filePath, content) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  await fs.writeFile(tmpPath, content, "utf8");
  await fs.rename(tmpPath, filePath);
}

export async function listMarkdownFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(dirPath, entry.name))
    .sort();
}
