import crypto from "node:crypto";

const FRONTMATTER_BOUNDARY = "---";

export function parseTopicFile(raw) {
  let frontmatter = {};
  let body = raw;

  if (raw.startsWith(`${FRONTMATTER_BOUNDARY}\n`)) {
    const closingIndex = raw.indexOf(`\n${FRONTMATTER_BOUNDARY}\n`, FRONTMATTER_BOUNDARY.length + 1);
    if (closingIndex !== -1) {
      const frontmatterBlock = raw.slice(
        FRONTMATTER_BOUNDARY.length + 1,
        closingIndex
      );
      body = raw.slice(closingIndex + `\n${FRONTMATTER_BOUNDARY}\n`.length);
      frontmatter = parseFrontmatterBlock(frontmatterBlock);
    }
  }

  return {
    frontmatter,
    body: body.trim()
  };
}

export function serializeTopic(topic) {
  const frontmatter = serializeFrontmatterBlock(topic.frontmatter);
  const body = `${topic.body ?? ""}`.trim();
  return `---\n${frontmatter}\n---\n\n${body}\n`;
}

export function parseFrontmatterBlock(block) {
  const result = {};
  const lines = block.split("\n");

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    result[key] = parseScalar(value);
  }

  return result;
}

export function serializeFrontmatterBlock(frontmatter) {
  return Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${formatScalar(value)}`)
    .join("\n");
}

function parseScalar(value) {
  if (value === "null") {
    return null;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) {
      return [];
    }
    return inner
      .split(",")
      .map((item) => item.trim())
      .map((item) => unquote(item));
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return unquote(value);
}

function formatScalar(value) {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => quoteIfNeeded(item)).join(", ")}]`;
  }
  return quoteIfNeeded(value);
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function quoteIfNeeded(value) {
  const stringValue = `${value}`;
  if (/^[A-Za-z0-9._:/+-]+$/.test(stringValue)) {
    return stringValue;
  }
  return JSON.stringify(stringValue);
}

export function slugifyTitle(title) {
  const normalized = `${title}`
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  if (normalized) {
    return normalized;
  }

  const now = new Date();
  const stamp = now
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  return `topic-${stamp}`;
}

export function buildDefaultFrontmatter(input = {}) {
  const now = new Date().toISOString();
  const title = input.title ?? "Untitled Topic";
  const slug = input.slug ?? slugifyTitle(title);
  return {
    id: input.id ?? `topic-${slug}`,
    slug,
    title,
    summary: input.summary ?? "",
    tags: input.tags ?? [],
    pinned: input.pinned ?? false,
    manual_layer: input.manual_layer ?? null,
    created_at: input.created_at ?? now,
    updated_at: input.updated_at ?? now,
    last_read_at: input.last_read_at ?? null,
    source_type: input.source_type ?? "manual",
    source_url: input.source_url ?? null,
    site_name: input.site_name ?? null,
    source_hash: input.source_hash ?? null,
    fetched_at: input.fetched_at ?? null,
    author: input.author ?? null
  };
}

export function extractWikiLinks(markdown) {
  const links = [];
  const regex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    links.push({
      target: match[1].trim(),
      label: match[2] ? match[2].trim() : null
    });
  }
  return links;
}

export function extractSections(markdown) {
  const lines = markdown.split("\n");
  const sections = [];
  let current = {
    heading: null,
    level: 0,
    content: []
  };

  function pushCurrent() {
    if (!current.content.length && !current.heading) {
      return;
    }
    sections.push({
      id: crypto.randomUUID(),
      heading: current.heading,
      level: current.level,
      content: current.content.join("\n").trim()
    });
  }

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    if (match) {
      pushCurrent();
      current = {
        heading: match[2].trim(),
        level: match[1].length,
        content: []
      };
      continue;
    }
    current.content.push(line);
  }

  pushCurrent();
  return sections.filter((section) => section.content || section.heading);
}

export function summarizeBody(body) {
  const cleaned = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, "$2$1")
    .replace(/[#>*`-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 180);
}
