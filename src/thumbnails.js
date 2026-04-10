/**
 * thumbnails.js — Image mode: sampled thumbnails on the globe.
 *
 * Loads 150 S3 thumbnails evenly sampled across the filtered dataset.
 * Shows colored dot placeholders instantly, then swaps to real images
 * progressively as they load.
 */

import Graphic from "@arcgis/core/Graphic.js";
import PointSymbol3D from "@arcgis/core/symbols/PointSymbol3D.js";
import IconSymbol3DLayer from "@arcgis/core/symbols/IconSymbol3DLayer.js";
import { getQueryWhere } from "./filters.js";
import { buildPopup, MUSEUM_COLORS } from "./layers.js";

const MAX_THUMBNAILS = 150;
const THUMB_FIELDS = [
  "artifact_id", "title", "image_url", "museum_id", "country",
  "date_range", "year_start", "year_end", "category", "source_url",
];

let lastFilterKey = "";
let sharedPopup = null;

// Pre-build one placeholder symbol per museum (reused across all graphics)
const placeholderSymbols = {};
for (const [id, color] of Object.entries(MUSEUM_COLORS)) {
  placeholderSymbols[id] = new PointSymbol3D({
    symbolLayers: [
      new IconSymbol3DLayer({
        resource: { primitive: "circle" },
        material: { color },
        size: 12,
      }),
    ],
  });
}
const defaultPlaceholder = new PointSymbol3D({
  symbolLayers: [
    new IconSymbol3DLayer({
      resource: { primitive: "circle" },
      material: { color: [150, 150, 150] },
      size: 12,
    }),
  ],
});

/**
 * Load sampled thumbnails into the thumbLayer.
 */
export async function loadThumbnails(queryLayer, thumbLayer, state, showProgress, hideProgress) {
  if (!sharedPopup) sharedPopup = buildPopup();

  const where = getQueryWhere(state);
  const filterKey = `${where}_images`;
  if (filterKey === lastFilterKey && thumbLayer.graphics.length > 0) return;
  lastFilterKey = filterKey;

  thumbLayer.removeAll();
  showProgress(0, 1);

  // Get total to decide sampling strategy
  const totalCount = await queryLayer.queryFeatureCount({ where });

  let features = [];
  if (totalCount <= MAX_THUMBNAILS) {
    const result = await queryLayer.queryFeatures({
      where,
      outFields: THUMB_FIELDS,
      returnGeometry: true,
      maxRecordCount: MAX_THUMBNAILS,
    });
    features = result.features;
  } else {
    // Sample across dataset with evenly-spaced offsets
    const PAGES = 5;
    const perPage = Math.ceil(MAX_THUMBNAILS / PAGES);
    const step = Math.floor(totalCount / PAGES);
    const queries = [];
    for (let i = 0; i < PAGES; i++) {
      queries.push(queryLayer.queryFeatures({
        where,
        outFields: THUMB_FIELDS,
        returnGeometry: true,
        maxRecordCount: perPage,
        start: i * step,
      }));
    }
    const results = await Promise.all(queries);
    for (const r of results) features.push(...r.features);
  }

  // Only S3 URLs (avoid 429s from museum CDNs)
  features = features.filter((f) => {
    const url = f.attributes.image_url;
    return url && url.includes("s3.amazonaws.com");
  });

  if (features.length > MAX_THUMBNAILS) features.length = MAX_THUMBNAILS;

  const total = features.length;
  if (total === 0) { hideProgress(); return; }

  // Phase 1: Add all graphics with placeholder dot symbols (instant)
  const graphics = features.map((f) => {
    const a = f.attributes;
    return new Graphic({
      geometry: f.geometry,
      symbol: placeholderSymbols[a.museum_id] || defaultPlaceholder,
      attributes: { ...a, _thumbUrl: a.image_url },
      popupTemplate: sharedPopup,
    });
  });

  thumbLayer.addMany(graphics);
  showProgress(0, total);

  // Phase 2: Swap to real images progressively as they load
  let loaded = 0;
  const CONCURRENCY = 8;
  let idx = 0;

  async function loadNext() {
    while (idx < graphics.length) {
      const i = idx++;
      const g = graphics[i];
      const url = g.attributes._thumbUrl;
      try {
        await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = resolve;
          img.onerror = reject;
          img.src = url;
        });
        g.symbol = {
          type: "point-3d",
          symbolLayers: [{
            type: "icon",
            resource: { href: url },
            size: 28,
          }],
        };
      } catch {
        // Image failed — keep placeholder
      }
      showProgress(++loaded, total);
    }
  }

  // Run CONCURRENCY image loads in parallel
  await Promise.all(Array.from({ length: CONCURRENCY }, loadNext));
  hideProgress();
}

export function clearThumbnails(thumbLayer) {
  thumbLayer.removeAll();
  lastFilterKey = "";
}
