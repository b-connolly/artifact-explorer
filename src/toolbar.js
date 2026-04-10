/**
 * toolbar.js — Top-left controls: artifact count, view mode toggle, dashboard toggle.
 * Museum and country selection now handled by dashboard cards.
 */

import { toggleDashboard } from "./dashboard.js";
import { MUSEUMS } from "./museums.js";
import { MUSEUM_COLORS } from "./layers.js";

let countEl = null;
let countryCountEl = null;
let museumCountEl = null;
let filterBarEl = null;
let onResetMuseum = null;
let onResetCountry = null;
let onResetTime = null;

export function updateArtifactCount(count) {
  if (countEl) countEl.textContent = count.toLocaleString();
}

export function updateCountryCount(count) {
  if (countryCountEl) countryCountEl.textContent = count.toLocaleString();
}

export function updateMuseumCount(count) {
  if (museumCountEl) museumCountEl.textContent = count.toLocaleString();
}

export function updateFilterBar(state) {
  if (!filterBarEl) return;
  filterBarEl.innerHTML = "";

  const hasMuseum = state.museum && state.museum !== "all" ;
  const hasCountry = !!state.country;
  const hasRegion = !!state.regionCountries?.length;
  const hasTime = !!state.timeRange;
  const hasAny = hasMuseum || hasCountry || hasRegion || hasTime;

  if (!hasAny) {
    filterBarEl.style.display = "none";
    return;
  }
  filterBarEl.style.display = "flex";

  if (hasMuseum) {
    const label = Array.isArray(state.museum)
      ? state.museum.map(id => MUSEUMS[id]?.name || id).join(", ")
      : MUSEUMS[state.museum]?.name || state.museum;
    addChip(label, onResetMuseum);
  }

  if (hasCountry) {
    addChip(state.country, onResetCountry);
  } else if (hasRegion) {
    addChip("Region filter", onResetCountry);
  }

  if (hasTime) {
    const fmtY = (y) => y < 0 ? `${Math.abs(y).toLocaleString()} BC` : `${y} AD`;
    addChip(`${fmtY(state.timeRange.lo)} – ${fmtY(state.timeRange.hi)}`, onResetTime);
  }

  // Reset all
  if ([hasMuseum, hasCountry || hasRegion, hasTime].filter(Boolean).length > 1) {
    const resetAll = document.createElement("button");
    resetAll.className = "filter-chip filter-reset-all";
    resetAll.textContent = "Reset all";
    resetAll.addEventListener("click", () => {
      if (onResetAll) onResetAll();
    });
    filterBarEl.appendChild(resetAll);
  }

  function addChip(label, onClear) {
    const chip = document.createElement("div");
    chip.className = "filter-chip";
    const text = document.createElement("span");
    text.textContent = label;
    chip.appendChild(text);
    if (onClear) {
      const x = document.createElement("button");
      x.className = "filter-chip-x";
      x.textContent = "×";
      x.addEventListener("click", (e) => { e.stopPropagation(); onClear(); });
      chip.appendChild(x);
    }
    filterBarEl.appendChild(chip);
  }
}

/**
 * Initialize toolbar (top-left, below map widgets).
 * @param {Function} onMuseumChange — unused, kept for API compat
 * @param {Function} onCountryChange — unused
 * @param {Function} onViewModeChange — ("columns" | "particles" | "images")
 */
export function initToolbar(onMuseumChange, _onCountryChange, onViewModeChange) {
  const wrapper = document.createElement("div");
  wrapper.id = "toolbar-left";

  // --- Artifact count ---
  const countWrapper = document.createElement("div");
  countWrapper.id = "artifact-count";
  countEl = document.createElement("span");
  countEl.id = "artifact-count-value";
  countEl.textContent = "0";
  const countLabel = document.createElement("span");
  countLabel.id = "artifact-count-label";
  countLabel.textContent = "artifacts";
  countWrapper.appendChild(countEl);
  countWrapper.appendChild(countLabel);

  // --- Country count ---
  const countryWrapper = document.createElement("div");
  countryWrapper.id = "country-count";
  countryCountEl = document.createElement("span");
  countryCountEl.id = "country-count-value";
  countryCountEl.textContent = "0";
  const countryLabel = document.createElement("span");
  countryLabel.id = "country-count-label";
  countryLabel.textContent = "countries";
  countryWrapper.appendChild(countryCountEl);
  countryWrapper.appendChild(countryLabel);

  // --- Museum count ---
  const museumWrapper = document.createElement("div");
  museumWrapper.id = "museum-count";
  museumCountEl = document.createElement("span");
  museumCountEl.id = "museum-count-value";
  museumCountEl.textContent = Object.keys(MUSEUMS).length;
  const museumLabel = document.createElement("span");
  museumLabel.id = "museum-count-label";
  museumLabel.textContent = "museums";
  museumWrapper.appendChild(museumCountEl);
  museumWrapper.appendChild(museumLabel);

  // --- View mode toggle ---
  const modes = ["columns"]; // "images" hidden for now
  const icons = {
    columns: `<svg viewBox="0 0 24 24" width="16" height="16"><rect x="4" y="10" width="4" height="10" rx="1" fill="currentColor" opacity="0.7"/><rect x="10" y="4" width="4" height="16" rx="1" fill="currentColor" opacity="0.9"/><rect x="16" y="7" width="4" height="13" rx="1" fill="currentColor" opacity="0.5"/></svg>`,
    particles: `<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="5" fill="currentColor" opacity="0.9"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" opacity="0.3" stroke-width="1.5"/></svg>`,
    images: `<svg viewBox="0 0 24 24" width="16" height="16"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.9"/><circle cx="8.5" cy="10.5" r="2" fill="currentColor" opacity="0.6"/><path d="M3 16l5-4 3 2.5 4-5 6 6.5" stroke="currentColor" fill="none" stroke-width="1.5" opacity="0.7"/></svg>`,
  };
  const titles = { columns: "Columns view", particles: "Particles view", images: "Images view" };

  let currentModeIdx = 0;
  const modeToggle = document.createElement("button");
  modeToggle.id = "view-mode-toggle";
  modeToggle.className = `mode-${modes[0]}`;
  modeToggle.title = titles[modes[0]];
  modeToggle.innerHTML = icons[modes[0]];

  modeToggle.addEventListener("click", () => {
    currentModeIdx = (currentModeIdx + 1) % modes.length;
    const mode = modes[currentModeIdx];
    modeToggle.className = `mode-${mode}`;
    modeToggle.title = titles[mode];
    modeToggle.innerHTML = icons[mode];
    onViewModeChange(mode);
  });

  // --- Dashboard toggle ---
  const dashToggle = document.createElement("button");
  dashToggle.id = "dash-toggle";
  dashToggle.title = "Toggle dashboard";
  dashToggle.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14"><rect x="3" y="14" width="4" height="7" rx="1" fill="currentColor" opacity="0.6"/><rect x="10" y="7" width="4" height="14" rx="1" fill="currentColor" opacity="0.8"/><rect x="17" y="3" width="4" height="18" rx="1" fill="currentColor"/></svg>`;
  dashToggle.addEventListener("click", () => toggleDashboard());
  // Dashboard starts open on desktop
  if (window.innerWidth > 768) dashToggle.classList.add("active");

  // --- Museum multi-select pills ---
  const museumBar = document.createElement("div");
  museumBar.id = "museum-pills";

  const museumIds = Object.keys(MUSEUMS);
  for (const id of museumIds) {
    const color = MUSEUM_COLORS[id] || MUSEUMS[id].color;
    const pill = document.createElement("button");
    pill.className = "museum-pill active";
    pill.dataset.museum = id;
    pill.title = MUSEUMS[id].name;
    pill.innerHTML = `<span class="pill-dot" style="background:rgb(${color.join(",")})"></span><span class="pill-label">${MUSEUMS[id].name}</span>`;
    pill.addEventListener("click", () => {
      const pills = [...museumBar.querySelectorAll(".museum-pill")];

      // Toggle this pill
      pill.classList.toggle("active");

      // If none are active, re-select all
      const activePills = pills.filter((p) => p.classList.contains("active"));
      if (activePills.length === 0) {
        pills.forEach((p) => p.classList.add("active"));
      }

      const active = [...museumBar.querySelectorAll(".museum-pill.active")].map((p) => p.dataset.museum);
      updateMuseumCount(active.length);
      onMuseumChange(active);
    });
    museumBar.appendChild(pill);
  }

  // --- Info button (top-left, inline with counts) ---
  const infoBtn = document.createElement("button");
  infoBtn.id = "info-toggle";
  infoBtn.title = "About Artifact Explorer";
  infoBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><text x="12" y="17" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor" font-family="Georgia,serif">i</text></svg>`;
  infoBtn.addEventListener("click", () => toggleInfoSplash());

  // --- Legend toggle ---
  const legendToggle = document.createElement("button");
  legendToggle.id = "legend-toggle";
  legendToggle.title = "Toggle legend";
  legendToggle.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="4" rx="1" fill="currentColor" opacity="0.4"/><line x1="13" y1="5" x2="21" y2="5"/><rect x="3" y="10" width="7" height="4" rx="1" fill="currentColor" opacity="0.6"/><line x1="13" y1="12" x2="21" y2="12"/><rect x="3" y="17" width="7" height="4" rx="1" fill="currentColor" opacity="0.8"/><line x1="13" y1="19" x2="21" y2="19"/></svg>`;
  legendToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    let panel = document.getElementById("legend-panel");
    if (!panel) {
      panel = createLegendPanel(onMuseumChange);
      document.body.appendChild(panel);
      requestAnimationFrame(() => panel.classList.add("visible"));
    } else {
      panel.classList.toggle("visible");
    }
  });

  // Close legend on tap outside
  document.addEventListener("click", (e) => {
    const panel = document.getElementById("legend-panel");
    if (panel?.classList.contains("visible") && !panel.contains(e.target) && !e.target.closest("#legend-toggle")) {
      panel.classList.remove("visible");
    }
  });

  // --- Filter bar ---
  filterBarEl = document.createElement("div");
  filterBarEl.id = "filter-bar";
  filterBarEl.style.display = "none";

  wrapper.appendChild(countWrapper);
  wrapper.appendChild(countryWrapper);
  wrapper.appendChild(museumWrapper);
  document.body.appendChild(wrapper);
  document.body.appendChild(filterBarEl);
  document.body.appendChild(museumBar);

  // --- Controls tray (bottom-right) ---
  const spinToggle = document.createElement("button");
  spinToggle.id = "spin-toggle";
  spinToggle.title = "Toggle globe spin";
  spinToggle.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>`;

  const tray = document.createElement("div");
  tray.id = "controls-tray";
  tray.appendChild(infoBtn);
  tray.appendChild(dashToggle);
  tray.appendChild(legendToggle);
  // time-toggle is appended by time-slider.js, will be moved into tray
  tray.appendChild(spinToggle);
  document.body.appendChild(tray);

  // Move time-toggle into tray once it's created (by time-slider.js)
  const observer = new MutationObserver(() => {
    const timeToggle = document.getElementById("time-toggle");
    if (timeToggle && timeToggle.parentElement !== tray) {
      tray.insertBefore(timeToggle, spinToggle);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });

  // Reveal controls tray when hovering related UI elements
  let revealTimeout = null;
  const revealTray = () => {
    clearTimeout(revealTimeout);
    tray.classList.add("revealed");
  };
  const hideTray = () => {
    revealTimeout = setTimeout(() => tray.classList.remove("revealed"), 400);
  };

  for (const el of [wrapper, museumBar]) {
    el.addEventListener("mouseenter", revealTray);
    el.addEventListener("mouseleave", hideTray);
  }
  // Dashboard and time-slider are created elsewhere — bind after DOM ready
  requestAnimationFrame(() => {
    for (const id of ["dashboard", "time-slider"]) {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener("mouseenter", revealTray);
        el.addEventListener("mouseleave", hideTray);
      }
    }
  });
  // Keep tray visible while hovering tray itself
  tray.addEventListener("mouseenter", () => clearTimeout(revealTimeout));
  tray.addEventListener("mouseleave", hideTray);
}

let onResetAll = null;

export function registerResetCallbacks(resetMuseum, resetCountry, resetTime, resetAll) {
  onResetMuseum = resetMuseum;
  onResetCountry = resetCountry;
  onResetTime = resetTime;
  onResetAll = resetAll;
}

// --- Legend panel ---

function createLegendPanel(onMuseumChange) {
  const panel = document.createElement("div");
  panel.id = "legend-panel";
  panel.innerHTML = `
    <div class="legend-section">
      <div class="legend-heading">Museums</div>
      <div class="legend-item legend-museum-item" data-museum="british_museum">
        <span class="legend-dot" style="background:rgb(50,70,170)"></span>
        <span>British Museum</span>
      </div>
      <div class="legend-item legend-museum-item" data-museum="louvre">
        <span class="legend-dot" style="background:rgb(0,160,190)"></span>
        <span>Louvre</span>
      </div>
      <div class="legend-item legend-museum-item" data-museum="met">
        <span class="legend-dot" style="background:rgb(150,50,150)"></span>
        <span>The Met</span>
      </div>
      <div class="legend-item legend-museum-item" data-museum="smithsonian">
        <span class="legend-dot" style="background:rgb(0,112,68)"></span>
        <span>Smithsonian</span>
      </div>
    </div>
    <div class="legend-section legend-note">
      <svg width="16" height="16" viewBox="0 0 16 16">
        <rect x="1" y="2" width="3" height="14" rx="1" fill="rgba(50,70,170,0.7)"/>
        <rect x="5" y="6" width="3" height="10" rx="1" fill="rgba(0,160,190,0.7)"/>
        <rect x="9" y="10" width="3" height="6" rx="1" fill="rgba(150,50,150,0.7)"/>
        <rect x="13" y="8" width="3" height="8" rx="1" fill="rgba(0,112,68,0.7)"/>
      </svg>
      Column height represents artifact count
    </div>
    <div class="legend-section legend-note">
      <svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 14 Q8 2 14 8" stroke="rgba(0,233,255,0.6)" stroke-width="1.5" fill="none"/></svg>
      Arcs trace artifacts from country of origin to museum
    </div>
  `;

  // Click museum rows to filter
  panel.querySelectorAll(".legend-museum-item").forEach((item) => {
    item.addEventListener("click", () => {
      const museumId = item.dataset.museum;
      // Update pills
      const pills = document.querySelectorAll("#museum-pills .museum-pill");
      pills.forEach((p) => {
        if (p.dataset.museum === museumId) p.classList.add("active");
        else p.classList.remove("active");
      });
      onMuseumChange([museumId]);
    });
  });

  return panel;
}

// --- Info splash modal ---

function createInfoModal() {
  const modal = document.createElement("div");
  modal.id = "info-splash";
  modal.innerHTML = `
    <div class="info-backdrop"></div>
    <div class="info-panel">
      <button class="info-close">&times;</button>
      <h1 class="info-title">Artifact Explorer</h1>
      <p class="info-subtitle">An interactive 3D globe visualizing over <strong>253,000 artifacts</strong> held in the world's major museums, mapped back to their countries of origin.</p>
      <p class="info-subtitle">Select a country to see which museums hold its cultural heritage and explore individual pieces from each collection.</p>
      <div class="info-museums">
        <a class="info-museum" style="--mc: rgb(50,70,170)" href="https://www.britishmuseum.org/collection" target="_blank">The British Museum</a>
        <a class="info-museum" style="--mc: rgb(0,160,190)" href="https://collections.louvre.fr" target="_blank">The Louvre Museum</a>
        <a class="info-museum" style="--mc: rgb(150,50,150)" href="https://metmuseum.github.io" target="_blank">The Metropolitan Museum of Art</a>
        <a class="info-museum" style="--mc: rgb(0,112,68)" href="https://www.si.edu/openaccess" target="_blank">Smithsonian Institution</a>
      </div>
      <p class="info-note">Partial collection. Only artifacts with images and identifiable origins are shown.</p>
      <div class="info-footer">
        <label class="info-dismiss"><input type="checkbox" id="info-dismiss-check" /> Don't show again</label>
        <a class="info-github" href="https://github.com/b-connolly/ArtifactExplorer" target="_blank">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.2 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5 1 .1-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6.02 0c2.28-1.55 3.29-1.23 3.29-1.23.66 1.66.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.21.7.82.58A12 12 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
          GitHub
        </a>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  function closeModal() {
    modal.classList.remove("visible");
    if (modal.querySelector("#info-dismiss-check").checked) {
      localStorage.setItem("artifact-explorer-hide-info", "1");
    }
  }

  modal.querySelector(".info-backdrop").addEventListener("click", closeModal);
  modal.querySelector(".info-close").addEventListener("click", closeModal);

  return modal;
}

function toggleInfoSplash() {
  let modal = document.getElementById("info-splash");
  if (!modal) modal = createInfoModal();
  modal.classList.toggle("visible");
}

// Auto-show on first visit
if (!localStorage.getItem("artifact-explorer-hide-info")) {
  const modal = createInfoModal();
  requestAnimationFrame(() => modal.classList.add("visible"));
}

// --- Image progress bar ---

export function showImageProgress(loaded, total) {
  let bar = document.getElementById("image-progress");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "image-progress";
    bar.innerHTML = `
      <div id="image-progress-track"><div id="image-progress-fill"></div></div>
      <span id="image-progress-text"></span>
    `;
    document.body.appendChild(bar);
  }
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
  bar.querySelector("#image-progress-fill").style.width = `${pct}%`;
  bar.querySelector("#image-progress-text").textContent = `Loading images: ${loaded.toLocaleString()} / ${total.toLocaleString()}`;
  bar.style.display = "flex";

  if (loaded >= total) {
    setTimeout(() => {
      bar.style.opacity = "0";
      setTimeout(() => { bar.style.display = "none"; bar.style.opacity = "1"; }, 400);
    }, 600);
  }
}

export function hideImageProgress() {
  const bar = document.getElementById("image-progress");
  if (bar) bar.style.display = "none";
}
