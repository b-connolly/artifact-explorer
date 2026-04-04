/**
 * columns.js — Gaussian-distributed grid of glowing columns per country.
 *
 * For each country with artifacts:
 *   - Generate a grid of points centered on the country centroid
 *   - Distribute artifact count across grid cells using 2D Gaussian
 *   - Tallest column at center, tapering to edges
 *   - Grid density adapts to count: many artifacts = dense grid, few = sparse
 *   - Emissive ObjectSymbol3DLayer cubes with Glow post-processing
 */

import Graphic from "@arcgis/core/Graphic.js";
import Point from "@arcgis/core/geometry/Point.js";
import PointSymbol3D from "@arcgis/core/symbols/PointSymbol3D.js";
import ObjectSymbol3DLayer from "@arcgis/core/symbols/ObjectSymbol3DLayer.js";
import { MUSEUM_COLORS } from "./layers.js";
import { getQueryWhere } from "./filters.js";

let centroids = null;
let countryPolygonCache = {}; // country name → polygon geometry
let unfilteredMax = null; // cached max country count with no filters
let updateGen = 0;

async function loadCentroids() {
  if (centroids) return centroids;
  const resp = await fetch(import.meta.env.BASE_URL + "data/centroids.json");
  centroids = await resp.json();
  return centroids;
}

// Our country names → Living Atlas COUNTRY field
export const COUNTRY_NAME_MAP = {
  "United States of America": "United States",
  "Turkey": "Turkiye",
  "Russia": "Russian Federation",
  "Korea": "South Korea",
  "Korea, Republic of": "South Korea",
  "Tanzania, United Republic of": "Tanzania",
  "Democratic Republic of the Congo": "Congo DRC",
  "Republic of the Congo": "Congo",
  "Myanmar": "Myanmar",
};

// Country size hints (degrees radius) — rough geographic spread
const COUNTRY_RADIUS = {
  "Russia": 12, "China": 8, "United States of America": 8, "Brazil": 7,
  "India": 5, "Australia": 7, "Argentina": 6, "Mexico": 5, "Iran": 4,
  "Iraq": 3, "Egypt": 4, "Turkey": 3.5, "France": 3, "Germany": 2.5,
  "Italy": 3, "Spain": 3, "United Kingdom": 2, "Japan": 3, "Greece": 2,
  "Peru": 4, "Colombia": 3, "Afghanistan": 3, "Pakistan": 3,
  "Indonesia": 6, "Cambodia": 2, "Thailand": 3, "Vietnam": 3,
  "Syria": 2, "Lebanon": 0.8, "Israel": 0.8, "Jordan": 1.5, "Cyprus": 0.5,
  "Nigeria": 3, "Ethiopia": 3, "Kenya": 2.5, "Ghana": 2, "Mali": 4,
  "Morocco": 3, "Algeria": 6, "Tunisia": 1.5, "Sudan": 5, "South Africa": 4,
  "Nepal": 2, "Sri Lanka": 1.2, "Myanmar": 3, "Korea": 2,
  "Netherlands": 1, "Belgium": 0.8, "Austria": 1.5, "Switzerland": 1,
  "Sweden": 3, "Norway": 3, "Denmark": 1.5, "Poland": 2.5,
  "Czech Republic": 1.5, "Hungary": 1.5, "Portugal": 1.5, "Bolivia": 3,
  "Guatemala": 1.5, "Cuba": 2, "Uzbekistan": 2.5, "Mongolia": 4,
};

const COUNTRIES_URL = "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/World_Countries_(Generalized)/FeatureServer/0";

const MAX_GRID_CELLS = 120;
const MIN_GRID_CELLS = 1;
const MAX_HEIGHT = 2000000;   // 2000km — dramatic center columns
const MIN_HEIGHT = 8000;      // 8km — barely visible edge columns
const CUBE_WIDTH = 35000;     // 35km base

/**
 * Fetch country polygon from Living Atlas (cached).
 */
async function getCountryPolygon(countryName) {
  const atlasName = COUNTRY_NAME_MAP[countryName] || countryName;
  if (countryPolygonCache[atlasName]) return countryPolygonCache[atlasName];

  try {
    const url = `${COUNTRIES_URL}/query?where=COUNTRY='${encodeURIComponent(atlasName)}'&outFields=COUNTRY&returnGeometry=true&outSR=4326&f=json`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.features?.length > 0) {
      // Convert ArcGIS REST JSON to a simple ring array
      const rings = data.features[0].geometry.rings;
      const sr = data.spatialReference || { wkid: 4326 };
      countryPolygonCache[atlasName] = { rings, sr };
      return countryPolygonCache[atlasName];
    }
  } catch (e) { /* fall through */ }
  return null;
}

/**
 * Check if a point is inside polygon rings (ray casting).
 */
function pointInRings(lng, lat, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/**
 * Generate a Gaussian-distributed grid filling a country polygon.
 * Tallest columns at centroid, tapering to edges.
 */
// Max bounding box size (degrees) — capped to Turkey-sized spread
const MAX_BBOX_DEG = 14;

function generateGrid(centroid, polygon, numCells) {
  if (numCells <= 1 || !polygon) {
    return [{ lng: centroid.lng, lat: centroid.lat, weight: 1.0 }];
  }

  // Find polygon bounding box
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const ring of polygon.rings) {
    for (const [x, y] of ring) {
      if (x < minLng) minLng = x;
      if (x > maxLng) maxLng = x;
      if (y < minLat) minLat = y;
      if (y > maxLat) maxLat = y;
    }
  }

  let width = maxLng - minLng;
  let height = maxLat - minLat;

  // Clamp bbox to MAX_BBOX_DEG centered on centroid — keeps large countries compact
  if (width > MAX_BBOX_DEG) {
    minLng = centroid.lng - MAX_BBOX_DEG / 2;
    maxLng = centroid.lng + MAX_BBOX_DEG / 2;
    width = MAX_BBOX_DEG;
  }
  if (height > MAX_BBOX_DEG) {
    minLat = centroid.lat - MAX_BBOX_DEG / 2;
    maxLat = centroid.lat + MAX_BBOX_DEG / 2;
    height = MAX_BBOX_DEG;
  }

  const maxDim = Math.max(width, height);

  // Grid spacing — aim for ~numCells points inside the polygon
  // Overshoot by 2x since many grid points will fall outside polygon
  const area = width * height;
  const spacing = Math.sqrt(area / (numCells * 2));

  // Gaussian sigma — tight bell curve, dramatic center peak
  const sigma = maxDim * 0.18;

  const points = [];

  for (let lng = minLng + spacing / 2; lng <= maxLng; lng += spacing) {
    for (let lat = minLat + spacing / 2; lat <= maxLat; lat += spacing) {
      if (!pointInRings(lng, lat, polygon.rings)) continue;

      // Distance from centroid
      const dx = lng - centroid.lng;
      const dy = lat - centroid.lat;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // 2D Gaussian weight
      const weight = Math.exp(-(dist * dist) / (2 * sigma * sigma));
      if (weight < 0.005) continue;

      points.push({ lng, lat, weight });
    }
  }

  // Cap at MAX_GRID_CELLS — keep highest weighted
  if (points.length > numCells) {
    points.sort((a, b) => b.weight - a.weight);
    points.length = numCells;
  }

  // If polygon query failed to produce points, fallback to centroid
  if (points.length === 0) {
    return [{ lng: centroid.lng, lat: centroid.lat, weight: 1.0 }];
  }

  // Normalize weights
  const totalWeight = points.reduce((s, p) => s + p.weight, 0);
  for (const p of points) p.weight /= totalWeight;

  return points;
}

/**
 * Build columns + update country highlights.
 */
export async function updateColumns(queryLayer, state, layers) {
  const { columnLayer } = layers;
  const thisGen = ++updateGen;

  const where = getQueryWhere(state);

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

  // Bail if a newer call superseded this one
  if (thisGen !== updateGen) return;

  // Aggregate per country
  const countries = {};
  for (const f of result.features) {
    const { country, museum_id, cnt } = f.attributes;
    if (!country) continue;
    if (!countries[country]) countries[country] = { total: 0, dominant: null, dominantCnt: 0, museums: {} };
    countries[country].total += cnt;
    countries[country].museums[museum_id] = (countries[country].museums[museum_id] || 0) + cnt;
    if (cnt > countries[country].dominantCnt) {
      countries[country].dominant = museum_id;
      countries[country].dominantCnt = cnt;
    }
  }

  // Query unfiltered max once so columns shrink visibly when filtered
  if (unfilteredMax === null) {
    const unfilteredResult = await queryLayer.queryFeatures({
      where: "1=1",
      outStatistics: [{ statisticType: "count", onStatisticField: "ObjectId", outStatisticFieldName: "cnt" }],
      groupByFieldsForStatistics: ["country"],
      returnGeometry: false,
    });
    unfilteredMax = 0;
    for (const f of unfilteredResult.features) {
      if (f.attributes.cnt > unfilteredMax) unfilteredMax = f.attributes.cnt;
    }
  }
  const globalMax = unfilteredMax;

  if (thisGen !== updateGen) return;

  const centroidsJson = await loadCentroids();

  // Fetch all needed country polygons in parallel (cached individually)
  const countryNames = Object.keys(countries);
  const polygonResults = await Promise.all(countryNames.map((c) => getCountryPolygon(c)));
  const polygons = {};
  countryNames.forEach((c, i) => { polygons[c] = polygonResults[i]; });

  if (thisGen !== updateGen) return;

  const graphics = [];

  for (const [country, data] of Object.entries(countries)) {
    const c = centroidsJson[country];
    if (!c) continue;

    const polygon = polygons[country];

    // Grid density uses log scale
    const logRatio = Math.log10(data.total + 1) / Math.log10(globalMax + 1);
    const numCells = Math.max(MIN_GRID_CELLS, Math.round(logRatio * MAX_GRID_CELLS));
    const grid = generateGrid(c, polygon, numCells);

    // Height uses sqrt scale
    const linearRatio = data.total / globalMax;
    const countryMaxHeight = MIN_HEIGHT + Math.sqrt(linearRatio) * (MAX_HEIGHT - MIN_HEIGHT);
    const maxWeight = Math.max(...grid.map((g) => g.weight));

    // Build museum proportion array
    const museumEntries = Object.entries(data.museums).sort((a, b) => b[1] - a[1]);
    const museumProportions = museumEntries.map(([mid, cnt]) => ({
      id: mid,
      color: MUSEUM_COLORS[mid] || [200, 60, 50],
      proportion: cnt / data.total,
    }));

    // Assign each grid cell a museum using largest remainder + shuffle
    const museumCounters = museumProportions.map((m) => ({
      ...m, target: m.proportion * grid.length, assigned: 0,
    }));
    const cellMuseums = [];
    for (let gi = 0; gi < grid.length; gi++) {
      let best = 0, bestNeed = -Infinity;
      for (let mi = 0; mi < museumCounters.length; mi++) {
        const need = museumCounters[mi].target - museumCounters[mi].assigned;
        if (need > bestNeed) { bestNeed = need; best = mi; }
      }
      museumCounters[best].assigned++;
      cellMuseums.push(best);
    }
    for (let i = cellMuseums.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cellMuseums[i], cellMuseums[j]] = [cellMuseums[j], cellMuseums[i]];
    }

    for (let gi = 0; gi < grid.length; gi++) {
      const cell = grid[gi];
      const museum = museumProportions[cellMuseums[gi]];
      const color = museum.color;
      const norm = cell.weight / maxWeight;
      const height = MIN_HEIGHT + Math.pow(norm, 2) * (countryMaxHeight - MIN_HEIGHT);
      const clampedHeight = Math.max(height, MIN_HEIGHT);
      const brightness = 0.1 + Math.pow(norm, 1.5) * 0.6;

      graphics.push(new Graphic({
        geometry: new Point({
          longitude: cell.lng, latitude: cell.lat,
          spatialReference: { wkid: 4326 },
        }),
        symbol: new PointSymbol3D({
          symbolLayers: [
            new ObjectSymbol3DLayer({
              resource: { primitive: "cube" },
              material: {
                color: [...color, brightness],
                emissive: { source: "color", strength: 1.2 },
              },
              width: CUBE_WIDTH, depth: CUBE_WIDTH,
              height: clampedHeight, anchor: "bottom",
            }),
          ],
        }),
        attributes: {
          country, museum_id: museum.id,
          total: data.total, museums: data.museums,
          dominant_museum: data.dominant,
        },
        popupEnabled: false,
      }));
    }
  }

  if (thisGen !== updateGen) return;

  columnLayer.removeAll();
  columnLayer.addMany(graphics);

}

export function clearColumns(layers) {
  layers.columnLayer.removeAll();
}

