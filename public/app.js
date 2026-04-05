const state = {
  topics: [],
  selectedTopicId: null,
  graph: { nodes: [], edges: [] }
};

const elements = {
  topicList: document.querySelector("#topic-list"),
  graphCanvas: document.querySelector("#graph-canvas"),
  searchInput: document.querySelector("#search-input"),
  titleInput: document.querySelector("#title-input"),
  slugInput: document.querySelector("#slug-input"),
  summaryInput: document.querySelector("#summary-input"),
  tagsInput: document.querySelector("#tags-input"),
  pinnedInput: document.querySelector("#pinned-input"),
  bodyInput: document.querySelector("#body-input"),
  metadataList: document.querySelector("#metadata-list"),
  backlinksList: document.querySelector("#backlinks-list"),
  contextPanel: document.querySelector("#context-panel"),
  editorTitle: document.querySelector("#editor-title"),
  importUrlInput: document.querySelector("#import-url-input"),
  importPreview: document.querySelector("#import-preview")
};

document.querySelector("#new-topic-button").addEventListener("click", () => {
  loadEditor({
    frontmatter: {
      id: "",
      title: "Untitled Topic",
      slug: "",
      summary: "",
      tags: [],
      pinned: false
    },
    body: "# Untitled Topic\n\n## Summary\n"
  });
});

document.querySelector("#save-button").addEventListener("click", saveCurrentTopic);
document.querySelector("#reindex-button").addEventListener("click", async () => {
  await fetchJson("/api/reindex", { method: "POST" });
  await refresh();
});
document.querySelector("#preview-import-button").addEventListener("click", previewImport);
document.querySelector("#run-import-button").addEventListener("click", runImport);
elements.searchInput.addEventListener("input", refresh);
elements.titleInput.addEventListener("input", () => {
  elements.editorTitle.textContent = elements.titleInput.value || "Untitled Topic";
});

await refresh();

async function refresh() {
  const query = elements.searchInput.value.trim();
  const topicsResponse = await fetchJson(`/api/topics?query=${encodeURIComponent(query)}`);
  state.topics = topicsResponse.items;
  renderTopicList();

  state.graph = await fetchJson(`/api/graph?query=${encodeURIComponent(query)}`);
  renderGraph();

  if (state.selectedTopicId) {
    const selectedStillExists = state.topics.some((topic) => topic.id === state.selectedTopicId);
    if (selectedStillExists) {
      await selectTopic(state.selectedTopicId);
      return;
    }
  }

  if (state.topics[0]) {
    await selectTopic(state.topics[0].id);
  }
}

async function selectTopic(topicId) {
  state.selectedTopicId = topicId;
  renderTopicList();
  const topic = await fetchJson(`/api/topics/${encodeURIComponent(topicId)}`);
  loadEditor(topic);
  const context = await fetchJson(`/api/context?topicId=${encodeURIComponent(topicId)}`);
  elements.contextPanel.textContent = JSON.stringify(context, null, 2);
}

function loadEditor(topic) {
  const frontmatter = topic.frontmatter ?? {};
  elements.titleInput.value = frontmatter.title ?? "";
  elements.slugInput.value = frontmatter.slug ?? "";
  elements.summaryInput.value = frontmatter.summary ?? "";
  elements.tagsInput.value = Array.isArray(frontmatter.tags) ? frontmatter.tags.join(", ") : "";
  elements.pinnedInput.checked = Boolean(frontmatter.pinned);
  elements.bodyInput.value = topic.body ?? "";
  elements.editorTitle.textContent = frontmatter.title ?? "Untitled Topic";
  elements.metadataList.innerHTML = "";
  const metadata = topic.metadata ?? frontmatter;
  for (const [key, value] of Object.entries({
    id: metadata.id,
    slug: metadata.slug,
    layer: metadata.layer,
    source_type: metadata.source_type,
    updated_at: metadata.updated_at,
    read_count: metadata.read_count,
    inbound: metadata.inbound_link_count,
    outbound: metadata.outbound_link_count
  })) {
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = value ?? "-";
    elements.metadataList.append(dt, dd);
  }

  elements.backlinksList.innerHTML = "";
  for (const backlink of topic.backlinks ?? []) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.className = "ghost-button";
    button.textContent = backlink.title;
    button.addEventListener("click", () => selectTopic(backlink.id));
    item.append(button);
    elements.backlinksList.append(item);
  }
}

function renderTopicList() {
  elements.topicList.innerHTML = "";
  for (const topic of state.topics) {
    const card = document.createElement("button");
    card.className = `topic-item ${topic.id === state.selectedTopicId ? "is-active" : ""}`;
    card.addEventListener("click", () => selectTopic(topic.id));
    card.innerHTML = `
      <h3>${escapeHtml(topic.title)}</h3>
      <p>${escapeHtml(topic.summary ?? "")}</p>
      <div class="topic-meta-row">
        <span class="badge layer-${topic.layer}">L${topic.layer}</span>
        <span class="badge">${escapeHtml(topic.source_type)}</span>
        <span class="badge">${escapeHtml(topic.slug)}</span>
      </div>
    `;
    elements.topicList.append(card);
  }
}

function renderGraph() {
  const svg = elements.graphCanvas;
  svg.innerHTML = "";
  const nodeById = new Map(state.graph.nodes.map((node) => [node.id, node]));

  for (const edge of state.graph.edges) {
    const from = nodeById.get(edge.source);
    const to = nodeById.get(edge.target);
    if (!from || !to) {
      continue;
    }
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", from.x);
    line.setAttribute("y1", from.y);
    line.setAttribute("x2", to.x);
    line.setAttribute("y2", to.y);
    line.setAttribute("stroke", "rgba(60, 43, 20, 0.22)");
    line.setAttribute("stroke-width", "2");
    svg.append(line);
  }

  for (const node of state.graph.nodes) {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.style.cursor = "pointer";
    group.addEventListener("click", () => selectTopic(node.id));

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", node.x);
    circle.setAttribute("cy", node.y);
    circle.setAttribute("r", "26");
    circle.setAttribute("fill", layerColor(node.layer));
    circle.setAttribute("stroke", "rgba(36, 31, 24, 0.12)");
    circle.setAttribute("stroke-width", "2");
    group.append(circle);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", node.x);
    text.setAttribute("y", node.y + 44);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("font-size", "12");
    text.textContent = node.label.slice(0, 18);
    group.append(text);

    svg.append(group);
  }
}

async function saveCurrentTopic() {
  const payload = {
    frontmatter: {
      id: state.selectedTopicId || undefined,
      title: elements.titleInput.value.trim(),
      slug: elements.slugInput.value.trim(),
      summary: elements.summaryInput.value.trim(),
      tags: elements.tagsInput.value,
      pinned: elements.pinnedInput.checked
    },
    body: elements.bodyInput.value
  };

  const saved = await fetchJson("/api/topics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  state.selectedTopicId = saved.id;
  await refresh();
}

async function previewImport() {
  const url = elements.importUrlInput.value.trim();
  if (!url) {
    return;
  }
  const preview = await fetchJson("/api/import/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url })
  });
  elements.importPreview.textContent = JSON.stringify(preview, null, 2);
}

async function runImport() {
  const url = elements.importUrlInput.value.trim();
  if (!url) {
    return;
  }
  const result = await fetchJson("/api/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, mode: "update-if-exists" })
  });
  elements.importPreview.textContent = JSON.stringify(result, null, 2);
  await refresh();
  if (result.topicId) {
    await selectTopic(result.topicId);
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error || "Request failed");
  }
  return json;
}

function escapeHtml(value) {
  return `${value}`
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function layerColor(layer) {
  if (layer === 1) return "#c84d31";
  if (layer === 2) return "#df8f38";
  if (layer === 3) return "#7d9663";
  return "#7a7f96";
}
