# Artifact Explorer

Interactive 3D globe visualizing 270,000+ museum artifacts mapped back to their countries of origin.
  [Demo]([https://vitejs.dev/](https://esri-imagery-apps.s3.amazonaws.com/apps/artifact-explorer/index.html)

Explore artifacts from four of the world's largest collections:

- **British Museum** — London
- **Louvre** — Paris
- **The Metropolitan Museum of Art** — New York
- **Smithsonian Institution** — Washington, D.C.

## Features

- 3D globe (ArcGIS SceneView) with extruded country columns sized by artifact count
- Museum toggle pills — single click for exclusive, shift+click for multi-select
- Time slider with log-scale range filtering (300,000 BC to present)
- Dashboard with museum stats, top countries, timeline histogram, and collection origins flow diagram
- Country sidebar with scrollable thumbnail grid grouped by museum
- Artifact popup with hero image, metadata, and link to source collection
- Country highlight with darken mask on artifact selection

## Tech Stack

- [ArcGIS Maps SDK for JavaScript](https://developers.arcgis.com/javascript/) (v5, web components)
- [Vite](https://vitejs.dev/) build tool
- Hosted FeatureLayer on ArcGIS Online

## Data Sources

- [British Museum Collection](https://www.britishmuseum.org/collection)
- [Louvre Collections](https://collections.louvre.fr)
- [The Met Open Access](https://metmuseum.github.io)
- [Smithsonian Open Access](https://www.si.edu/openaccess)

This is not the full collection from these museums. Only artifacts with available images and identifiable countries of origin are included, representing a fraction of each museum's total holdings.
