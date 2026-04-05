import path from "node:path";

export const ROOT_DIR = path.resolve(process.cwd());
export const DATA_DIR = path.join(ROOT_DIR, "data");
export const MEMORY_DIR = path.join(DATA_DIR, "memory");
export const TOPICS_DIR = path.join(MEMORY_DIR, "topics");
export const KIREVO_DIR = path.join(MEMORY_DIR, ".kirevo");
export const LOGS_DIR = path.join(KIREVO_DIR, "logs");
export const INGEST_DIR = path.join(KIREVO_DIR, "ingest");
export const INGEST_RAW_DIR = path.join(INGEST_DIR, "raw");
export const INGEST_NORMALIZED_DIR = path.join(INGEST_DIR, "normalized");
export const INDEX_PATH = path.join(KIREVO_DIR, "index.json");
export const EVENTS_PATH = path.join(KIREVO_DIR, "events.json");
export const SETTINGS_PATH = path.join(KIREVO_DIR, "settings.json");
