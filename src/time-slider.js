/**
 * time-slider.js — Log-scale time slider with tick marks.
 *
 * Piecewise mapping:
 *   Left half (0-500):  log scale 300k BC → 3000 BC (deep time)
 *   Right half (500-1000): linear 3000 BC → 2100 AD (historical time)
 */

const MIN_YEAR = -300000;
const MAX_YEAR = 2100;
const SLIDER_MAX = 1000;
const SPLIT_POS = 500;
const SPLIT_YEAR = -3000;

function sliderToYear(pos) {
  if (pos <= 0) return MIN_YEAR;
  if (pos >= SLIDER_MAX) return MAX_YEAR;
  if (pos <= SPLIT_POS) {
    const t = pos / SPLIT_POS;
    const logMin = Math.log(MAX_YEAR + 1 - MIN_YEAR);
    const logSplit = Math.log(MAX_YEAR + 1 - SPLIT_YEAR);
    return Math.round(MAX_YEAR + 1 - Math.exp(logMin + t * (logSplit - logMin)));
  } else {
    const t = (pos - SPLIT_POS) / (SLIDER_MAX - SPLIT_POS);
    return Math.round(SPLIT_YEAR + t * (MAX_YEAR - SPLIT_YEAR));
  }
}

function yearToSlider(year) {
  if (year <= MIN_YEAR) return 0;
  if (year >= MAX_YEAR) return SLIDER_MAX;
  if (year <= SPLIT_YEAR) {
    const logMin = Math.log(MAX_YEAR + 1 - MIN_YEAR);
    const logSplit = Math.log(MAX_YEAR + 1 - SPLIT_YEAR);
    const logVal = Math.log(MAX_YEAR + 1 - year);
    return Math.round(((logVal - logMin) / (logSplit - logMin)) * SPLIT_POS);
  } else {
    const t = (year - SPLIT_YEAR) / (MAX_YEAR - SPLIT_YEAR);
    return Math.round(SPLIT_POS + t * (SLIDER_MAX - SPLIT_POS));
  }
}

export function formatYear(year) {
  if (year == null) return "";
  const abs = Math.abs(Math.round(year));
  if (abs >= 1000000) return `${(abs / 1000000).toFixed(1)}M ${year < 0 ? "BC" : "AD"}`;
  if (abs >= 10000) return `${(abs / 1000).toFixed(0)}k ${year < 0 ? "BC" : "AD"}`;
  if (year < 0) return `${abs} BC`;
  if (year === 0) return "1 AD";
  return `${abs} AD`;
}

/**
 * Initialize the time slider.
 * @param {Function} onChange — called with (lo, hi) or (null, null) for full range
 */
export function initTimeSlider(onChange) {
  const minInput = document.getElementById("time-min");
  const maxInput = document.getElementById("time-max");
  const labelStart = document.getElementById("time-label-start");
  const labelEnd = document.getElementById("time-label-end");

  minInput.min = 0; minInput.max = SLIDER_MAX; minInput.value = 0;
  maxInput.min = 0; maxInput.max = SLIDER_MAX; maxInput.value = SLIDER_MAX;
  labelStart.textContent = formatYear(MIN_YEAR);
  labelEnd.textContent = formatYear(MAX_YEAR);

  // Tick marks
  const TICKS = [-100000, -10000, -3000, 0, 1000, 2000];
  const tickContainer = document.createElement("div");
  tickContainer.id = "time-ticks";
  for (const year of TICKS) {
    const pos = yearToSlider(year);
    const pct = (pos / SLIDER_MAX) * 100;
    const tick = document.createElement("div");
    tick.className = "time-tick";
    tick.style.left = `${pct}%`;
    const label = document.createElement("span");
    label.className = "time-tick-label";
    label.textContent = year === 0 ? "0" : year < 0
      ? `${Math.abs(year) >= 1000 ? Math.abs(year) / 1000 + "k" : Math.abs(year)}`
      : `${year}`;
    tick.appendChild(label);
    tickContainer.appendChild(tick);
  }
  document.getElementById("time-slider").appendChild(tickContainer);

  // "Include undated" checkbox — after ticks
  const undatedLabel = document.createElement("label");
  undatedLabel.id = "include-undated";
  undatedLabel.innerHTML = `<input type="checkbox" id="undated-check" checked /> Include undated`;
  document.getElementById("time-slider").appendChild(undatedLabel);

  document.getElementById("undated-check").addEventListener("change", () => {
    update();
  });

  function update() {
    const loPos = parseInt(minInput.value, 10);
    const hiPos = parseInt(maxInput.value, 10);
    const lo = sliderToYear(loPos);
    const hi = sliderToYear(hiPos);
    labelStart.textContent = formatYear(lo);
    labelEnd.textContent = formatYear(hi);
    const isFullRange = loPos <= 0 && hiPos >= SLIDER_MAX;
    onChange(isFullRange ? null : lo, isFullRange ? null : hi);
  }

  let debounceId = null;

  function onSlide() {
    const loPos = parseInt(minInput.value, 10);
    const hiPos = parseInt(maxInput.value, 10);
    labelStart.textContent = formatYear(sliderToYear(loPos));
    labelEnd.textContent = formatYear(sliderToYear(hiPos));

    // Debounce the expensive server queries
    clearTimeout(debounceId);
    debounceId = setTimeout(update, 250);
  }

  minInput.addEventListener("input", () => {
    if (parseInt(minInput.value) > parseInt(maxInput.value)) maxInput.value = minInput.value;
    onSlide();
  });
  maxInput.addEventListener("input", () => {
    if (parseInt(maxInput.value) < parseInt(minInput.value)) minInput.value = maxInput.value;
    onSlide();
  });

  // Also fire immediately on release for final value
  minInput.addEventListener("change", update);
  maxInput.addEventListener("change", update);

  // Toggle button
  const slider = document.getElementById("time-slider");
  const toggle = document.createElement("button");
  toggle.id = "time-toggle";
  toggle.className = "active";
  toggle.title = "Toggle time slider";
  toggle.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  document.body.appendChild(toggle);

  // Collapse on mobile by default
  if (window.innerWidth <= 768) {
    slider.classList.add("collapsed");
    toggle.classList.remove("active");
  }

  toggle.addEventListener("click", () => {
    slider.classList.toggle("collapsed");
    toggle.classList.toggle("active");
  });
}

/**
 * Programmatically set the time slider range.
 */
export function getIncludeUndated() {
  const el = document.getElementById("undated-check");
  return el ? el.checked : true;
}

export function setTimeRange(lo, hi) {
  const minInput = document.getElementById("time-min");
  const maxInput = document.getElementById("time-max");
  const labelStart = document.getElementById("time-label-start");
  const labelEnd = document.getElementById("time-label-end");
  if (!minInput || !maxInput) return;
  minInput.value = yearToSlider(lo);
  maxInput.value = yearToSlider(hi);
  labelStart.textContent = formatYear(lo);
  labelEnd.textContent = formatYear(hi);
}
