import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "./fs-utils.mjs";
import { getIndex, saveTopic } from "./store.mjs";
import { INGEST_NORMALIZED_DIR, INGEST_RAW_DIR, INDEX_PATH } from "./paths.mjs";
import { readJsonFile } from "./fs-utils.mjs";
import { slugifyTitle } from "./topic-format.mjs";

export async function previewWebImport({ url }) {
  validateUrl(url);
  const index = await getIndex();
  const duplicate = index.topics.find((topic) => topic.source_url === url);
  const fetched = await fetchPage(url);
  const markdown = htmlToMarkdown(fetched.html, fetched.finalUrl);
  return {
    title: fetched.title,
    siteName: siteNameFromUrl(fetched.finalUrl),
    extractedMarkdown: markdown,
    summary: markdown.replace(/\s+/g, " ").trim().slice(0, 180),
    duplicateTopicId: duplicate?.id ?? null
  };
}

export async function importWebPage({
  url,
  mode = "create",
  saveRawHtml = true,
  saveNormalizedArtifacts = true
}) {
  validateUrl(url);
  const index = await getIndex();
  const duplicate = index.topics.find((topic) => topic.source_url === url);
  if (duplicate && mode === "create") {
    return {
      topicId: duplicate.id,
      path: duplicate.path,
      status: "duplicate",
      sourceUrl: url,
      title: duplicate.title
    };
  }

  const fetched = await fetchPage(url);
  const markdown = htmlToMarkdown(fetched.html, fetched.finalUrl);
  const title = fetched.title || "Imported Web Topic";
  const slug = slugifyTitle(`${siteNameFromUrl(fetched.finalUrl)}-${title}`);
  const hash = `sha256:${crypto.createHash("sha256").update(markdown).digest("hex")}`;
  const now = new Date().toISOString();
  const body = [
    `# ${title}`,
    "",
    "## Source",
    `- URL: ${fetched.finalUrl}`,
    `- Site: ${siteNameFromUrl(fetched.finalUrl)}`,
    `- Fetched At: ${now}`,
    "",
    "## Summary",
    markdown.replace(/\s+/g, " ").trim().slice(0, 180),
    "",
    "## Content",
    markdown.trim()
  ].join("\n");

  let existingFrontmatter = undefined;
  if (duplicate && mode === "update-if-exists") {
    existingFrontmatter = {
      id: duplicate.id,
      slug: duplicate.slug,
      created_at: duplicate.created_at,
      read_count: duplicate.read_count
    };
  }

  const saved = await saveTopic({
    frontmatter: {
      ...existingFrontmatter,
      title,
      slug: existingFrontmatter?.slug ?? slug,
      summary: markdown.replace(/\s+/g, " ").trim().slice(0, 180),
      tags: buildTags(fetched.finalUrl, title),
      source_type: "web",
      source_url: fetched.finalUrl,
      site_name: siteNameFromUrl(fetched.finalUrl),
      source_hash: hash,
      fetched_at: now,
      author: fetched.author ?? null
    },
    body
  });

  if (saveRawHtml) {
    await atomicWriteFile(
      path.join(INGEST_RAW_DIR, `${saved.slug}.html`),
      fetched.html
    );
  }
  if (saveNormalizedArtifacts) {
    await atomicWriteFile(
      path.join(INGEST_NORMALIZED_DIR, `${saved.slug}.md`),
      markdown
    );
  }

  const currentIndex = await readJsonFile(INDEX_PATH, {
    generated_at: null,
    topics: [],
    links: [],
    sections: [],
    fetches: []
  });
  currentIndex.fetches.push({
    id: crypto.randomUUID(),
    source_type: "web",
    source_url: url,
    site_name: siteNameFromUrl(fetched.finalUrl),
    request_url: url,
    final_url: fetched.finalUrl,
    status: duplicate && mode === "update-if-exists" ? "updated" : "created",
    http_status: fetched.status,
    content_type: fetched.contentType,
    raw_path: saveRawHtml ? path.join(INGEST_RAW_DIR, `${saved.slug}.html`) : null,
    normalized_path: saveNormalizedArtifacts
      ? path.join(INGEST_NORMALIZED_DIR, `${saved.slug}.md`)
      : null,
    extracted_title: title,
    extracted_author: fetched.author ?? null,
    extracted_summary: markdown.replace(/\s+/g, " ").trim().slice(0, 180),
    source_hash: hash,
    error_message: null,
    created_at: now
  });
  await atomicWriteFile(INDEX_PATH, JSON.stringify(currentIndex, null, 2));

  return {
    topicId: saved.id,
    path: saved.path,
    status: duplicate && mode === "update-if-exists" ? "updated" : "created",
    sourceUrl: fetched.finalUrl,
    title
  };
}

function validateUrl(url) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http/https URLs are supported");
  }
}

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Kirevo/0.1"
    }
  });
  const html = await response.text();
  const title =
    matchTag(html, "title") ||
    matchHeading(html) ||
    new URL(response.url).hostname;
  return {
    finalUrl: response.url,
    title: decodeHtmlEntities(title),
    html,
    status: response.status,
    contentType: response.headers.get("content-type"),
    author: extractMetaContent(html, "author")
  };
}

function htmlToMarkdown(html, baseUrl) {
  const bodyHtml = stripNonContent(html);
  const withBlocks = bodyHtml
    .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, code) => {
      return `\n\`\`\`\n${decodeHtmlEntities(stripTags(code)).trim()}\n\`\`\`\n`;
    })
    .replace(/<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi, (_, tag, content) => {
      const level = Number(tag.slice(1));
      return `\n${"#".repeat(level)} ${decodeHtmlEntities(stripTags(content)).trim()}\n`;
    })
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, content) => {
      return `\n- ${decodeHtmlEntities(stripTags(content)).trim()}`;
    })
    .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, content) => {
      const absoluteHref = toAbsoluteUrl(baseUrl, href);
      const label = decodeHtmlEntities(stripTags(content)).trim() || absoluteHref;
      return `[${label}](${absoluteHref})`;
    })
    .replace(/<(p|div|section|article|main|blockquote)[^>]*>/gi, "\n")
    .replace(/<\/(p|div|section|article|main|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");

  const markdown = decodeHtmlEntities(stripTags(withBlocks))
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

  return markdown || "Content extraction failed. Source URL retained for reference.";
}

function stripNonContent(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
}

function stripTags(value) {
  return value.replace(/<[^>]+>/g, " ");
}

function matchTag(html, tagName) {
  const match = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i").exec(html);
  return match ? match[1].trim() : "";
}

function matchHeading(html) {
  const match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  return match ? stripTags(match[1]).trim() : "";
}

function extractMetaContent(html, name) {
  const regex = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i");
  const match = regex.exec(html);
  return match ? decodeHtmlEntities(match[1].trim()) : null;
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function siteNameFromUrl(url) {
  const hostname = new URL(url).hostname.replace(/^www\./, "");
  return hostname
    .split(".")
    .slice(0, -1)
    .join(".") || hostname;
}

function toAbsoluteUrl(baseUrl, href) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

function buildTags(url, title) {
  const hostname = new URL(url).hostname.replace(/^www\./, "");
  const candidates = [hostname.split(".")[0], ...title.toLowerCase().split(/[^a-z0-9]+/g)];
  return [...new Set(candidates.filter(Boolean))].slice(0, 5);
}
