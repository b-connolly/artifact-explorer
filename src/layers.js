/**
 * layers.js — Creates all map layers for the Artifact Explorer.
 *
 * Layers:
 *   sceneLayer      — SceneLayer (I3S LOD) for particle dots, decluttered
 *   queryLayer      — Hidden FeatureLayer for server queries (stats, sidebar, thumbnails)
 *   thumbLayer      — GraphicsLayer for thumbnail icons (images mode)
 *   columnLayer     — GraphicsLayer for extruded country columns (columns mode)
 *   arcLayer        — GraphicsLayer for museum→country arc lines
 *   highlightLayer  — FeatureLayer (Living Atlas) for highlighted country polygons
 *   darkenLayer     — FeatureLayer (Living Atlas) for darkening non-connected countries
 *   museumLayer     — FeatureLayer (client-side) for museum pins
 */

import SceneLayer from "@arcgis/core/layers/SceneLayer.js";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer.js";
import UniqueValueRenderer from "@arcgis/core/renderers/UniqueValueRenderer.js";
import SimpleRenderer from "@arcgis/core/renderers/SimpleRenderer.js";
import PointSymbol3D from "@arcgis/core/symbols/PointSymbol3D.js";
import IconSymbol3DLayer from "@arcgis/core/symbols/IconSymbol3DLayer.js";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol.js";
import Graphic from "@arcgis/core/Graphic.js";
import Point from "@arcgis/core/geometry/Point.js";
import Glow from "@arcgis/core/webscene/Glow.js";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils.js";
import { MUSEUMS } from "./museums.js";

// --- HTML escaping for popup content ---
function esc(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// --- URLs ---
const SCENE_URL = "https://services1.arcgis.com/uujCiiEZAflDbdxE/arcgis/rest/services/artifactsLayer/SceneServer";
const FEATURE_URL = "https://services1.arcgis.com/uujCiiEZAflDbdxE/arcgis/rest/services/artifactsLayer/FeatureServer/0";
const COUNTRIES_URL = "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/World_Countries_(Generalized)/FeatureServer/0";

// --- Museum color palette ---
export const MUSEUM_COLORS = {
  british_museum: [50, 70, 170],
  louvre:         [0, 160, 190],
  met:            [150, 50, 150],
};

// --- SceneLayer renderer (particles mode) ---
function makeParticleSymbol(color) {
  return new PointSymbol3D({
    symbolLayers: [
      new IconSymbol3DLayer({
        resource: { primitive: "circle" },
        material: { color },
        size: 4,
      }),
    ],
  });
}

const defaultParticleSymbol = makeParticleSymbol([200, 60, 50]);

const particleRenderer = new UniqueValueRenderer({
  field: "museum_id",
  defaultSymbol: defaultParticleSymbol,
  uniqueValueInfos: Object.entries(MUSEUM_COLORS).map(([id, color]) => ({
    value: id,
    symbol: makeParticleSymbol(color),
    label: MUSEUMS[id]?.name || id,
  })),
});

// --- Popup template ---
function formatYear(y) {
  if (y == null) return "";
  return y < 0 ? `${Math.abs(y)} BC` : `${y} AD`;
}

export function buildPopup() {
  return {
    title: "{title}",
    outFields: ["*"],
    content: [{
      type: "custom",
      outFields: ["*"],
      creator: (event) => {
        const a = event.graphic.attributes;
        const museum = MUSEUMS[a.museum_id];
        const mc = museum ? museum.color : [150, 150, 150];
        const color = `rgb(${mc.join(",")})`;
        const colorFaint = `rgba(${mc.join(",")},0.15)`;
        const museumName = museum ? museum.name : a.museum_id;
        const yearRange = a.year_start != null
          ? `${formatYear(a.year_start)} – ${formatYear(a.year_end)}`
          : (a.date_range || "");
        const hasOriginal = a.original_image_url && !a.original_image_url.includes("s3.amazonaws.com");
        const imgSrc = hasOriginal ? a.original_image_url : a.image_url;

        // Build info rows — only show fields that have data
        const infoRows = [];
        if (a.date_range || yearRange) {
          infoRows.push({ icon: "🕰", label: "Date", value: esc(a.date_range || yearRange) });
        }
        if (a.country) {
          infoRows.push({ icon: "📍", label: "Origin", value: esc(a.country) + (a.region ? ` · ${esc(a.region)}` : "") });
        }
        if (a.culture) {
          infoRows.push({ icon: "🏛", label: "Culture", value: esc(a.culture) });
        }
        if (a.period) {
          infoRows.push({ icon: "📜", label: "Period", value: esc(a.period) });
        }
        if (a.category) {
          infoRows.push({ icon: "🏷", label: "Type", value: esc(a.category) });
        }
        if (a.dimensions) {
          const dims = a.dimensions.length > 80 ? a.dimensions.slice(0, 77) + "..." : a.dimensions;
          infoRows.push({ icon: "📐", label: "Size", value: esc(dims) });
        }

        const rowsHTML = infoRows.map((r) => `
          <div style="display:flex;align-items:baseline;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
            <span style="font-size:12px;flex-shrink:0;width:18px;text-align:center">${r.icon}</span>
            <span style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.04em;width:48px;flex-shrink:0">${r.label}</span>
            <span style="font-size:12px;color:#e0e0e0;flex:1">${r.value}</span>
          </div>
        `).join("");

        const div = document.createElement("div");
        div.style.cssText = "font-family:system-ui;color:#ddd;max-width:320px;";

        div.innerHTML = `
          <a href="${a.source_url}" target="_blank" style="display:block;position:relative;margin:-12px -12px 0;overflow:hidden;border-radius:6px 6px 0 0">
            <div style="background:linear-gradient(135deg, rgba(0,0,0,0.3), ${colorFaint});display:flex;justify-content:center;align-items:center;min-height:180px;padding:16px">
              <img src="${imgSrc}" style="max-width:200px;max-height:200px;object-fit:contain;border-radius:4px;filter:drop-shadow(0 4px 12px rgba(0,0,0,0.5))" />
            </div>
            <div style="position:absolute;bottom:0;left:0;right:0;height:40px;background:linear-gradient(transparent,rgba(0,0,0,0.6))"></div>
          </a>

          <div style="margin:14px 0 10px">
            ${a.description ? `<p style="font-size:12px;line-height:1.6;color:#aaa;margin:0">${esc(a.description)}</p>` : ""}
          </div>

          <div style="margin-bottom:12px">
            ${rowsHTML}
          </div>

          ${a.credit_line ? `<div style="font-size:10px;color:#555;font-style:italic;margin-bottom:12px;line-height:1.4">${esc(a.credit_line)}</div>` : ""}

          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0 2px;border-top:1px solid rgba(255,255,255,0.08)">
            <div style="display:flex;align-items:center;gap:6px">
              <span style="width:8px;height:8px;border-radius:50%;background:${color}"></span>
              <span style="font-size:11px;color:${color};font-weight:500">${museumName}</span>
            </div>
            <a href="${a.source_url}" target="_blank" style="font-size:11px;color:${color};text-decoration:none;display:flex;align-items:center;gap:4px">
              View in collection <span style="font-size:14px">↗</span>
            </a>
          </div>
        `;
        return div;
      },
    }],
  };
}

// --- Create all layers ---

// --- Museum pulse animation ---
let pulseCanvas = null;
let pulseCtx = null;
let pulseAnimId = null;
let pulseMuseums = []; // [{ screenPoint, color }]
let pulseView = null;

function initPulseCanvas(view) {
  pulseView = view;
  pulseCanvas = document.createElement("canvas");
  pulseCanvas.id = "museum-pulse-canvas";
  pulseCanvas.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:5;";
  view.container.appendChild(pulseCanvas);

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    pulseCanvas.width = view.width * dpr;
    pulseCanvas.height = view.height * dpr;
    pulseCanvas.style.width = view.width + "px";
    pulseCanvas.style.height = view.height + "px";
    pulseCtx = pulseCanvas.getContext("2d");
    pulseCtx.scale(dpr, dpr);
  }
  resize();
  reactiveUtils.watch(() => [view.width, view.height], resize);
}

function startPulse(museumIds) {
  stopPulse();
  if (!museumIds.length || !pulseView) return;

  pulseMuseums = museumIds
    .map((id) => ({ id, museum: MUSEUMS[id] }))
    .filter((t) => t.museum)
    .map((t) => ({
      point: new Point({ longitude: t.museum.lng, latitude: t.museum.lat, spatialReference: { wkid: 4326 } }),
      color: MUSEUM_COLORS[t.id] || t.museum.color,
    }));

  let t = 0;
  function animate() {
    t = (t + 0.003) % 1;
    const dpr = window.devicePixelRatio || 1;
    pulseCtx.clearRect(0, 0, pulseCanvas.width / dpr, pulseCanvas.height / dpr);

    for (const target of pulseMuseums) {
      const sp = pulseView.toScreen(target.point);
      if (!sp) continue;

      const maxR = 25;
      const r = 8 + t * maxR;
      const alpha = 0.3 * (1 - t);
      const [cr, cg, cb] = target.color;

      pulseCtx.beginPath();
      pulseCtx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
      pulseCtx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha})`;
      pulseCtx.lineWidth = 1.5;
      pulseCtx.stroke();
    }

    // Also draw country pulse if active
    drawCountryPulse(t);

    pulseAnimId = requestAnimationFrame(animate);
  }
  animate();
}

function stopPulse() {
  pulseMuseums = [];
  // Only stop animation if no country pulse is active
  if (!countryPulseTarget) {
    if (pulseAnimId) cancelAnimationFrame(pulseAnimId);
    pulseAnimId = null;
    if (pulseCtx && pulseCanvas) {
      const dpr = window.devicePixelRatio || 1;
      pulseCtx.clearRect(0, 0, pulseCanvas.width / dpr, pulseCanvas.height / dpr);
    }
  }
}

// --- Country centroid pulse ---
let countryPulseTarget = null; // { point, color }

function startCountryPulse(lng, lat, color = [0, 233, 255]) {
  countryPulseTarget = {
    point: new Point({ longitude: lng, latitude: lat, spatialReference: { wkid: 4326 } }),
    color,
  };
  // If museum pulse isn't running, start a dedicated animation
  if (!pulseAnimId) {
    let t = 0;
    function animate() {
      t = (t + 0.001) % 1;
      const dpr = window.devicePixelRatio || 1;
      pulseCtx.clearRect(0, 0, pulseCanvas.width / dpr, pulseCanvas.height / dpr);
      drawCountryPulse(t);
      pulseAnimId = requestAnimationFrame(animate);
    }
    animate();
  }
}

function stopCountryPulse() {
  countryPulseTarget = null;
  // If no museum pulse running either, clear canvas
  if (pulseMuseums.length === 0 && pulseAnimId) {
    cancelAnimationFrame(pulseAnimId);
    pulseAnimId = null;
    if (pulseCtx && pulseCanvas) {
      const dpr = window.devicePixelRatio || 1;
      pulseCtx.clearRect(0, 0, pulseCanvas.width / dpr, pulseCanvas.height / dpr);
    }
  }
}

function drawCountryPulse(globalT) {
  if (!countryPulseTarget || !pulseView) return;
  const sp = pulseView.toScreen(countryPulseTarget.point);
  if (!sp) return;

  const [cr, cg, cb] = countryPulseTarget.color;

  // Single ring, heartbeat speed
  const maxR = 35;
  const r = 6 + globalT * maxR;
  const alpha = 0.3 * (1 - globalT);

  pulseCtx.beginPath();
  pulseCtx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
  pulseCtx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha})`;
  pulseCtx.lineWidth = 1.5;
  pulseCtx.stroke();

  // Soft center glow
  const gradient = pulseCtx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, 6);
  gradient.addColorStop(0, `rgba(${cr},${cg},${cb},0.5)`);
  gradient.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
  pulseCtx.beginPath();
  pulseCtx.arc(sp.x, sp.y, 6, 0, Math.PI * 2);
  pulseCtx.fillStyle = gradient;
  pulseCtx.fill();
}

// --- Country highlight (darken + outline) ---

// Map our country names → Living Atlas COUNTRY field
const ATLAS_NAME_MAP = {
  "United States of America": "United States",
  "Turkey": "Turkiye",
  "Russia": "Russian Federation",
  "Korea": "South Korea",
  "Democratic Republic of the Congo": "Congo DRC",
  "Republic of the Congo": "Congo",
};

function highlightCountry(countryName, layers) {
  const atlasName = ATLAS_NAME_MAP[countryName] || countryName;
  const escaped = atlasName.replace(/'/g, "''");

  // Darken everything except the selected country
  layers.darkenLayer.definitionExpression = `COUNTRY <> '${escaped}'`;

  // Highlight the selected country with glow outline
  layers.highlightLayer.definitionExpression = `COUNTRY = '${escaped}'`;
}

function clearCountryHighlight(layers) {
  layers.darkenLayer.definitionExpression = "1=0";
  layers.highlightLayer.definitionExpression = "1=0";
}

export { initPulseCanvas, startPulse, stopPulse, startCountryPulse, stopCountryPulse, highlightCountry, clearCountryHighlight };

export function createLayers(view) {
  // SceneLayer — I3S LOD for particle dots
  const sceneLayer = new SceneLayer({
    url: SCENE_URL,
    outFields: ["*"],
    title: "Artifacts",
    renderer: particleRenderer,
    popupTemplate: buildPopup(),
    visible: false,
    elevationInfo: { mode: "on-the-ground" },
    featureReduction: { type: "selection" },
    screenSizePerspectiveEnabled: true,
  });

  // Hidden FeatureLayer for queries
  const queryLayer = new FeatureLayer({
    url: FEATURE_URL,
    outFields: ["*"],
    visible: false,
  });

  // Thumbnail GraphicsLayer (images mode)
  const thumbLayer = new GraphicsLayer({
    title: "Thumbnails",
    elevationInfo: { mode: "on-the-ground" },
    visible: false,
  });

  // Column GraphicsLayer (columns mode)
  const columnLayer = new GraphicsLayer({
    title: "Country Columns",
    elevationInfo: { mode: "on-the-ground" },
    visible: false,
  });

  // Arc line GraphicsLayer
  const arcLayer = new GraphicsLayer({
    title: "Museum Arcs",
    elevationInfo: { mode: "absolute-height" },
    visible: false,
  });

  // Country darken overlay — always visible, controlled by definitionExpression
  const darkenLayer = new FeatureLayer({
    url: COUNTRIES_URL,
    renderer: new SimpleRenderer({
      symbol: new SimpleFillSymbol({
        color: [0, 0, 0, 0.55],
        outline: { color: [0, 0, 0, 0], width: 0 },
      }),
    }),
    definitionExpression: "1=0",
    visible: true,
    title: "Country Darken",
  });

  // Country highlight overlay — always visible, controlled by definitionExpression
  const highlightLayer = new FeatureLayer({
    url: COUNTRIES_URL,
    renderer: new SimpleRenderer({
      symbol: new SimpleFillSymbol({
        color: [0, 233, 255, 0.06],
        outline: { color: [0, 233, 255, 0.6], width: 2 },
      }),
    }),
    definitionExpression: "1=0",
    visible: true,
    title: "Country Highlights",
  });

  // Museum pins
  const museumLayer = createMuseumPinLayer();

  // Glow post-processing
  view.environment.lighting.glow = new Glow({ intensity: 0.5 });

  // Add layers in draw order (bottom → top)
  view.map.addMany([
    darkenLayer,
    highlightLayer,
    sceneLayer,
    queryLayer,
    columnLayer,
    thumbLayer,
    arcLayer,
    museumLayer,
  ]);

  return {
    sceneLayer,
    queryLayer,
    thumbLayer,
    columnLayer,
    arcLayer,
    darkenLayer,
    highlightLayer,
    museumLayer,
  };
}

// --- Museum pin layer ---

function createMuseumPinLayer() {
  const features = Object.entries(MUSEUMS).map(([id, m]) => {
    return new Graphic({
      geometry: new Point({ longitude: m.lng, latitude: m.lat, spatialReference: { wkid: 4326 } }),
      attributes: { museum_id: id, name: m.name, city: m.city },
    });
  });

  function makeMuseumPinSymbol(color) {
    return new PointSymbol3D({
      symbolLayers: [
        new IconSymbol3DLayer({
          resource: { primitive: "circle" },
          material: { color },
          outline: { color: [...color, 0.4], size: 2 },
          size: 14,
        }),
        // Glow ring
        new IconSymbol3DLayer({
          resource: { primitive: "circle" },
          material: { color: [...color, 0] },
          outline: { color: [...color, 0.3], size: 4 },
          size: 28,
        }),
      ],
      verticalOffset: { screenLength: 40, maxWorldLength: 200000, minWorldLength: 20000 },
      callout: {
        type: "line",
        color: [...color, 0.5],
        size: 1,
      },
    });
  }

  const defaultColor = [200, 200, 200];

  return new FeatureLayer({
    source: features,
    objectIdField: "ObjectID",
    fields: [
      { name: "ObjectID", type: "oid" },
      { name: "museum_id", type: "string" },
      { name: "name", type: "string" },
      { name: "city", type: "string" },
    ],
    renderer: new UniqueValueRenderer({
      field: "museum_id",
      defaultSymbol: makeMuseumPinSymbol(defaultColor),
      uniqueValueInfos: Object.entries(MUSEUMS).map(([id, m]) => ({
        value: id,
        symbol: makeMuseumPinSymbol(MUSEUM_COLORS[id] || m.color),
      })),
    }),
    labelingInfo: [{
      labelExpressionInfo: { expression: "$feature.name" },
      symbol: {
        type: "label-3d",
        symbolLayers: [{
          type: "text",
          material: { color: [255, 255, 255, 0.9] },
          font: { size: 11, weight: "bold" },
          halo: { color: [0, 0, 0, 0.6], size: 1.5 },
        }],
        verticalOffset: { screenLength: 60, maxWorldLength: 300000, minWorldLength: 30000 },
        callout: { type: "line", color: [0, 0, 0, 0], size: 0 },
      },
      labelPlacement: "above-center",
      deconflictionStrategy: "none",
    }],
    elevationInfo: { mode: "on-the-ground" },
    visible: false,
    title: "Museums",
  });

}
