/**
 * thumbnails.js — Image mode: sampled thumbnails on the globe.
 *
 * Loads 500 S3 thumbnails evenly sampled across the filtered dataset,
 * displayed as IconSymbol3DLayer icons within country boundaries.
 */

import Graphic from "@arcgis/core/Graphic.js";
import { getQueryWhere } from "./filters.js";
import { buildPopup } from "./layers.js";

const MAX_THUMBNAILS = 500;
const THUMB_FIELDS = [
  "artifact_id", "title", "image_url", "museum_id", "country",
  "date_range", "year_start", "year_end", "category", "source_url",
];

let lastFilterKey = "";
let sharedPopup = null;

/**
 * Load sampled thumbnails into the thumbLayer.
 * @param {FeatureLayer} queryLayer
 * @param {GraphicsLayer} thumbLayer
 * @param {Object} state
 * @param {Function} showProgress — (loaded, total)
 * @param {Function} hideProgress
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

  showProgress(0, total);

  const BATCH = 100;
  let loaded = 0;

  for (let i = 0; i < features.length; i += BATCH) {
    const batch = features.slice(i, i + BATCH);
    const graphics = batch.map((f) => {
      const a = f.attributes;
      return new Graphic({
        geometry: f.geometry,
        symbol: {
          type: "point-3d",
          symbolLayers: [{
            type: "icon",
            resource: { href: a.image_url },
            size: 28,
          }],
        },
        attributes: { ...a, _thumbUrl: a.image_url },
        popupTemplate: sharedPopup,
      });
    });

    thumbLayer.addMany(graphics);
    loaded += batch.length;
    showProgress(loaded, total);
    await new Promise((r) => setTimeout(r, 30));
  }
}

export function clearThumbnails(thumbLayer) {
  thumbLayer.removeAll();
  lastFilterKey = "";
}
