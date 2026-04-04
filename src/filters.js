/**
 * filters.js — Centralized filter state and application.
 *
 * Manages museum, country, and time filters. Applies them to:
 *   - sceneLayer.definitionExpression (server-side, for particles mode)
 *   - queryLayer.definitionExpression (for all queries)
 *   - sceneLayerView.filter (client-side, GPU-accelerated, for time slider)
 */

let sceneLayerView = null;

/**
 * Initialize the filter system. Call after view is ready.
 * @param {SceneView} view
 * @param {SceneLayer} sceneLayer
 */
export async function initFilters(view, sceneLayer) {
  sceneLayerView = await view.whenLayerView(sceneLayer);
}

/**
 * Build a SQL WHERE clause from the current filter state.
 * @param {Object} state — { museum, country, timeRange }
 * @returns {string} SQL WHERE clause
 */
export function buildWhere(state) {
  const parts = [];
  if (Array.isArray(state.museum)) {
    const ids = state.museum.map((id) => `'${id}'`).join(",");
    parts.push(`museum_id IN (${ids})`);
  } else if (state.museum && state.museum !== "all") {
    parts.push(`museum_id = '${state.museum}'`);
  }
  if (state.country) {
    parts.push(`country = '${state.country.replace(/'/g, "''")}'`);
  }
  if (state.timeRange) {
    parts.push(`year_end >= ${state.timeRange.lo} AND year_start <= ${state.timeRange.hi}`);
  }
  return parts.length ? parts.join(" AND ") : "1=1";
}

/**
 * Apply filters to all layers.
 * For museum/country: uses definitionExpression (server-side).
 * For time: uses layerView.filter (client-side, instant).
 *
 * @param {Object} state — { museum, country, timeRange }
 * @param {Object} layers — { sceneLayer, queryLayer }
 */
export function applyFilters(state, layers) {
  // Museum + country filter → server-side definitionExpression
  const museumCountryParts = [];
  if (Array.isArray(state.museum)) {
    const ids = state.museum.map((id) => `'${id}'`).join(",");
    museumCountryParts.push(`museum_id IN (${ids})`);
  } else if (state.museum && state.museum !== "all") {
    museumCountryParts.push(`museum_id = '${state.museum}'`);
  }
  if (state.country) {
    museumCountryParts.push(`country = '${state.country.replace(/'/g, "''")}'`);
  }
  const serverExpr = museumCountryParts.length ? museumCountryParts.join(" AND ") : "1=1";

  layers.sceneLayer.definitionExpression = serverExpr;
  layers.queryLayer.definitionExpression = serverExpr;

  // Time filter → client-side layerView.filter (GPU-accelerated, instant)
  if (sceneLayerView) {
    if (state.timeRange) {
      sceneLayerView.filter = {
        where: `year_end >= ${state.timeRange.lo} AND year_start <= ${state.timeRange.hi}`,
      };
    } else {
      sceneLayerView.filter = null;
    }
  }
}

/**
 * Get the full WHERE clause for querying (includes time filter).
 * Used by sidebar, thumbnails, columns, arcs — anything that queries the queryLayer.
 */
export function getQueryWhere(state) {
  return buildWhere(state);
}

/**
 * Query the filtered artifact count.
 */
export async function getFilteredCount(queryLayer, state) {
  try {
    return await queryLayer.queryFeatureCount({ where: buildWhere(state) });
  } catch {
    return 0;
  }
}
