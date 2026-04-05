import http from "node:http";
import nodeFs from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraph, rebuildIndex } from "./lib/indexer.mjs";
import { initializeStore, listTopics, readTopic, readTopicContext, saveTopic, getIndex } from "./lib/store.mjs";
import { importWebPage, previewWebImport } from "./lib/web-import.mjs";
import { TOPICS_DIR } from "./lib/paths.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const PORT = Number(process.env.PORT || 4312);

await initializeStore();
await rebuildIndex();

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Kirevo running at http://localhost:${PORT}`);
});

let watchTimer = null;
nodeFs.watch(TOPICS_DIR, () => {
  clearTimeout(watchTimer);
  watchTimer = setTimeout(() => {
    rebuildIndex().catch((error) => {
      console.error("Reindex failed", error);
    });
  }, 120);
});

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/topics") {
    const result = await listTopics({
      query: url.searchParams.get("query") ?? undefined
    });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/topics/")) {
    const topicId = decodeURIComponent(url.pathname.split("/").pop());
    const result = await readTopic(topicId);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/topics") {
    const body = await readBody(req);
    const result = await saveTopic(body);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/graph") {
    const index = await getIndex();
    const graph = buildGraph(index, {
      query: url.searchParams.get("query") ?? undefined
    });
    sendJson(res, 200, graph);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/context") {
    const topicId = url.searchParams.get("topicId");
    const result = await readTopicContext({ topicId });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import/preview") {
    const body = await readBody(req);
    const result = await previewWebImport(body);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import") {
    const body = await readBody(req);
    const result = await importWebPage(body);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/reindex") {
    const result = await rebuildIndex();
    sendJson(res, 200, { generated_at: result.generated_at, topics: result.topics.length });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function serveStatic(req, res) {
  let requestPath = req.url === "/" ? "/index.html" : req.url;
  requestPath = requestPath.split("?")[0];
  const targetPath = path.join(PUBLIC_DIR, requestPath);

  if (!targetPath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  try {
    const content = await fs.readFile(targetPath);
    res.writeHead(200, { "content-type": contentTypeFor(targetPath) });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function contentTypeFor(filePath) {
  if (filePath.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (filePath.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}
