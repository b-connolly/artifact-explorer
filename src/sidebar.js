import { MUSEUMS } from "./museums.js";

let sidebarEl = null;
let layerRef = null;
let currentCountry = null;
let currentTimeRange = null;
let currentMuseumId = null;

function formatYear(y) {
  if (y == null) return "";
  const abs = Math.abs(y);
  if (abs >= 10000) return `${(abs / 1000).toFixed(0)}k ${y < 0 ? "BC" : "AD"}`;
  if (y < 0) return `${abs} BC`;
  if (y === 0) return "1 AD";
  return `${abs} AD`;
}

export function initSidebar(layer) {
  layerRef = layer;

  sidebarEl = document.createElement("div");
  sidebarEl.id = "sidebar";
  sidebarEl.innerHTML = `
    <button id="sidebar-close" aria-label="Close sidebar">&times;</button>
    <div id="sidebar-header">
      <h2 id="sidebar-title"></h2>
      <div id="sidebar-stats">
        <span id="sidebar-count"></span>
        <span id="sidebar-time-range"></span>
      </div>
    </div>
    <div id="sidebar-search">
      <input type="text" id="sidebar-search-input" placeholder="Search artifacts..." autocomplete="off" />
      <button id="sidebar-search-clear" aria-label="Clear search">&times;</button>
    </div>
    <div id="sidebar-content"></div>
  `;
  document.body.appendChild(sidebarEl);

  document.getElementById("sidebar-close").addEventListener("click", closeSidebar);

  // Clear search button
  document.getElementById("sidebar-search-clear").addEventListener("click", () => {
    const input = document.getElementById("sidebar-search-input");
    input.value = "";
    renderSidebar();
  });

  // Search with debounce
  let searchTimer = null;
  document.getElementById("sidebar-search-input").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    const query = e.target.value.trim();
    searchTimer = setTimeout(() => {
      if (query.length >= 2) {
        searchArtifacts(query);
      } else if (query.length === 0) {
        renderSidebar();
      }
    }, 300);
  });
}

export function setMuseumFilter(museumId) {
  currentMuseumId = museumId;
  if (currentCountry && sidebarEl.classList.contains("open")) {
    renderSidebar();
  }
}

export function setTimeFilter(lo, hi) {
  currentTimeRange = (lo != null && hi != null) ? { lo, hi } : null;
  if (currentCountry && sidebarEl.classList.contains("open")) {
    renderSidebar();
  }
}

export function openSidebar(countryName, highlightId, museumOverride) {
  currentCountry = countryName;
  // Only clear search and re-render if not mid-search
  const searchInput = document.getElementById("sidebar-search-input");
  const isSearching = searchInput && searchInput.value.trim().length >= 2;
  if (!isSearching) {
    if (searchInput) searchInput.value = "";
    renderSidebar(highlightId, museumOverride);
  }
  sidebarEl.classList.add("open");
}

async function renderSidebar(highlightId, museumOverride) {
  if (!layerRef || !currentCountry) return;

  const parts = [`country = '${currentCountry.replace(/'/g, "''")}'`];
  const museumToFilter = museumOverride || currentMuseumId;
  if (museumToFilter && museumToFilter !== "all") {
    parts.push(`museum_id = '${museumToFilter}'`);
  }
  if (currentTimeRange) {
    parts.push(`year_end >= ${currentTimeRange.lo} AND year_start <= ${currentTimeRange.hi}`);
  }

  const where = parts.join(" AND ");
  const content = document.getElementById("sidebar-content");
  content.innerHTML = `<div style="color:#666;padding:20px;text-align:center">Loading...</div>`;

  // Get true count first (not capped by maxRecordCount)
  const totalCount = await layerRef.queryFeatureCount({ where });

  // Get artifacts for display (cap at 200 for sidebar performance)
  const result = await layerRef.queryFeatures({
    where,
    outFields: ["artifact_id", "title", "image_url", "original_image_url", "museum_id", "date_range", "year_start", "year_end"],
    returnGeometry: false,
    maxRecordCount: 200,
  });

  const countryArtifacts = result.features
    .map((f) => f.attributes)
    .filter((a) => a.image_url); // Only show artifacts with images

  document.getElementById("sidebar-title").textContent = currentCountry;
  document.getElementById("sidebar-count").textContent =
    `${totalCount.toLocaleString()} artifact${totalCount !== 1 ? "s" : ""}`;

  // Date range — filter out default/extreme values
  const years = countryArtifacts
    .filter((a) => a.year_start != null)
    .flatMap((a) => [a.year_start, a.year_end]);
  if (years.length) {
    const minY = Math.min(...years);
    const maxY = Math.max(...years);
    document.getElementById("sidebar-time-range").textContent =
      `${formatYear(minY)} – ${formatYear(maxY)}`;
  } else {
    document.getElementById("sidebar-time-range").textContent = "";
  }

  content.innerHTML = "";

  const byMuseum = Object.groupBy(countryArtifacts, (a) => a.museum_id);

  for (const [museumId, artifacts] of Object.entries(byMuseum)) {
    const museum = MUSEUMS[museumId];
    if (!museum) continue;
    const color = museum.color.join(",");

    const section = document.createElement("div");
    section.className = "sidebar-museum-section";
    section.innerHTML = `
      <div class="sidebar-museum-header">
        <span class="sidebar-museum-badge" style="background:rgb(${color})"></span>
        <span class="sidebar-museum-name">${museum.name}</span>
        <span class="sidebar-museum-count">${artifacts.length}${artifacts.length >= 200 ? "+" : ""}</span>
      </div>
      <div class="sidebar-grid"></div>
    `;

    const grid = section.querySelector(".sidebar-grid");
    for (const artifact of artifacts) {
      const isSelected = highlightId && (artifact.artifact_id === highlightId || artifact.id === highlightId);
      const thumb = document.createElement("div");
      thumb.className = "sidebar-thumb" + (isSelected ? " selected" : "");
      thumb.dataset.id = artifact.artifact_id || artifact.id;

      const img = document.createElement("img");
      img.src = artifact.original_image_url || artifact.image_url;
      img.alt = "";
      img.loading = "lazy";
      // Hide broken images
      img.onerror = () => { thumb.style.display = "none"; };
      thumb.appendChild(img);
      grid.appendChild(thumb);
    }

    content.appendChild(section);
  }

  if (countryArtifacts.length === 0) {
    content.innerHTML = `<div style="color:#666;padding:20px;text-align:center">No artifacts with images</div>`;
  }

  // Scroll highlighted artifact into view
  if (highlightId) {
    const el = content.querySelector(`.sidebar-thumb.selected`);
    if (el) {
      requestAnimationFrame(() => el.scrollIntoView({ block: "center", behavior: "smooth" }));
    }
  }
}

async function searchArtifacts(query) {
  if (!layerRef) return;

  const content = document.getElementById("sidebar-content");
  content.innerHTML = `<div style="color:#666;padding:20px;text-align:center">Searching...</div>`;

  const escaped = query.replace(/'/g, "''").replace(/%/g, "\\%");
  const parts = [`title LIKE '%${escaped}%'`];

  if (currentCountry) {
    parts.push(`country = '${currentCountry.replace(/'/g, "''")}'`);
  }
  const museumToFilter = currentMuseumId;
  if (museumToFilter && museumToFilter !== "all") {
    if (Array.isArray(museumToFilter)) {
      parts.push(`museum_id IN (${museumToFilter.map(id => `'${id}'`).join(",")})`);
    } else {
      parts.push(`museum_id = '${museumToFilter}'`);
    }
  }
  if (currentTimeRange) {
    parts.push(`year_end >= ${currentTimeRange.lo} AND year_start <= ${currentTimeRange.hi}`);
  }

  const where = parts.join(" AND ");

  const result = await layerRef.queryFeatures({
    where,
    outFields: ["artifact_id", "title", "image_url", "original_image_url", "museum_id", "date_range", "year_start", "year_end", "country"],
    returnGeometry: false,
    maxRecordCount: 100,
  });

  const artifacts = result.features
    .map((f) => f.attributes)
    .filter((a) => a.image_url);

  // Update header for search mode
  document.getElementById("sidebar-title").textContent = currentCountry || "Search Results";
  document.getElementById("sidebar-count").textContent =
    `${artifacts.length} result${artifacts.length !== 1 ? "s" : ""}`;
  document.getElementById("sidebar-time-range").textContent = "";

  content.innerHTML = "";

  if (artifacts.length === 0) {
    const noResults = document.createElement("div");
    noResults.style.cssText = "color:#666;padding:20px;text-align:center";
    noResults.textContent = `No artifacts matching "${query}"`;
    content.appendChild(noResults);
    return;
  }

  const byMuseum = Object.groupBy(artifacts, (a) => a.museum_id);

  for (const [museumId, museumArtifacts] of Object.entries(byMuseum)) {
    const museum = MUSEUMS[museumId];
    if (!museum) continue;
    const color = museum.color.join(",");

    const section = document.createElement("div");
    section.className = "sidebar-museum-section";
    section.innerHTML = `
      <div class="sidebar-museum-header">
        <span class="sidebar-museum-badge" style="background:rgb(${color})"></span>
        <span class="sidebar-museum-name">${museum.name}</span>
        <span class="sidebar-museum-count">${museumArtifacts.length}</span>
      </div>
      <div class="sidebar-search-results"></div>
    `;

    const list = section.querySelector(".sidebar-search-results");
    for (const artifact of museumArtifacts) {
      const item = document.createElement("div");
      item.className = "sidebar-search-item";
      item.dataset.id = artifact.artifact_id;

      const img = document.createElement("img");
      img.src = artifact.original_image_url || artifact.image_url;
      img.alt = "";
      img.loading = "lazy";
      img.onerror = () => { item.style.display = "none"; };

      const info = document.createElement("div");
      info.className = "sidebar-search-info";
      const titleDiv = document.createElement("div");
      titleDiv.className = "sidebar-search-title";
      titleDiv.textContent = artifact.title || "Untitled";
      const metaDiv = document.createElement("div");
      metaDiv.className = "sidebar-search-meta";
      metaDiv.textContent = (artifact.country || "") + (artifact.date_range ? " · " + artifact.date_range : "");
      info.appendChild(titleDiv);
      info.appendChild(metaDiv);

      item.appendChild(img);
      item.appendChild(info);
      list.appendChild(item);
    }

    content.appendChild(section);
  }
}

export function closeSidebar() {
  sidebarEl.classList.remove("open");
  currentCountry = null;
}
