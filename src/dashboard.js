/**
 * dashboard.js — Stats dashboard with 3 panels:
 *   1. Top countries bar chart
 *   2. Timeline histogram (artifact density by century)
 *   3. Museum × continent heatmap
 *
 * All data comes from queryLayer outStatistics queries.
 * Panels update when filters change. Debounced for time slider.
 */

import { MUSEUMS } from "./museums.js";
import { MUSEUM_COLORS } from "./layers.js";
import { buildWhere } from "./filters.js";

function esc(s) { return s ? String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;") : ""; }

let queryLayer = null;
let callbacks = {};
let debounceTimer = null;
let dashboardEl = null;
let lastMuseumWhere = null;

// --- Continent mapping for heatmap ---
export const CONTINENT_MAP = {
  "Egypt": "Africa", "Iraq": "Middle East", "Iran": "Middle East",
  "Turkey": "Middle East", "Syria": "Middle East", "Lebanon": "Middle East",
  "Jordan": "Middle East", "Israel": "Middle East", "Cyprus": "Middle East",
  "Afghanistan": "Asia",
  "China": "Asia", "Japan": "Asia", "Korea": "Asia",
  "Mongolia": "Asia",
  "India": "Asia", "Pakistan": "Asia", "Sri Lanka": "Asia",
  "Nepal": "Asia", "Bangladesh": "Asia",
  "Cambodia": "Asia", "Thailand": "Asia",
  "Indonesia": "Asia", "Vietnam": "Asia",
  "Myanmar": "Asia", "Philippines": "Asia",
  "Malaysia": "Asia",
  "Greece": "Europe", "Italy": "Europe", "France": "Europe",
  "United Kingdom": "Europe", "Germany": "Europe", "Spain": "Europe",
  "Netherlands": "Europe", "Belgium": "Europe", "Austria": "Europe",
  "Switzerland": "Europe", "Sweden": "Europe", "Norway": "Europe",
  "Denmark": "Europe", "Poland": "Europe", "Czech Republic": "Europe",
  "Hungary": "Europe", "Romania": "Europe", "Portugal": "Europe",
  "Finland": "Europe", "Croatia": "Europe", "Serbia": "Europe",
  "Bulgaria": "Europe", "Ukraine": "Europe",
  "Russia": "Asia",
  "United States of America": "Americas", "Mexico": "Americas",
  "Peru": "Americas", "Colombia": "Americas", "Brazil": "Americas",
  "Argentina": "Americas", "Chile": "Americas", "Bolivia": "Americas",
  "Guatemala": "Americas", "Cuba": "Americas", "Ecuador": "Americas",
  "Venezuela": "Americas", "Panama": "Americas", "Costa Rica": "Americas",
  "Honduras": "Americas", "Jamaica": "Americas",
  "Nigeria": "Africa", "Ghana": "Africa", "Ethiopia": "Africa",
  "Kenya": "Africa", "Sudan": "Africa", "South Africa": "Africa",
  "Morocco": "Africa", "Algeria": "Africa", "Tunisia": "Africa",
  "Mali": "Africa", "Cameroon": "Africa", "Tanzania, United Republic of": "Africa",
  "Mozambique": "Africa", "Democratic Republic of the Congo": "Africa",
  "Republic of the Congo": "Africa", "Senegal": "Africa",
  "Madagascar": "Africa", "Libya": "Africa", "Zimbabwe": "Africa",
  "Australia": "Oceania", "New Zealand": "Oceania",
  "Uzbekistan": "Asia",
};

const CONTINENT_ORDER = ["Middle East", "Asia", "Europe", "Americas", "Africa"];

// --- Init ---

export function initDashboard(layer, cbs) {
  queryLayer = layer;
  callbacks = cbs;
  createDOM();

  // Timeline interaction — click for single bin, drag for range, dblclick to reset
  const canvas = document.getElementById("dash-timeline-canvas");
  if (canvas) {
    canvas.style.cursor = "crosshair";
    let dragStart = null;
    let isDragging = false;

    function xToYear(clientX) {
      if (!canvas._timelineData) return null;
      const { minC, range } = canvas._timelineData;
      const rect = canvas.getBoundingClientRect();
      const t = (clientX - rect.left) / rect.width;
      return minC + t * range;
    }

    function snapToNearest(year) {
      if (!canvas._timelineData) return year;
      const { centuries } = canvas._timelineData;
      let nearest = centuries[0];
      let minDist = Infinity;
      for (const c of centuries) {
        const dist = Math.abs(c - year);
        if (dist < minDist) { minDist = dist; nearest = c; }
      }
      return nearest;
    }

    function selectRange(startYear, endYear) {
      let lo = snapToNearest(Math.min(startYear, endYear));
      let hi = snapToNearest(Math.max(startYear, endYear));
      if (lo === hi) hi = lo + 99;
      else hi = hi + 99;
      // Expand pre-5K bucket
      if (lo <= -5000) lo = -300000;
      if (callbacks.onTimeSelect) callbacks.onTimeSelect(lo, hi);
    }

    canvas.addEventListener("dblclick", () => {
      if (callbacks.onTimeSelect) callbacks.onTimeSelect(null, null);
    });

    canvas.addEventListener("mousedown", (e) => {
      dragStart = e.clientX;
      isDragging = false;
    });

    // Selection overlay
    let selectionDiv = null;

    canvas.addEventListener("mousemove", (e) => {
      if (dragStart === null) return;
      if (Math.abs(e.clientX - dragStart) > 5) isDragging = true;
      if (isDragging) {
        if (!selectionDiv) {
          selectionDiv = document.createElement("div");
          selectionDiv.style.cssText = "position:absolute;top:0;height:100%;background:rgba(0,233,255,0.15);border-left:1px solid rgba(0,233,255,0.4);border-right:1px solid rgba(0,233,255,0.4);pointer-events:none;";
          canvas.parentElement.style.position = "relative";
          canvas.parentElement.appendChild(selectionDiv);
        }
        const parentRect = canvas.parentElement.getBoundingClientRect();
        const left = Math.min(dragStart, e.clientX) - parentRect.left;
        const width = Math.abs(e.clientX - dragStart);
        selectionDiv.style.left = left + "px";
        selectionDiv.style.width = width + "px";
      }
    });

    canvas.addEventListener("mouseup", (e) => {
      if (dragStart === null) return;
      const startYear = xToYear(dragStart);
      const endYear = xToYear(e.clientX);
      dragStart = null;
      if (startYear == null || endYear == null) return;

      if (isDragging) {
        selectRange(startYear, endYear);
      } else {
        // Single click
        const nearest = snapToNearest(endYear);
        if (nearest <= -5000) {
          if (callbacks.onTimeSelect) callbacks.onTimeSelect(-300000, -5000);
        } else {
          if (callbacks.onTimeSelect) callbacks.onTimeSelect(nearest, nearest + 99);
        }
      }
      isDragging = false;
      if (selectionDiv) { selectionDiv.remove(); selectionDiv = null; }
    });

    canvas.addEventListener("mouseleave", () => {
      dragStart = null;
      isDragging = false;
      if (selectionDiv) { selectionDiv.remove(); selectionDiv = null; }
    });
  }

  // Flow diagram click handler
  const flowCanvas = document.getElementById("dash-flow-canvas");
  if (flowCanvas) {
    flowCanvas.addEventListener("click", (e) => {
      if (!flowCanvas._clickRegions || !flowCanvas._flowData) return;
      const rect = flowCanvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (276 / rect.width);
      const y = (e.clientY - rect.top) * (160 / rect.height);
      const { rPos, mPos, leftX, rightX } = flowCanvas._clickRegions;

      // Check region clicks (left side)
      if (x < leftX + 20) {
        for (const rp of rPos) {
          if (y >= rp.y && y <= rp.y + rp.h + 4) {
            if (callbacks.onRegionSelect) callbacks.onRegionSelect(rp.id);
            return;
          }
        }
      }

      // Check museum clicks (right side)
      if (x > rightX - 20) {
        for (const mp of mPos) {
          if (y >= mp.y && y <= mp.y + mp.h + 4) {
            if (callbacks.onMuseumSelect) callbacks.onMuseumSelect(mp.id);
            return;
          }
        }
      }
    });
  }
}

export function updateDashboard(state) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runUpdate(state), 300);
}

export function toggleDashboard() {
  if (!dashboardEl) return;
  dashboardEl.classList.toggle("collapsed");
}

// --- DOM ---

function createDOM() {
  dashboardEl = document.createElement("div");
  dashboardEl.id = "dashboard";
  dashboardEl.innerHTML = `
    <div class="dash-card" id="dash-museums">
      <div class="dash-card-title">Museums</div>
      <div class="dash-card-body" id="dash-museums-body"></div>
    </div>
    <div class="dash-card" id="dash-countries">
      <div class="dash-card-title">Top Countries</div>
      <div class="dash-card-body" id="dash-countries-body"></div>
    </div>
    <div class="dash-card" id="dash-timeline">
      <div class="dash-card-title">Timeline</div>
      <canvas id="dash-timeline-canvas" width="260" height="70"></canvas>
    </div>
    <div class="dash-card" id="dash-heatmap">
      <div class="dash-card-title">Collection Origins</div>
      <canvas id="dash-flow-canvas" width="276" height="160"></canvas>
    </div>
  `;
  document.body.appendChild(dashboardEl);

  // Collapse by default on mobile
  if (window.innerWidth <= 768) {
    dashboardEl.classList.add("collapsed");
  }
}

// --- Queries ---

async function runUpdate(state) {
  if (!queryLayer || !dashboardEl) return;
  const where = buildWhere(state);

  try {
    // Flow diagram only changes on museum selection, not time/country filters
    const museumWhere = state.museum && state.museum !== "all"
      ? `museum_id = '${state.museum}'`
      : "1=1";
    const needsFlowUpdate = museumWhere !== lastMuseumWhere;
    lastMuseumWhere = museumWhere;

    const queries = [
      queryMuseumStats(where),
      queryCountryStats(where),
      queryTimeStats(where),
    ];
    if (needsFlowUpdate) queries.push(queryHeatmapStats(museumWhere));

    const results = await Promise.all(queries);
    renderMuseumBars(results[0], state);
    renderCountryBars(results[1], state);
    renderTimeline(results[2], state);
    if (needsFlowUpdate) renderHeatmap(results[3]);
  } catch (e) {
    // Silently fail — dashboard is supplementary
  }
}

async function queryMuseumStats(where) {
  const result = await queryLayer.queryFeatures({
    where,
    outStatistics: [{
      statisticType: "count",
      onStatisticField: "ObjectId",
      outStatisticFieldName: "cnt",
    }],
    groupByFieldsForStatistics: ["museum_id"],
    returnGeometry: false,
  });
  return result.features
    .map((f) => ({ museum: f.attributes.museum_id, count: f.attributes.cnt }))
    .filter((d) => d.museum)
    .sort((a, b) => b.count - a.count);
}

async function queryCountryStats(where) {
  const result = await queryLayer.queryFeatures({
    where,
    outStatistics: [{
      statisticType: "count",
      onStatisticField: "ObjectId",
      outStatisticFieldName: "cnt",
    }],
    groupByFieldsForStatistics: ["country"],
    returnGeometry: false,
  });
  return result.features
    .map((f) => ({ country: f.attributes.country, count: f.attributes.cnt }))
    .filter((d) => d.country)
    .sort((a, b) => b.count - a.count);
}

async function queryTimeStats(where) {
  const result = await queryLayer.queryFeatures({
    where: where + " AND year_start IS NOT NULL",
    outStatistics: [{
      statisticType: "count",
      onStatisticField: "ObjectId",
      outStatisticFieldName: "cnt",
    }],
    groupByFieldsForStatistics: ["year_start"],
    returnGeometry: false,
  });
  return result.features.map((f) => ({
    year: f.attributes.year_start,
    count: f.attributes.cnt,
  }));
}

async function queryHeatmapStats(where) {
  const result = await queryLayer.queryFeatures({
    where,
    outStatistics: [{
      statisticType: "count",
      onStatisticField: "ObjectId",
      outStatisticFieldName: "cnt",
    }],
    groupByFieldsForStatistics: ["museum_id", "country"],
    returnGeometry: false,
  });
  return result.features.map((f) => ({
    museum: f.attributes.museum_id,
    country: f.attributes.country,
    count: f.attributes.cnt,
  }));
}

// --- Renderers ---

function renderMuseumBars(data, state) {
  const body = document.getElementById("dash-museums-body");
  if (!body) return;

  // "All Museums" row + individual museums
  const totalCount = data.reduce((s, d) => s + d.count, 0);
  let html = `
    <div class="dash-bar-row dash-museum-row${!state.museum || state.museum === "all" ? " selected" : ""}" data-museum="all">
      <span class="dash-museum-dot" style="background:rgb(160,160,180)"></span>
      <span class="dash-bar-label">All Museums</span>
      <div class="dash-bar-track">
        <div class="dash-bar-fill" style="width:100%;background:linear-gradient(90deg, rgba(160,160,180,0.3), rgba(160,160,180,0.7))"></div>
      </div>
      <span class="dash-bar-value">${totalCount.toLocaleString()}</span>
    </div>`;

  for (const d of data) {
    const color = MUSEUM_COLORS[d.museum] || [200, 60, 50];
    const name = MUSEUMS[d.museum]?.name || d.museum;
    const isSelected = state.museum === d.museum || state.museum === "all" || !state.museum;
    const selected = isSelected ? " selected" : "";
    const pct = (d.count / totalCount) * 100;
    html += `
      <div class="dash-bar-row dash-museum-row${selected}" data-museum="${d.museum}">
        <span class="dash-museum-dot" style="background:rgb(${color.join(",")})"></span>
        <span class="dash-bar-label">${name}</span>
        <div class="dash-bar-track">
          <div class="dash-bar-fill" style="width:${pct}%;background:linear-gradient(90deg, rgba(${color.join(",")},0.4), rgba(${color.join(",")},0.7))"></div>
        </div>
        <span class="dash-bar-value">${d.count.toLocaleString()}</span>
      </div>`;
  }
  body.innerHTML = html;

  body.onclick = (e) => {
    const row = e.target.closest(".dash-museum-row");
    if (!row) return;
    const museum = row.dataset.museum;
    if (callbacks.onMuseumSelect) callbacks.onMuseumSelect(museum === "all" ? "all" : museum);
  };
}

function renderCountryBars(data, state) {
  const body = document.getElementById("dash-countries-body");
  if (!body) return;

  const top = data.slice(0, 8);
  const max = top[0]?.count || 1;

  body.innerHTML = top.map((d) => {
    const pct = (d.count / max) * 100;
    const selected = state.country === d.country ? " selected" : "";
    return `
      <div class="dash-bar-row${selected}" data-country="${esc(d.country)}">
        <span class="dash-bar-label">${esc(d.country)}</span>
        <div class="dash-bar-track">
          <div class="dash-bar-fill" style="width:${pct}%;background:linear-gradient(90deg, rgba(200,200,210,0.15), rgba(200,200,210,0.35))"></div>
        </div>
        <span class="dash-bar-value">${d.count.toLocaleString()}</span>
      </div>`;
  }).join("");

  // Click handler
  body.onclick = (e) => {
    const row = e.target.closest(".dash-bar-row");
    if (!row) return;
    const country = row.dataset.country;
    if (callbacks.onCountrySelect) callbacks.onCountrySelect(country);
  };
}

function renderTimeline(data, state) {
  const canvas = document.getElementById("dash-timeline-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  if (!data.length) return;

  // Bucket by century, clamp to -5000..2100, cap bar height with sqrt scale
  const CLAMP_LO = -5000;
  const CLAMP_HI = 2100;
  const buckets = {};
  for (const { year, count } of data) {
    const clamped = Math.max(CLAMP_LO, Math.min(CLAMP_HI, year));
    const century = Math.floor(clamped / 100) * 100;
    buckets[century] = (buckets[century] || 0) + count;
  }

  const centuries = Object.keys(buckets).map(Number).sort((a, b) => a - b);
  if (!centuries.length) return;

  const minC = centuries[0];
  const maxC = centuries[centuries.length - 1];
  const range = maxC - minC || 100;
  const maxCount = Math.max(...Object.values(buckets));

  // Store for click handler
  canvas._timelineData = { minC, range, centuries };

  const barPad = 1;
  const labelH = 14;
  const chartH = H - labelH;

  // Time range highlight
  if (state.timeRange) {
    const x0 = ((state.timeRange.lo - minC) / range) * W;
    const x1 = ((state.timeRange.hi - minC) / range) * W;
    ctx.fillStyle = "rgba(0, 233, 255, 0.08)";
    ctx.fillRect(Math.max(0, x0), 0, Math.min(W, x1) - Math.max(0, x0), chartH);
  }

  // Bars
  const sqrtMax = Math.sqrt(maxCount);
  const barW = Math.max(2, (W / centuries.length) - barPad);
  for (const c of centuries) {
    const x = ((c - minC) / range) * (W - barW);
    let sqrtH = (Math.sqrt(buckets[c]) / sqrtMax) * chartH;
    // Tamp down the pre-3000 BC clamp bucket so it doesn't dominate
    if (c <= -5000) sqrtH *= 0.5;
    const inRange = !state.timeRange || (c >= state.timeRange.lo && c <= state.timeRange.hi);
    ctx.fillStyle = inRange ? "rgba(0, 233, 255, 0.6)" : "rgba(255, 255, 255, 0.15)";
    ctx.fillRect(x, chartH - sqrtH, barW, sqrtH);
  }

  // Axis labels
  ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
  ctx.font = "9px system-ui";
  ctx.textAlign = "left";
  ctx.fillText(formatCentury(minC), 0, H - 2);
  ctx.textAlign = "right";
  ctx.fillText(formatCentury(maxC), W, H - 2);
  ctx.textAlign = "center";
  const midC = minC + Math.round(range / 2 / 100) * 100;
  ctx.fillText(formatCentury(midC), W / 2, H - 2);
}

function formatCentury(year) {
  if (year <= -1000) return `${Math.round(Math.abs(year) / 1000)}k BC`;
  if (year < 0) return `${Math.abs(year)} BC`;
  if (year === 0) return "1 AD";
  return `${year} AD`;
}

// Flow animation state
let flowAnimProgress = 0;
let flowAnimFrame = null;

function renderHeatmap(data) {
  const canvas = document.getElementById("dash-flow-canvas");
  if (!canvas) return;

  // Aggregate: museum × continent
  const grid = {};
  const museumTotals = {};
  const regionTotals = {};
  const museumIds = new Set();

  for (const { museum, country, count } of data) {
    const continent = CONTINENT_MAP[country];
    if (!continent || !museum) continue;
    museumIds.add(museum);
    if (!grid[museum]) grid[museum] = {};
    grid[museum][continent] = (grid[museum][continent] || 0) + count;
    museumTotals[museum] = (museumTotals[museum] || 0) + count;
    regionTotals[continent] = (regionTotals[continent] || 0) + count;
  }

  const museums = Object.keys(MUSEUMS).filter((m) => museumIds.has(m))
    .sort((a, b) => (museumTotals[b] || 0) - (museumTotals[a] || 0));
  const regions = CONTINENT_ORDER.filter((c) => regionTotals[c])
    .sort((a, b) => (regionTotals[b] || 0) - (regionTotals[a] || 0));

  if (!museums.length || !regions.length) return;

  // Store data for animation and click handling
  canvas._flowData = { grid, museums, regions, museumTotals, regionTotals };
  canvas.style.cursor = "pointer";

  // Animate in
  if (flowAnimFrame) cancelAnimationFrame(flowAnimFrame);
  flowAnimProgress = 0;
  animateFlow(canvas);
}

function animateFlow(canvas) {
  flowAnimProgress = Math.min(1, flowAnimProgress + 0.03);
  drawFlow(canvas, flowAnimProgress);
  if (flowAnimProgress < 1) {
    flowAnimFrame = requestAnimationFrame(() => animateFlow(canvas));
  }
}

function drawFlow(canvas, progress) {
  if (!canvas._flowData) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const W = 276;
  const H = 160;

  // Handle retina
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const { grid, museums, regions, regionTotals } = canvas._flowData;

  const leftX = 70;
  const rightX = W - 80;
  const padY = 10;
  const gap = 8;

  // Use the mapped total (only artifacts with a known continent)
  const mappedTotal = Object.values(regionTotals).reduce((s, v) => s + v, 0);
  const mUsableH = H - padY * 2 - gap * (museums.length - 1);
  const rUsableH = H - padY * 2 - gap * (regions.length - 1);

  // Region positions (left — origin)
  const rPos = [];
  let rY = padY;
  for (const r of regions) {
    const h = Math.max(4, (regionTotals[r] / mappedTotal) * rUsableH);
    rPos.push({ id: r, y: rY, h });
    rY += h + gap;
  }

  // Museum positions (right — where artifacts ended up)
  const mMappedTotals = {};
  for (const m of museums) {
    mMappedTotals[m] = Object.values(grid[m] || {}).reduce((s, v) => s + v, 0);
  }
  const mMappedGrand = Object.values(mMappedTotals).reduce((s, v) => s + v, 0);

  const mPos = [];
  let mY = padY;
  for (const m of museums) {
    const h = Math.max(4, (mMappedTotals[m] / mMappedGrand) * mUsableH);
    mPos.push({ id: m, y: mY, h });
    mY += h + gap;
  }

  // Draw ribbons (region → museum)
  const mOffsets = {};
  const rOffsets = {};
  for (const m of museums) mOffsets[m] = 0;
  for (const r of regions) rOffsets[r] = 0;

  for (const m of museums) {
    const mp = mPos.find((p) => p.id === m);
    const color = MUSEUM_COLORS[m] || [200, 60, 50];
    const museumRegions = Object.entries(grid[m] || {})
      .filter(([r]) => regionTotals[r])
      .sort((a, b) => b[1] - a[1]);

    for (const [r, count] of museumRegions) {
      const rp = rPos.find((p) => p.id === r);
      if (!rp) continue;

      const ribbonHLeft = (count / regionTotals[r]) * rp.h;
      const ribbonHRight = (count / mMappedTotals[m]) * mp.h;

      const y0 = rp.y + rOffsets[r];  // left = region
      const y1 = mp.y + mOffsets[m];  // right = museum

      rOffsets[r] += ribbonHLeft;
      mOffsets[m] += ribbonHRight;

      // Animated ribbon — flows from region (left) to museum (right)
      const cp1x = leftX + (rightX - leftX) * 0.4;
      const cp2x = leftX + (rightX - leftX) * 0.6;
      const endX = leftX + (rightX - leftX) * progress;

      const curveY0top = y0 + (y1 - y0) * progress;
      const curveY0bot = (y0 + ribbonHLeft) + ((y1 + ribbonHRight) - (y0 + ribbonHLeft)) * progress;

      ctx.beginPath();
      ctx.moveTo(leftX, y0);
      ctx.bezierCurveTo(cp1x, y0, cp2x * progress + leftX * (1 - progress), curveY0top, endX, curveY0top);
      ctx.lineTo(endX, curveY0bot);
      ctx.bezierCurveTo(cp2x * progress + leftX * (1 - progress), curveY0bot, cp1x, y0 + ribbonHLeft, leftX, y0 + ribbonHLeft);
      ctx.closePath();

      ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.35)`;
      ctx.fill();
    }
  }

  const MUSEUM_SHORT = {
    met: "The Met", louvre: "Louvre",
    british_museum: "British\nMuseum",
  };
  const REGION_SHORT = {
    "Middle East": "Mid East",
  };

  // Draw region blocks (left — origin)
  for (const rp of rPos) {
    ctx.fillStyle = "rgba(0, 233, 255, 0.6)";
    ctx.fillRect(leftX - 5, rp.y, 5, rp.h);

    const label = REGION_SHORT[rp.id] || rp.id;
    drawLabel(ctx, label, leftX - 9, rp.y + rp.h / 2, "right", 1);
  }

  // Draw museum blocks (right — destination)
  if (progress > 0.5) {
    const alpha = Math.min(1, (progress - 0.5) * 4);
    for (const mp of mPos) {
      const color = MUSEUM_COLORS[mp.id] || [200, 60, 50];
      ctx.fillStyle = `rgba(${color.join(",")}, ${alpha})`;
      ctx.fillRect(rightX, mp.y, 5, mp.h);

      const label = MUSEUM_SHORT[mp.id] || mp.id;
      drawLabel(ctx, label, rightX + 9, mp.y + mp.h / 2, "left", alpha);
    }
  }

  // Store click regions for hit testing
  canvas._clickRegions = { rPos, mPos, leftX, rightX, W };
}

function drawLabel(ctx, text, x, y, align, alpha) {
  ctx.font = "10px system-ui";
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  const lines = text.split("\n");
  const lineH = 12;
  const startY = y - ((lines.length - 1) * lineH) / 2;
  const pad = 3;
  for (let i = 0; i < lines.length; i++) {
    const ly = startY + i * lineH;
    const metrics = ctx.measureText(lines[i]);
    const bx = align === "right" ? x - metrics.width - pad : x - pad;
    ctx.fillStyle = `rgba(20,20,20,${0.8 * alpha})`;
    ctx.fillRect(bx, ly - 6, metrics.width + pad * 2, 12);
    ctx.fillStyle = `rgba(220,220,220,${alpha})`;
    ctx.fillText(lines[i], x, ly);
  }
}
