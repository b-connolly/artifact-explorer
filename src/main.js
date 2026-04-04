/**
 * main.js — Artifact Explorer orchestrator.
 *
 * State → Filters → Layers → UI
 * ~150 lines. All logic lives in modules.
 */

import OAuthInfo from "@arcgis/core/identity/OAuthInfo.js";
import IdentityManager from "@arcgis/core/identity/IdentityManager.js";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils.js";
import "@arcgis/map-components/components/arcgis-scene";
import "@arcgis/map-components/components/arcgis-home";
import "@arcgis/map-components/components/arcgis-zoom";
import "@arcgis/map-components/components/arcgis-navigation-toggle";
import "@arcgis/map-components/components/arcgis-compass";

import { createLayers, buildPopup, initPulseCanvas, startPulse, stopPulse, startCountryPulse, stopCountryPulse, highlightCountry, clearCountryHighlight, MUSEUM_COLORS } from "./layers.js";
import { MUSEUMS } from "./museums.js";
import { initFilters, applyFilters, getFilteredCount, buildWhere } from "./filters.js";
import { updateColumns, clearColumns } from "./columns.js";
import { updateArcs, clearArcs } from "./arcs.js";
import { loadThumbnails, clearThumbnails } from "./thumbnails.js";
import { initSidebar, openSidebar, closeSidebar, setTimeFilter, setMuseumFilter } from "./sidebar.js";
import { initToolbar, updateArtifactCount, updateCountryCount, showImageProgress, hideImageProgress, updateFilterBar, registerResetCallbacks } from "./toolbar.js";
import { initTimeSlider, setTimeRange, getIncludeUndated } from "./time-slider.js";
import { initDashboard, updateDashboard, CONTINENT_MAP } from "./dashboard.js";

// --- OAuth ---
const oAuthInfo = new OAuthInfo({
  appId: import.meta.env.VITE_ARCGIS_CLIENT_ID,
  popup: true,
  popupCallbackUrl: "/oauth-callback.html",
});
IdentityManager.registerOAuthInfos([oAuthInfo]);

// --- App state ---
const state = {
  museum: "all",      // null | "all" | museum_id | [museum_ids]
  country: null,      // null | country name
  timeRange: null,    // null | { lo, hi }
  viewMode: "columns", // "columns" | "images"
};

// --- Init ---
const sceneEl = document.querySelector("#sceneView");
const loadingOverlay = document.getElementById("loading-overlay");

sceneEl.addEventListener("arcgisViewReadyChange", async () => {
  const view = sceneEl.view;

  view.environment.starsEnabled = true;
  view.environment.atmosphereEnabled = true;
  view.ui.components = [];
  view.popup.dockEnabled = false;
  view.popup.visibleElements = { collapseButton: false };
  view.popup.collapsed = false;
  view.popup.maxInlineActions = 0;
  view.popup.autoOpenEnabled = false;
  view.highlightOptions = { color: [0, 0, 0, 0], haloColor: [0, 0, 0, 0], fillOpacity: 0 };
  view.goTo({ position: { spatialReference: { wkid: 4326 }, x: -20, y: 30, z: 18_000_000 } });

  // Pulse canvas for museum selection
  initPulseCanvas(view);

  // Create all layers
  const layers = createLayers(view);
  const { sceneLayer, queryLayer, thumbLayer, columnLayer, arcLayer, countryClickLayer, museumLayer } = layers;

  // Init filter system (gets sceneLayerView for client-side filtering)
  await queryLayer.load();
  try {
    await sceneLayer.load();
    await initFilters(view, sceneLayer);
  } catch (e) {
    console.warn("SceneLayer failed to load — particles mode unavailable:", e.message);
  }

  // Sidebar
  initSidebar(queryLayer);

  // Country stats for dropdown
  const countryStats = await queryLayer.queryFeatures({
    where: "1=1",
    outStatistics: [{ statisticType: "count", onStatisticField: "ObjectId", outStatisticFieldName: "artifact_count" }],
    groupByFieldsForStatistics: ["country"],
    returnGeometry: false,
  });
  const countryCounts = countryStats.features.map((f) => ({
    country: f.attributes.country,
    count: f.attributes.artifact_count,
  }));
  const totalArtifacts = countryCounts.reduce((s, c) => s + c.count, 0);

  // Hide loading
  loadingOverlay.classList.add("done");
  setTimeout(() => loadingOverlay.remove(), 600);

  // --- Central update function ---
  async function update() {
    if (!state.museum) stopSpin();
    else pauseSpin();

    state.includeUndated = getIncludeUndated();
    applyFilters(state, layers);
    const count = await getFilteredCount(queryLayer, state);
    updateArtifactCount(count);

    // Country count
    queryLayer.queryFeatures({
      where: buildWhere(state),
      outStatistics: [{ statisticType: "count", onStatisticField: "ObjectId", outStatisticFieldName: "cnt" }],
      groupByFieldsForStatistics: ["country"],
      returnGeometry: false,
    }).then((r) => updateCountryCount(r.features.length));

    // Hide everything first
    sceneLayer.visible = false;
    thumbLayer.visible = false;
    columnLayer.visible = false;
    arcLayer.visible = false;

    // Filter museum pins to selected museum(s)
    if (!state.museum) {
      museumLayer.visible = false;
    } else if (Array.isArray(state.museum)) {
      museumLayer.visible = true;
      museumLayer.definitionExpression = `museum_id IN (${state.museum.map((id) => `'${id}'`).join(",")})`;
    } else if (state.museum !== "all") {
      museumLayer.visible = true;
      museumLayer.definitionExpression = `museum_id = '${state.museum}'`;
    } else {
      museumLayer.visible = true;
      museumLayer.definitionExpression = "1=1";
    }

    if (!state.museum) {
      clearColumns(layers);
      clearArcs(layers);
      clearThumbnails(thumbLayer);
      hideImageProgress();
      return;
    }

    if (state.viewMode === "columns") {
      columnLayer.visible = true;
      await updateColumns(queryLayer, state, layers);

      if (state.museum && state.museum !== "all" && !Array.isArray(state.museum)) {
        arcLayer.visible = true;
        await updateArcs(queryLayer, state, layers);
      }
    } else if (state.viewMode === "images") {
      clearColumns(layers);
      clearArcs(layers);
      thumbLayer.visible = true;
      await loadThumbnails(queryLayer, thumbLayer, state, showImageProgress, hideImageProgress);
    }

    // Wait for view to finish rendering before resuming spin
    if (view.updating) {
      await new Promise((resolve) => {
        const handle = reactiveUtils.watch(
          () => view.updating,
          (updating) => {
            if (!updating) { handle.remove(); resolve(); }
          }
        );
        // Safety timeout — don't wait forever
        setTimeout(() => { handle.remove(); resolve(); }, 10000);
      });
    }
    resumeSpin();
    updateDashboard(state); updateFilterBar(state);
    updateFilterBar(state);
  }

  function pulseForMuseum(museumId) {
    if (!museumId) { stopPulse(); return; }
    if (Array.isArray(museumId)) startPulse(museumId);
    else if (museumId === "all") startPulse(Object.keys(MUSEUMS));
    else startPulse([museumId]);
  }

  // --- Globe spin ---
  let spinning = false;
  let spinRAF = null;
  const SPIN_SPEED = 3; // degrees per second

  function startSpin() {
    if (spinning) return;
    spinning = true;
    let lastTime = performance.now();
    function frame(now) {
      if (!spinning) return;
      const dt = (now - lastTime) / 1000; // seconds since last frame
      lastTime = now;
      // Clamp dt to avoid jumps from tab switching or heavy load
      const clampedDt = Math.min(dt, 0.1);
      const camera = view.camera.clone();
      camera.position.longitude += SPIN_SPEED * clampedDt;
      view.camera = camera;
      spinRAF = requestAnimationFrame(frame);
    }
    spinRAF = requestAnimationFrame(frame);
  }

  function stopSpin() {
    spinning = false;
    if (spinRAF) { cancelAnimationFrame(spinRAF); spinRAF = null; }
  }

  // Processing spinner
  const spinnerEl = document.createElement("div");
  spinnerEl.id = "processing-spinner";
  spinnerEl.innerHTML = `
    <div class="spinner-ring spinner-ring-1"></div>
    <div class="spinner-ring spinner-ring-2"></div>
    <div class="spinner-ring spinner-ring-3"></div>
    <div class="spinner-dot"></div>
  `;
  document.body.appendChild(spinnerEl);

  let spinWasActive = false;
  function pauseSpin() {
    spinWasActive = spinning;
    if (spinning) stopSpin();
    spinnerEl.classList.add("visible");
  }
  function resumeSpin() {
    spinnerEl.classList.remove("visible");
    if (spinWasActive && !spinning && !view.popup.visible) startSpin();
    updateSpinButton();
  }

  const playIcon = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>`;
  const pauseIcon = `<svg viewBox="0 0 24 24" width="16" height="16"><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/></svg>`;

  function updateSpinButton() {
    const btn = document.getElementById("spin-toggle");
    if (!btn) return;
    btn.innerHTML = spinning ? pauseIcon : playIcon;
    btn.classList.toggle("active", spinning);
  }

  // Spin toggle click
  document.addEventListener("click", (e) => {
    if (e.target.closest("#spin-toggle")) {
      if (spinning) stopSpin(); else startSpin();
      updateSpinButton();
    }
  });

  // Stop spin on user interaction, update button
  function onUserStop() {
    if (spinning) { stopSpin(); updateSpinButton(); }
  }
  view.on("drag", onUserStop);
  view.on("mouse-wheel", onUserStop);
  view.on("key-down", onUserStop);

  // --- Toolbar ---
  initToolbar(
    async (activeMuseums) => {
      // activeMuseums is an array of selected museum IDs
      if (activeMuseums.length === 0) {
        state.museum = null;
      } else if (activeMuseums.length === Object.keys(MUSEUMS).length) {
        state.museum = "all";
      } else if (activeMuseums.length === 1) {
        state.museum = activeMuseums[0];
      } else {
        state.museum = activeMuseums; // array for multi-select
      }
      setMuseumFilter(state.museum);
      pulseForMuseum(state.museum);

      // Fly to museum when a single museum is selected
      if (typeof state.museum === "string" && state.museum !== "all" && MUSEUMS[state.museum]) {
        const m = MUSEUMS[state.museum];
        stopSpin();
        await view.goTo({
          position: { x: m.lng, y: 37, z: 18_000_000, spatialReference: { wkid: 4326 } },
        }, { duration: 2000 });
      } else if (!state.museum) {
        stopSpin();
      }
      updateSpinButton();
      await update();
    },
    null,
    (mode) => {
      state.viewMode = mode;
      hideImageProgress();
      update();
    }
  );

  updateArtifactCount(totalArtifacts);

  // --- Dashboard ---
  initDashboard(queryLayer, {
    onCountrySelect: async (country) => {
      state.country = country;
      state.regionCountries = null;
      stopSpin(); updateSpinButton();
      applyFilters(state, layers);
      getFilteredCount(queryLayer, state).then(updateArtifactCount);
      updateDashboard(state); updateFilterBar(state);
      await flyToCountry(country);
    },
    onMuseumSelect: (museumId) => {
      state.museum = museumId;
      state.regionCountries = null;
      setMuseumFilter(museumId);
      pulseForMuseum(museumId);
      updateSpinButton();
      update();
    },
    onRegionSelect: async (regionName) => {
      const REGION_CENTERS = {
        "Middle East": { lng: 45, lat: 30, zoom: 4 },
        "Asia": { lng: 100, lat: 30, zoom: 3 },
        "Europe": { lng: 15, lat: 48, zoom: 4 },
        "Americas": { lng: -85, lat: 15, zoom: 3 },
        "Africa": { lng: 20, lat: 5, zoom: 3 },
      };

      // Get countries in this region from CONTINENT_MAP
      const countries = Object.entries(CONTINENT_MAP)
        .filter(([, region]) => region === regionName)
        .map(([country]) => country);
      const center = REGION_CENTERS[regionName];
      if (!countries.length || !center) return;

      stopSpin(); updateSpinButton();

      // Store region countries on state so buildWhere can use it
      state.regionCountries = countries;
      state.country = null;
      applyFilters(state, layers);
      getFilteredCount(queryLayer, state).then(updateArtifactCount);
      queryLayer.queryFeatures({
        where: buildWhere(state),
        outStatistics: [{ statisticType: "count", onStatisticField: "ObjectId", outStatisticFieldName: "cnt" }],
        groupByFieldsForStatistics: ["country"],
        returnGeometry: false,
      }).then((r) => updateCountryCount(r.features.length));
      updateDashboard(state); updateFilterBar(state);

      // Update columns
      if (state.viewMode === "columns" && state.museum) {
        updateColumns(queryLayer, state, layers);
      }

      // Zoom to region
      await view.goTo({ center: [center.lng, center.lat], zoom: center.zoom }, { duration: 1500 });
    },
    onTimeSelect: (lo, hi) => {
      state.timeRange = (lo != null && hi != null) ? { lo, hi } : null;
      state.includeUndated = getIncludeUndated();
      if (lo != null && hi != null) {
        setTimeRange(lo, hi);
      } else {
        setTimeRange(-300000, 2100);
      }
      setTimeFilter(lo, hi);
      applyFilters(state, layers);
      if (state.viewMode === "columns" && state.museum) {
        updateColumns(queryLayer, state, layers);
        if (state.museum !== "all") updateArcs(queryLayer, state, layers);
      }
      getFilteredCount(queryLayer, state).then(updateArtifactCount);
      updateDashboard(state); updateFilterBar(state);
    },
  });
  updateDashboard(state); updateFilterBar(state);

  // Start with all museums active — spin + pulse + columns
  setMuseumFilter("all");
  pulseForMuseum("all");
  startSpin();
  updateSpinButton();
  update();

  // --- Reset callbacks for filter bar ---
  registerResetCallbacks(
    // Reset museum
    () => {
      state.museum = "all";
      setMuseumFilter("all");
      pulseForMuseum("all");
      const pills = document.querySelectorAll("#museum-pills .museum-pill");
      pills.forEach((p) => p.classList.add("active"));
      updateSpinButton();
      update();
    },
    // Reset country/region
    () => {
      state.country = null;
      state.regionCountries = null;
      activeCountry = null;
      clearCountryHighlight(layers);
      stopCountryPulse();
      closeSidebar();
      view.closePopup();
      update();
    },
    // Reset time
    () => {
      state.timeRange = null;
      setTimeRange(-300000, 2100);
      setTimeFilter(null, null);
      update();
    },
    // Reset all
    async () => {
      // Clear all filters
      state.museum = "all";
      state.country = null;
      state.regionCountries = null;
      state.timeRange = null;
      activeCountry = null;

      // Reset UI
      setMuseumFilter("all");
      pulseForMuseum("all");
      setTimeRange(-300000, 2100);
      setTimeFilter(null, null);
      clearCountryHighlight(layers);
      stopCountryPulse();
      closeSidebar();
      view.closePopup();
      const pills = document.querySelectorAll("#museum-pills .museum-pill");
      pills.forEach((p) => p.classList.add("active"));

      // Zoom out to initial view
      await view.goTo({
        position: { spatialReference: { wkid: 4326 }, x: -20, y: 30, z: 18_000_000 }
      }, { duration: 1500 });

      // Start spin
      startSpin();
      updateSpinButton();
      update();
    }
  );

  // --- Country popup with pie chart ---
  let activeCountry = null;

  function selectMuseumFromPopup(museumId, country) {
    // Update museum pills UI
    const pills = document.querySelectorAll("#museum-pills .museum-pill");
    pills.forEach((p) => {
      if (p.dataset.museum === museumId) p.classList.add("active");
      else p.classList.remove("active");
    });
    // Update state and filters
    state.museum = museumId;
    setMuseumFilter(museumId);
    pulseForMuseum(museumId);
    applyFilters(state, layers);
    getFilteredCount(queryLayer, state).then(updateArtifactCount);
    updateDashboard(state); updateFilterBar(state);
    // Re-open popup with updated pie
    flyToCountry(country);
  }

  async function buildCountryPopupContent(country) {
    // Always query ALL museums for this country (ignore museum filter for pie)
    const countryOnly = { ...state, museum: "all", country };
    const countryWhere = buildWhere(countryOnly);
    const statsResult = await queryLayer.queryFeatures({
      where: countryWhere,
      outStatistics: [{ statisticType: "count", onStatisticField: "ObjectId", outStatisticFieldName: "cnt" }],
      groupByFieldsForStatistics: ["museum_id"],
      returnGeometry: false,
    });

    const museumData = statsResult.features
      .map((f) => ({ id: f.attributes.museum_id, count: f.attributes.cnt }))
      .filter((d) => d.id && MUSEUMS[d.id])
      .sort((a, b) => b.count - a.count);
    const total = museumData.reduce((s, d) => s + d.count, 0);

    // Which museums are currently active
    const activeMuseums = new Set(
      !state.museum || state.museum === "all" ? Object.keys(MUSEUMS) :
      Array.isArray(state.museum) ? state.museum : [state.museum]
    );

    const div = document.createElement("div");
    div.style.cssText = "font-family:system-ui;color:#ddd;width:100%;";

    // Layout: pie on left, legend on right
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:12px;margin-bottom:12px;";

    // Donut chart
    const size = 110;
    const canvas = document.createElement("canvas");
    const dpr = 2;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.cssText = `width:${size}px;height:${size}px;flex-shrink:0;cursor:pointer;`;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const cx = size / 2, cy = size / 2, radius = size / 2 - 4;
    let startAngle = -Math.PI / 2;
    const slices = [];

    for (const d of museumData) {
      const sliceAngle = (d.count / total) * Math.PI * 2;
      const color = MUSEUM_COLORS[d.id] || [150, 150, 150];
      const isActive = activeMuseums.has(d.id);
      slices.push({ id: d.id, start: startAngle, end: startAngle + sliceAngle });

      if (isActive) {
        ctx.shadowColor = `rgba(${color.join(",")},0.4)`;
        ctx.shadowBlur = 6;
      }
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, startAngle, startAngle + sliceAngle);
      ctx.closePath();
      ctx.fillStyle = isActive ? `rgb(${color.join(",")})` : `rgba(${color.join(",")},0.2)`;
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      startAngle += sliceAngle;
    }

    // Click on pie wedge → filter museum
    canvas.addEventListener("click", (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left - size / 2;
      const y = e.clientY - rect.top - size / 2;
      const dist = Math.sqrt(x * x + y * y);
      if (dist < radius * 0.52 || dist > radius) return; // clicked center hole or outside
      let angle = Math.atan2(y, x);
      if (angle < -Math.PI / 2) angle += Math.PI * 2;
      for (const s of slices) {
        let end = s.end;
        if (end < s.start) end += Math.PI * 2;
        if (angle >= s.start && angle < end) {
          selectMuseumFromPopup(s.id, country);
          break;
        }
      }
    });

    // Center hole
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.52, 0, Math.PI * 2);
    ctx.fillStyle = "#1a1a1e";
    ctx.fill();

    // Count in center
    const activeTotal = museumData.filter(d => activeMuseums.has(d.id)).reduce((s, d) => s + d.count, 0);
    const countStr = activeTotal.toLocaleString();
    ctx.fillStyle = "#00E9FF";
    const fontSize = countStr.length > 6 ? 11 : countStr.length > 4 ? 13 : 15;
    ctx.font = `bold ${fontSize}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(countStr, cx, cy - 4);
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.font = "8px system-ui";
    ctx.fillText("artifacts", cx, cy + 9);

    row.appendChild(canvas);

    // Legend column — museum bars with prominent percentages
    const legend = document.createElement("div");
    legend.style.cssText = "flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;";
    for (const d of museumData) {
      const color = MUSEUM_COLORS[d.id] || [150, 150, 150];
      const pct = total > 0 ? Math.round((d.count / total) * 100) : 0;
      const isActive = activeMuseums.has(d.id);
      const rgb = color.join(",");

      const item = document.createElement("div");
      item.style.cssText = `cursor:pointer;border-radius:4px;padding:3px 6px;transition:background 0.12s;opacity:${isActive ? 1 : 0.3};position:relative;overflow:hidden;`;
      item.addEventListener("mouseenter", () => { item.style.background = `rgba(${rgb},0.12)`; });
      item.addEventListener("mouseleave", () => { item.style.background = ""; });
      item.addEventListener("click", () => selectMuseumFromPopup(d.id, country));

      // Background bar fill
      const bar = document.createElement("div");
      bar.style.cssText = `position:absolute;left:0;top:0;bottom:0;width:${pct}%;background:rgba(${rgb},0.12);border-radius:5px;pointer-events:none;`;
      item.appendChild(bar);

      // Top row: museum name + big percentage
      const topRow = document.createElement("div");
      topRow.style.cssText = "display:flex;align-items:baseline;justify-content:space-between;position:relative;";

      const name = document.createElement("span");
      name.style.cssText = `font-size:11px;color:rgb(${rgb});font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
      name.textContent = MUSEUMS[d.id].name;

      const pctEl = document.createElement("span");
      pctEl.style.cssText = `font-size:13px;font-weight:700;color:rgb(${rgb});letter-spacing:-0.02em;font-variant-numeric:tabular-nums;`;
      pctEl.textContent = `${pct}%`;

      topRow.appendChild(name);
      topRow.appendChild(pctEl);
      item.appendChild(topRow);

      // Bottom row: artifact count
      const countEl = document.createElement("div");
      countEl.style.cssText = "font-size:10px;color:rgba(255,255,255,0.4);font-variant-numeric:tabular-nums;position:relative;margin-top:1px;";
      countEl.textContent = `${d.count.toLocaleString()} artifacts`;
      item.appendChild(countEl);

      legend.appendChild(item);
    }
    row.appendChild(legend);
    div.appendChild(row);

    // Explore button
    const exploreBtn = document.createElement("button");
    exploreBtn.textContent = "Explore Artifacts →";
    exploreBtn.style.cssText = "padding:9px 16px;background:rgba(0,233,255,0.08);border:1px solid rgba(0,233,255,0.25);border-radius:6px;color:#00E9FF;font-size:12px;font-weight:500;font-family:inherit;cursor:pointer;width:100%;transition:all 0.15s;letter-spacing:0.02em;";
    exploreBtn.onmouseenter = () => { exploreBtn.style.background = "rgba(0,233,255,0.18)"; exploreBtn.style.borderColor = "rgba(0,233,255,0.5)"; };
    exploreBtn.onmouseleave = () => { exploreBtn.style.background = "rgba(0,233,255,0.08)"; exploreBtn.style.borderColor = "rgba(0,233,255,0.25)"; };
    exploreBtn.addEventListener("click", () => {
      view.closePopup();
      openSidebar(country);
    });
    div.appendChild(exploreBtn);

    return div;
  }

  async function flyToCountry(country) {
    let centroid = null;
    try {
      const resp = await fetch(import.meta.env.BASE_URL + "data/centroids.json");
      const centroids = await resp.json();
      centroid = centroids[country];
    } catch {}

    activeCountry = country;
    highlightCountry(country, layers);

    if (centroid) {
      view.popup.dockEnabled = false;

      await view.goTo({
        center: [centroid.lng, centroid.lat - 3],
        zoom: 5.4,
        heading: 0,
        tilt: 28,
      }, { duration: 1500 });

      const content = await buildCountryPopupContent(country);
      view.openPopup({
        title: country,
        location: { x: centroid.lng, y: centroid.lat, spatialReference: { wkid: 4326 } },
        content,
      });
    }
  }

  // --- Click handling ---
  const reverseCountryMap = { "United States": "United States of America", "Turkiye": "Turkey", "Russian Federation": "Russia", "South Korea": "Korea", "Congo DRC": "Democratic Republic of the Congo", "Congo": "Republic of the Congo" };

  view.on("click", async (event) => {
    // First check for museum pins (highest priority)
    const pinHit = await view.hitTest(event, { include: [museumLayer] });
    if (pinHit.results.length) {
      const mid = pinHit.results[0].graphic.attributes.museum_id;
      state.museum = mid;
      setMuseumFilter(mid);
      pulseForMuseum(mid);
      update();
      return;
    }

    // Query country at click location using spatial query
    const mapPoint = view.toMap(event);
    if (mapPoint) {
      try {
        const result = await countryClickLayer.queryFeatures({
          geometry: mapPoint,
          spatialRelationship: "intersects",
          outFields: ["COUNTRY"],
          returnGeometry: false,
          maxRecordCount: 1,
        });
        if (result.features.length) {
          const atlasName = result.features[0].attributes?.COUNTRY;
          if (!atlasName) return;
          stopSpin(); updateSpinButton();
          const country = reverseCountryMap[atlasName] || atlasName;
          state.country = country;
          state.regionCountries = null;
          applyFilters(state, layers);
          getFilteredCount(queryLayer, state).then(updateArtifactCount);
          updateDashboard(state); updateFilterBar(state);
          await flyToCountry(country);
        }
      } catch {}
    }
  });

  // --- Popup → sidebar sync (artifacts only) ---
  reactiveUtils.watch(
    () => view.popup.selectedFeature,
    (feature) => {
      if (feature?.attributes?.artifact_id) {
        stopSpin(); updateSpinButton();
        // Don't re-render sidebar if it's already open on this country
        const sidebar = document.getElementById("sidebar");
        if (sidebar?.classList.contains("open")) return;
        openSidebar(feature.attributes.country, feature.attributes.artifact_id);
      }
    }
  );

  // Restore dashboard + undock popup when popup closes
  reactiveUtils.watch(
    () => view.popup.visible,
    (visible) => {
      if (!visible) {
        const dashEl = document.getElementById("dashboard");
        if (dashEl) dashEl.classList.remove("collapsed");
        view.popup.dockEnabled = false;
        // Only clear darken mask if no country is actively selected
        stopCountryPulse();
        if (!activeCountry) {
          clearCountryHighlight(layers);
        }
      }
    }
  );

  // --- Sidebar thumbnail click → fly to artifact ---
  document.getElementById("sidebar-content")?.addEventListener("click", (e) => {
    const thumb = e.target.closest(".sidebar-thumb") || e.target.closest(".sidebar-search-item");
    if (!thumb) return;
    queryLayer.queryFeatures({
      where: `artifact_id = '${thumb.dataset.id}'`,
      outFields: ["*"],
      returnGeometry: true,
    }).then(async (result) => {
      if (result.features.length) {
        const feature = result.features[0];
        feature.popupTemplate = buildPopup();
        // Zoom to country centroid, not individual artifact
        const country = feature.attributes.country;
        activeCountry = country;
        let centroid = null;
        try {
          const resp = await fetch(import.meta.env.BASE_URL + "data/centroids.json");
          const centroids = await resp.json();
          centroid = centroids[country];
        } catch {}

        stopSpin();
        updateSpinButton();
        spinnerEl.classList.remove("visible");

        // Hide dashboard, dock popup on right, fly to country
        const dashEl = document.getElementById("dashboard");
        if (dashEl) dashEl.classList.add("collapsed");

        view.popup.dockEnabled = true;
        view.popup.dockOptions = {
          buttonEnabled: true,
          breakpoint: false,
          position: "top-right",
        };
        view.popup.collapsed = false;

        // Highlight country + pulse at centroid
        highlightCountry(country, layers);

        if (centroid) {
          startCountryPulse(centroid.lng, centroid.lat);
          await view.goTo({
            center: [centroid.lng, centroid.lat],
            zoom: 5,
          }, { duration: 1000 });
          view.openPopup({
            features: [feature],
            location: { x: centroid.lng, y: centroid.lat, spatialReference: { wkid: 4326 } },
          });
        } else {
          const geo = feature.geometry;
          startCountryPulse(geo.longitude, geo.latitude);
          await view.goTo({ target: geo, zoom: 5 }, { duration: 1000 });
          view.openPopup({ features: [feature], location: geo });
        }
      }
    });
  });

  // --- Sidebar close → clear country highlight ---
  document.getElementById("sidebar-close")?.addEventListener("click", () => {
    activeCountry = null;
    clearCountryHighlight(layers);
    stopCountryPulse();
  });

  // --- Time slider ---
  initTimeSlider(async (lo, hi) => {
    state.timeRange = (lo != null && hi != null) ? { lo, hi } : null;
    state.includeUndated = getIncludeUndated();
    setTimeFilter(lo, hi);
    pauseSpin();
    applyFilters(state, layers);

    if (state.viewMode === "columns" && state.museum) {
      await updateColumns(queryLayer, state, layers);
      if (state.museum !== "all" && !Array.isArray(state.museum)) {
        await updateArcs(queryLayer, state, layers);
      }
    }

    getFilteredCount(queryLayer, state).then(updateArtifactCount);
    queryLayer.queryFeatures({
      where: buildWhere(state),
      outStatistics: [{ statisticType: "count", onStatisticField: "ObjectId", outStatisticFieldName: "cnt" }],
      groupByFieldsForStatistics: ["country"],
      returnGeometry: false,
    }).then((r) => updateCountryCount(r.features.length));
    updateDashboard(state); updateFilterBar(state);

    // Refresh country popup if open
    if (activeCountry && view.popup.visible) {
      const content = await buildCountryPopupContent(activeCountry);
      view.popup.content = content;
    }

    resumeSpin();
  });

  // --- DEBUG: Camera inspector (press D to toggle) ---
  const debugEl = document.createElement("div");
  debugEl.id = "camera-debug";
  debugEl.style.cssText = "position:fixed;top:60px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#0ff;font:12px monospace;padding:8px 14px;border-radius:6px;z-index:9999;display:none;white-space:pre;pointer-events:none;";
  document.body.appendChild(debugEl);

  let debugVisible = false;
  document.addEventListener("keydown", (e) => {
    if (e.key === "`") {
      debugVisible = !debugVisible;
      debugEl.style.display = debugVisible ? "block" : "none";
    }
  });

  reactiveUtils.watch(
    () => view.camera,
    (cam) => {
      if (!debugVisible || !cam) return;
      const p = cam.position;
      const lng = p.longitude ?? p.x;
      const lat = p.latitude ?? p.y;
      debugEl.textContent =
        `zoom:    ${view.zoom?.toFixed(2)}\n` +
        `heading: ${cam.heading?.toFixed(2)}\n` +
        `tilt:    ${cam.tilt?.toFixed(2)}\n` +
        `lng:     ${lng?.toFixed(4)}\n` +
        `lat:     ${lat?.toFixed(4)}\n` +
        `z (alt): ${Math.round(p.z)}`;
    }
  );
});
