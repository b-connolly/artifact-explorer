/**
 * arcs.js — 3D arc lines from museums to countries + canvas fly-out animation.
 *
 * State machine: IDLE → ANIMATING_OUT → DISPLAYED → IDLE
 */

import Graphic from "@arcgis/core/Graphic.js";
import Point from "@arcgis/core/geometry/Point.js";
import Polyline from "@arcgis/core/geometry/Polyline.js";
import PointSymbol3D from "@arcgis/core/symbols/PointSymbol3D.js";
import ObjectSymbol3DLayer from "@arcgis/core/symbols/ObjectSymbol3DLayer.js";
import LineSymbol3D from "@arcgis/core/symbols/LineSymbol3D.js";
import LineSymbol3DLayer from "@arcgis/core/symbols/LineSymbol3DLayer.js";
import { MUSEUMS } from "./museums.js";
import { MUSEUM_COLORS } from "./layers.js";
import { COUNTRY_NAME_MAP } from "./columns.js";
import { getQueryWhere } from "./filters.js";

let centroids = null;
async function loadCentroids() {
  if (centroids) return centroids;
  const resp = await fetch(import.meta.env.BASE_URL + "data/centroids.json");
  centroids = await resp.json();
  return centroids;
}

/**
 * Build arc lines from museum(s) to countries.
 * For single museum: show all arcs.
 * For "All Museums": show top 30 arcs.
 */
export async function updateArcs(queryLayer, state, layers) {
  const { arcLayer } = layers;
  arcLayer.removeAll();

  const where = getQueryWhere(state);
  const isAll = !state.museum || state.museum === "all";

  // Query country × museum counts
  const result = await queryLayer.queryFeatures({
    where,
    outFields: ["country", "museum_id"],
    outStatistics: [{
      statisticType: "count",
      onStatisticField: "ObjectId",
      outStatisticFieldName: "cnt",
    }],
    groupByFieldsForStatistics: ["country", "museum_id"],
    returnGeometry: false,
  });

  let pairs = [];
  let maxCount = 0;
  for (const f of result.features) {
    const { country, museum_id, cnt } = f.attributes;
    if (!country || !museum_id) continue;
    pairs.push({ country, museum_id, count: cnt });
    if (cnt > maxCount) maxCount = cnt;
  }

  // For "All Museums" — no arcs, only country highlights (handled by columns.js)
  if (isAll) return;

  const centroidsJson = await loadCentroids();
  const graphics = [];

  for (const pair of pairs) {
    const museum = MUSEUMS[pair.museum_id];
    if (!museum?.lat) continue;
    const dest = centroidsJson[pair.country];
    if (!dest) continue;

    // Skip same-location arcs
    if (Math.abs(museum.lng - dest.lng) < 1 && Math.abs(museum.lat - dest.lat) < 1) continue;

    const color = MUSEUM_COLORS[pair.museum_id] || [200, 60, 50];
    const dist = Math.sqrt(Math.pow(museum.lng - dest.lng, 2) + Math.pow(museum.lat - dest.lat, 2));
    const peakAlt = 50000 + dist * 15000;
    const logScale = Math.log10(pair.count + 1) / Math.log10(maxCount + 1);
    const lineWidth = 0.5 + logScale * 4;
    const alpha = 0.3 + logScale * 0.5;

    // 3D parabolic arc
    const segments = 30;
    const path = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const lng = museum.lng + (dest.lng - museum.lng) * t;
      const lat = museum.lat + (dest.lat - museum.lat) * t;
      const h = peakAlt * 4 * t * (1 - t);
      path.push([lng, lat, h]);
    }

    graphics.push(new Graphic({
      geometry: new Polyline({ paths: [path], spatialReference: { wkid: 4326 } }),
      symbol: new LineSymbol3D({
        symbolLayers: [
          new LineSymbol3DLayer({
            material: { color: [...color, alpha] },
            size: lineWidth,
          }),
        ],
      }),
      attributes: {
        country: pair.country,
        museum_id: pair.museum_id,
        museum_name: museum.name,
        count: pair.count,
      },
      popupTemplate: {
        title: "{museum_name} → {country}",
        content: "{count} artifacts",
      },
    }));

    // Glowing dot at destination
    graphics.push(new Graphic({
      geometry: new Point({
        longitude: dest.lng, latitude: dest.lat, z: 5000,
        spatialReference: { wkid: 4326 },
      }),
      symbol: new PointSymbol3D({
        symbolLayers: [
          new ObjectSymbol3DLayer({
            resource: { primitive: "sphere" },
            material: {
              color: [...color, 0.8],
              emissive: { source: "color", strength: 1.0 },
            },
            width: 20000 + logScale * 40000,
            height: 20000 + logScale * 40000,
            depth: 20000 + logScale * 40000,
          }),
        ],
      }),
      attributes: {
        country: pair.country,
        museum_id: pair.museum_id,
        museum_name: museum.name,
        count: pair.count,
      },
    }));
  }

  arcLayer.addMany(graphics);
}

export function clearArcs(layers) {
  layers.arcLayer.removeAll();
}

// --- Canvas fly-out animation ---

let canvas = null;
let ctx = null;
let animFrameId = null;

function ensureCanvas(view) {
  const container = view.container.querySelector(".esri-view-surface") || view.container;
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;inset:0;z-index:5;pointer-events:none;display:none;";
    container.appendChild(canvas);
  }
  const w = view.width, h = view.height;
  canvas.width = w * devicePixelRatio;
  canvas.height = h * devicePixelRatio;
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  ctx = canvas.getContext("2d");
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  canvas.style.display = "block";
  canvas.style.opacity = "1";
}

function hideCanvas() {
  if (canvas) { canvas.style.display = "none"; }
}

function bezierXY(sx, sy, cx, cy, ex, ey, t) {
  const u = 1 - t;
  return [u * u * sx + 2 * u * t * cx + t * t * ex,
          u * u * sy + 2 * u * t * cy + t * t * ey];
}

/**
 * Animate dots flying from museum to country centroids.
 * @param {SceneView} view
 * @param {string} museumId
 * @param {Function} onComplete — called when animation finishes
 */
export async function animateArcsOut(view, museumId, onComplete) {
  const museum = MUSEUMS[museumId];
  if (!museum?.lat) { onComplete?.(); return; }

  const centroidsJson = await loadCentroids();
  const museumScreen = view.toScreen(
    new Point({ longitude: museum.lng, latitude: museum.lat, spatialReference: { wkid: 4326 } })
  );
  if (!museumScreen) { onComplete?.(); return; }
  const mX = museumScreen.x, mY = museumScreen.y;

  // Get country destinations from centroids
  const targets = [];
  for (const [country, c] of Object.entries(centroidsJson)) {
    const sp = view.toScreen(
      new Point({ longitude: c.lng, latitude: c.lat, spatialReference: { wkid: 4326 } })
    );
    if (!sp) continue;
    const dist = Math.hypot(sp.x - mX, sp.y - mY);
    if (dist < 10) continue;
    targets.push({ x: sp.x, y: sp.y, dist, country });
  }

  if (targets.length === 0) { onComplete?.(); return; }

  // Sample max 50 targets
  targets.sort((a, b) => a.dist - b.dist);
  const animated = targets.length > 50
    ? targets.filter((_, i) => i % Math.ceil(targets.length / 50) === 0)
    : targets;

  const STAGGER = 800;
  const FLIGHT = 1200;
  for (let i = 0; i < animated.length; i++) {
    const t = animated[i];
    t.delay = (i / animated.length) * STAGGER;
    t.cx = (mX + t.x) / 2;
    t.cy = (mY + t.y) / 2 - (t.dist * 0.5 + Math.pow(t.dist, 1.05) * 0.1 + 40);
  }

  ensureCanvas(view);
  const start = performance.now();

  function tick(now) {
    const elapsed = now - start;
    let allDone = true;
    const w = canvas.width / devicePixelRatio;
    ctx.clearRect(0, 0, w, canvas.height / devicePixelRatio);

    // Batch trails
    ctx.beginPath();
    for (const t of animated) {
      const local = elapsed - t.delay;
      if (local <= 0) { allDone = false; continue; }
      const rawT = Math.min(local / FLIGHT, 1);
      if (rawT < 1) allDone = false;
      const e = 1 - Math.pow(1 - rawT, 4);
      ctx.moveTo(mX, mY);
      for (let s = 1; s <= 8; s++) {
        const [x, y] = bezierXY(mX, mY, t.cx, t.cy, t.x, t.y, e * (s / 8));
        ctx.lineTo(x, y);
      }
    }
    ctx.strokeStyle = "rgba(200, 60, 50, 0.04)";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    for (const t of animated) {
      const local = elapsed - t.delay;
      if (local <= 0) continue;
      const rawT = Math.min(local / FLIGHT, 1);
      const e = 1 - Math.pow(1 - rawT, 4);
      ctx.moveTo(mX, mY);
      for (let s = 1; s <= 8; s++) {
        const [x, y] = bezierXY(mX, mY, t.cx, t.cy, t.x, t.y, e * (s / 8));
        ctx.lineTo(x, y);
      }
    }
    ctx.strokeStyle = "rgba(255, 180, 170, 0.06)";
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // Batch dots
    ctx.fillStyle = "rgba(255, 180, 170, 0.9)";
    ctx.beginPath();
    for (const t of animated) {
      const local = elapsed - t.delay;
      if (local <= 0) continue;
      const rawT = Math.min(local / FLIGHT, 1);
      const e = 1 - Math.pow(1 - rawT, 4);
      const [px, py] = bezierXY(mX, mY, t.cx, t.cy, t.x, t.y, e);
      ctx.moveTo(px + 2, py);
      ctx.arc(px, py, 2, 0, Math.PI * 2);
    }
    ctx.fill();

    if (allDone) {
      // Fade out canvas
      let fadeStart = now;
      function fade(now) {
        const t = Math.min((now - fadeStart) / 400, 1);
        canvas.style.opacity = String(1 - t);
        if (t < 1) {
          animFrameId = requestAnimationFrame(fade);
        } else {
          hideCanvas();
          onComplete?.();
        }
      }
      animFrameId = requestAnimationFrame(fade);
      return;
    }

    animFrameId = requestAnimationFrame(tick);
  }

  animFrameId = requestAnimationFrame(tick);
}

export function cancelAnimation() {
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  hideCanvas();
}
