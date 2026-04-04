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

import { createLayers, buildPopup, initPulseCanvas, startPulse, stopPulse, startCountryPulse, stopCountryPulse, highlightCountry, clearCountryHighlight } from "./layers.js";
import { MUSEUMS } from "./museums.js";
import { initFilters, applyFilters, getFilteredCount, buildWhere } from "./filters.js";
import { updateColumns, clearColumns } from "./columns.js";
import { updateArcs, clearArcs } from "./arcs.js";
import { loadThumbnails, clearThumbnails } from "./thumbnails.js";
import { initSidebar, openSidebar, setTimeFilter, setMuseumFilter } from "./sidebar.js";
import { initToolbar, updateArtifactCount, updateCountryCount, showImageProgress, hideImageProgress } from "./toolbar.js";
import { initTimeSlider, setTimeRange } from "./time-slider.js";
import { initDashboard, updateDashboard } from "./dashboard.js";

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
  view.popup.autoOpenEnabled = true;
  view.goTo({ position: { spatialReference: { wkid: 4326 }, x: -20, y: 30, z: 18_000_000 } });

  // Pulse canvas for museum selection
  initPulseCanvas(view);

  // Create all layers
  const layers = createLayers(view);
  const { sceneLayer, queryLayer, thumbLayer, columnLayer, arcLayer, highlightLayer, museumLayer } = layers;

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
    updateDashboard(state);
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
    if (spinWasActive && !spinning) startSpin();
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
      // If a museum is selected, ensure spin restarts after columns load
      const shouldSpin = !!state.museum;
      await update();
      if (shouldSpin && !spinning) { startSpin(); updateSpinButton(); }
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
    onCountrySelect: (country) => {
      state.country = country;
      update();
    },
    onMuseumSelect: (museumId) => {
      state.museum = museumId;
      setMuseumFilter(museumId);
      pulseForMuseum(museumId);
      if (museumId) startSpin(); else stopSpin();
      updateSpinButton();
      update();
    },
    onTimeSelect: (lo, hi) => {
      state.timeRange = (lo != null && hi != null) ? { lo, hi } : null;
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
      updateDashboard(state);
    },
  });
  updateDashboard(state);

  // Start with all museums active — spin + pulse + columns
  setMuseumFilter("all");
  pulseForMuseum("all");
  startSpin();
  updateSpinButton();
  update();

  // --- Click handling ---
  view.on("click", async (event) => {
    const hit = await view.hitTest(event, {
      include: [museumLayer, thumbLayer, sceneLayer, arcLayer, columnLayer, highlightLayer],
    });
    if (!hit.results.length) return;
    const graphic = hit.results[0].graphic;

    if (graphic.layer === museumLayer) {
      const mid = graphic.attributes.museum_id;
      document.getElementById("museum-select").value = mid;
      state.museum = mid;
      setMuseumFilter(mid);
      pulseForMuseum(mid);
      update();
    } else if (graphic.layer === arcLayer && graphic.attributes?.country) {
      stopSpin(); updateSpinButton();
      openSidebar(graphic.attributes.country, null, graphic.attributes.museum_id);
    } else if (graphic.layer === columnLayer && graphic.attributes?.country) {
      stopSpin(); updateSpinButton();
      openSidebar(graphic.attributes.country, null, graphic.attributes.museum_id);
    } else if (graphic.layer === highlightLayer) {
      stopSpin(); updateSpinButton();
      const atlasName = graphic.attributes.COUNTRY;
      const reverseMap = { "United States": "United States of America", "Turkiye": "Turkey", "Russian Federation": "Russia", "South Korea": "Korea", "Congo DRC": "Democratic Republic of the Congo", "Congo": "Republic of the Congo" };
      openSidebar(reverseMap[atlasName] || atlasName);
    }
  });

  // --- Popup → sidebar sync (artifacts only) ---
  reactiveUtils.watch(
    () => view.popup.selectedFeature,
    (feature) => {
      if (feature?.attributes?.artifact_id) {
        stopSpin(); updateSpinButton();
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
        // Clear country highlight + pulse
        stopCountryPulse();
        clearCountryHighlight(layers);
      }
    }
  );

  // --- Sidebar thumbnail click → fly to artifact ---
  document.getElementById("sidebar-content")?.addEventListener("click", (e) => {
    const thumb = e.target.closest(".sidebar-thumb");
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
        let centroid = null;
        try {
          const resp = await fetch("/data/centroids.json");
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

  // --- Time slider ---
  initTimeSlider(async (lo, hi) => {
    state.timeRange = (lo != null && hi != null) ? { lo, hi } : null;
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
    updateDashboard(state);
    resumeSpin();
  });
});
