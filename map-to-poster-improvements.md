# MapToPoster — Implementation Guide for 3 New Features

This document provides concrete, file-by-file implementation guidance for adding **SVG export**, **square selection**, and **street name labels** to the [dimartarmizi/map-to-poster](https://github.com/dimartarmizi/map-to-poster) app.

---

## Architecture Overview (Current)

```
main.js                         → Entry point, wires export button
src/core/state.js               → Reactive state store + localStorage
src/core/export.js              → captureMapSnapshot() + exportToPNG()
src/core/artistic-themes.js     → Color definitions for MapLibre themes
src/map/map-init.js             → Leaflet + MapLibre GL init, generateMapLibreStyle()
src/ui/form.js                  → All sidebar controls + updatePreviewStyles()
```

Key insight: the app has **two rendering engines** running simultaneously:
- **Tile mode** — Leaflet with raster tiles (CartoDB, ESRI, etc.)
- **Artistic mode** — MapLibre GL with OpenFreeMap vector tiles

SVG export and street names are naturally suited to the **Artistic (MapLibre GL) mode** because it already uses vector data from `tiles.openfreemap.org/planet`. The Leaflet mode renders raster tiles that cannot produce true vector SVG output.

---

## Feature 1: Export to SVG

### Strategy

There are two approaches, and the best choice depends on the render mode:

| Mode | Approach | Fidelity |
|------|----------|----------|
| **Artistic (MapLibre GL)** | Query `map.queryRenderedFeatures()` → build SVG `<path>` elements from the GeoJSON geometries | True vector SVG — scales infinitely |
| **Tile (Leaflet)** | Embed the raster snapshot as `<image>` inside an SVG wrapper | Pseudo-SVG (raster inside vector container) |

The high-value implementation is the **Artistic mode** path, which produces genuine vector output.

### New file: `src/core/export-svg.js`

```javascript
import { getArtisticMapInstance, getMapInstance } from '../map/map-init.js';
import { state, getSelectedArtisticTheme, getSelectedTheme } from './state.js';

/**
 * Convert a MapLibre GL map's rendered features into a true SVG document.
 * Works only in Artistic mode — falls back to raster-in-SVG for Tile mode.
 */
export async function exportToSVG(element, filename, statusElement) {
  if (statusElement) statusElement.classList.remove('hidden');

  try {
    const isArtistic = state.renderMode === 'artistic';
    const width = state.width;
    const height = state.height;
    const matWidth = state.matEnabled ? (state.matWidth || 0) : 0;

    let svgContent;
    if (isArtistic) {
      svgContent = buildVectorSVG(width, height, matWidth);
    } else {
      svgContent = await buildRasterSVG(width, height, matWidth);
    }

    // Download
    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = filename;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('SVG export failed:', err);
    alert('SVG export failed. Please try again.');
  } finally {
    if (statusElement) statusElement.classList.add('hidden');
  }
}

function buildVectorSVG(width, height, matWidth) {
  const map = getArtisticMapInstance();
  const theme = getSelectedArtisticTheme();
  if (!map) throw new Error('Artistic map not initialized');

  const effectiveW = width - 2 * matWidth;
  const effectiveH = height - 2 * matWidth;

  // Query ALL rendered features from the map's current viewport
  const features = map.queryRenderedFeatures();

  // Group by layer type for ordered rendering
  const backgrounds = [];
  const fills = [];    // water, parks
  const lines = [];    // roads

  for (const f of features) {
    const layerId = f.layer.id;
    const type = f.layer.type;

    if (type === 'fill') fills.push(f);
    else if (type === 'line') lines.push(f);
  }

  // Project geo coordinates → pixel coordinates in the SVG
  function project(lngLat) {
    const p = map.project(lngLat);
    // Scale from map canvas size to export size
    const canvas = map.getCanvas();
    const scaleX = effectiveW / canvas.width;
    const scaleY = effectiveH / canvas.height;
    return [p.x * scaleX, p.y * scaleY];
  }

  function coordsToPath(coords) {
    return coords.map((c, i) => {
      const [x, y] = project(c);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ') + ' Z';
  }

  function multiCoordsToPath(rings) {
    return rings.map(ring => coordsToPath(ring)).join(' ');
  }

  function lineToPath(coords) {
    return coords.map((c, i) => {
      const [x, y] = project(c);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
  }

  // Build SVG elements
  let fillPaths = '';
  for (const f of fills) {
    const color = f.layer.paint?.['fill-color'] || theme.water;
    const geom = f.geometry;

    if (geom.type === 'Polygon') {
      fillPaths += `<path d="${multiCoordsToPath(geom.coordinates)}" fill="${color}" />\n`;
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        fillPaths += `<path d="${multiCoordsToPath(poly)}" fill="${color}" />\n`;
      }
    }
  }

  let linePaths = '';
  // Road rendering order: default → residential → tertiary → secondary → primary → motorway
  const roadOrder = [
    'road-default', 'road-residential', 'road-tertiary',
    'road-secondary', 'road-primary', 'road-motorway'
  ];

  const linesByLayer = {};
  for (const f of lines) {
    const id = f.layer.id;
    if (!linesByLayer[id]) linesByLayer[id] = [];
    linesByLayer[id].push(f);
  }

  for (const layerId of roadOrder) {
    const layerFeatures = linesByLayer[layerId] || [];
    // Get line width from the style
    const widthMap = {
      'road-default': 0.5, 'road-residential': 0.5,
      'road-tertiary': 0.8, 'road-secondary': 1.0,
      'road-primary': 1.5, 'road-motorway': 2.0
    };
    const strokeWidth = widthMap[layerId] || 0.5;
    const strokeColor = theme[layerId.replace('-', '_')] || theme.road_default;

    for (const f of layerFeatures) {
      const geom = f.geometry;
      if (geom.type === 'LineString') {
        linePaths += `<path d="${lineToPath(geom.coordinates)}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" />\n`;
      } else if (geom.type === 'MultiLineString') {
        for (const line of geom.coordinates) {
          linePaths += `<path d="${lineToPath(line)}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" />\n`;
        }
      }
    }
  }

  // Compose full SVG
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <!-- Mat / border background -->
  <rect width="${width}" height="${height}" fill="${theme.bg}" />

  <!-- Map content area -->
  <g transform="translate(${matWidth}, ${matWidth})">
    <!-- Background -->
    <rect width="${effectiveW}" height="${effectiveH}" fill="${theme.bg}" />

    <!-- Water & Parks (fill layers) -->
    <g class="fills">
      ${fillPaths}
    </g>

    <!-- Roads (line layers) -->
    <g class="roads">
      ${linePaths}
    </g>
  </g>

  <!-- Poster overlay text (city name + coordinates) -->
  ${buildOverlayTextSVG(width, height, matWidth, theme)}
</svg>`;

  return svg;
}

function buildOverlayTextSVG(width, height, matWidth, theme) {
  const cityName = state.cityOverride || state.city;
  const coords = formatCoordsForSVG(state.lat, state.lon);
  const textColor = theme.text || '#000000';

  // Approximate font sizes based on overlay size
  const sizes = { small: { city: 40, coords: 12 }, medium: { city: 64, coords: 16 }, large: { city: 96, coords: 20 } };
  const s = sizes[state.overlaySize] || sizes.medium;

  if (state.overlaySize === 'none') return '';

  const bottomY = height - matWidth;
  const pad = state.overlaySize === 'small' ? 24 : state.overlaySize === 'large' ? 80 : 48;

  return `
  <g class="poster-overlay">
    <text x="${width / 2}" y="${bottomY - pad - s.coords - 10}"
          text-anchor="middle" font-family="'Playfair Display', serif"
          font-size="${s.city}" font-weight="900" letter-spacing="0.15em"
          fill="${textColor}">${escapeXml(cityName)}</text>
    <line x1="${width * 0.35}" y1="${bottomY - pad - s.coords - 5}"
          x2="${width * 0.65}" y2="${bottomY - pad - s.coords - 5}"
          stroke="${textColor}" stroke-width="1" />
    <text x="${width / 2}" y="${bottomY - pad}"
          text-anchor="middle" font-family="'Outfit', sans-serif"
          font-size="${s.coords}" letter-spacing="0.2em"
          fill="${textColor}">${escapeXml(coords)}</text>
  </g>`;
}

function formatCoordsForSVG(lat, lon) {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}°${latDir}  ${Math.abs(lon).toFixed(4)}°${lonDir}`;
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function buildRasterSVG(width, height, matWidth) {
  // For Leaflet tile mode: embed the raster capture as <image> in SVG
  // This is a graceful fallback — not true vector, but still an SVG container
  const { captureMapSnapshot } = await import('./export.js');
  // Note: you'll need to export captureMapSnapshot from export.js
  const snapshot = await captureMapSnapshot();
  const theme = getSelectedTheme();

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${theme.background || '#ffffff'}" />
  ${snapshot ? `<image x="${matWidth}" y="${matWidth}"
    width="${width - 2 * matWidth}" height="${height - 2 * matWidth}"
    href="${snapshot}" />` : ''}
  ${buildOverlayTextSVG(width, height, matWidth, theme)}
</svg>`;
}
```

### Changes to existing files

**`src/core/export.js`** — Export `captureMapSnapshot` so the SVG fallback can use it:

```diff
- async function captureMapSnapshot() {
+ export async function captureMapSnapshot() {
```

**`main.js`** — Add a second export button or a dropdown:

```javascript
import { exportToSVG } from './src/core/export-svg.js';

// After the existing exportBtn listener, add:
const exportSvgBtn = document.getElementById('export-svg-btn');
if (exportSvgBtn) {
  exportSvgBtn.addEventListener('click', async () => {
    const filename = `MapToPoster-${state.city.replace(/\s+/g, '-')}-${Date.now()}.svg`;
    setExportButtonLoading(true, 'processing');
    try {
      await exportToSVG(posterContainer, filename, null);
    } finally {
      setExportButtonLoading(false);
    }
  });
}
```

**`index.html`** — Add the SVG export button alongside the existing PNG button. Replace the single export button section with a split button or two buttons:

```html
<div class="flex gap-2">
  <button id="export-btn" class="flex-1 py-3 bg-slate-900 text-white rounded-xl ...">
    <span>Export PNG</span>
  </button>
  <button id="export-svg-btn" class="py-3 px-4 bg-slate-700 text-white rounded-xl
    text-xs font-bold hover:bg-slate-600 transition-all" title="Export as SVG (vector)">
    SVG
  </button>
</div>
```

### Limitations & Notes

- **True vector SVG only works in Artistic mode**. In Tile mode, the SVG wraps a raster `<image>` — inform the user of this via a tooltip.
- `queryRenderedFeatures()` returns only what's currently rendered in the viewport. If you resize the map for high-res export (like the PNG path does), call it *after* `resize()` + `idle`.
- For very high zoom levels with many features, the SVG can become large. Consider simplifying geometries with a tolerance (Douglas-Peucker) or limiting feature count.

---

## Feature 2: Select a Particular Square (Region Selection)

### Strategy

Add a draggable rectangle overlay on top of the map preview. The user draws or adjusts a selection box, and only that region is exported. This works for both PNG and SVG export.

### State additions in `src/core/state.js`

```javascript
// Add to defaultState:
selectionEnabled: false,
selectionBounds: null,  // { x, y, width, height } in pixel coords relative to poster
```

### New file: `src/ui/selection-overlay.js`

```javascript
import { state, updateState } from '../core/state.js';

let selectionEl = null;
let isDrawing = false;
let startX, startY;

export function initSelectionOverlay(posterContainerId) {
  const container = document.getElementById(posterContainerId);
  if (!container) return;

  // Create the selection rectangle element
  selectionEl = document.createElement('div');
  selectionEl.id = 'selection-overlay';
  selectionEl.style.cssText = `
    position: absolute;
    border: 2px dashed rgba(59, 130, 246, 0.8);
    background: rgba(59, 130, 246, 0.1);
    pointer-events: none;
    z-index: 50;
    display: none;
  `;
  container.appendChild(selectionEl);

  // Add resize handles
  const handles = ['nw', 'ne', 'sw', 'se'];
  handles.forEach(pos => {
    const handle = document.createElement('div');
    handle.className = `selection-handle handle-${pos}`;
    handle.dataset.handle = pos;
    handle.style.cssText = `
      position: absolute;
      width: 10px; height: 10px;
      background: #3b82f6;
      border: 2px solid white;
      border-radius: 2px;
      pointer-events: auto;
      cursor: ${pos}-resize;
      z-index: 51;
    `;
    // Position handles at corners
    if (pos.includes('n')) handle.style.top = '-5px';
    if (pos.includes('s')) handle.style.bottom = '-5px';
    if (pos.includes('w')) handle.style.left = '-5px';
    if (pos.includes('e')) handle.style.right = '-5px';

    selectionEl.appendChild(handle);
  });

  // Drawing interaction
  container.addEventListener('mousedown', onMouseDown);
  container.addEventListener('mousemove', onMouseMove);
  container.addEventListener('mouseup', onMouseUp);

  // Handle dragging
  function onMouseDown(e) {
    if (!state.selectionEnabled) return;
    if (e.target.classList.contains('selection-handle')) {
      // Handle resize (simplified — implement full resize logic)
      return;
    }

    const rect = container.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    isDrawing = true;

    selectionEl.style.display = 'block';
    selectionEl.style.left = `${startX}px`;
    selectionEl.style.top = `${startY}px`;
    selectionEl.style.width = '0px';
    selectionEl.style.height = '0px';
  }

  function onMouseMove(e) {
    if (!isDrawing) return;
    const rect = container.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;

    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    const w = Math.abs(currentX - startX);
    const h = Math.abs(currentY - startY);

    selectionEl.style.left = `${x}px`;
    selectionEl.style.top = `${y}px`;
    selectionEl.style.width = `${w}px`;
    selectionEl.style.height = `${h}px`;
  }

  function onMouseUp(e) {
    if (!isDrawing) return;
    isDrawing = false;

    const rect = container.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;

    // Store selection in state (as fraction of container for resolution independence)
    const containerW = container.offsetWidth;
    const containerH = container.offsetHeight;

    const bounds = {
      x: Math.min(startX, currentX) / containerW,
      y: Math.min(startY, currentY) / containerH,
      width: Math.abs(currentX - startX) / containerW,
      height: Math.abs(currentY - startY) / containerH,
    };

    // Minimum selection size (5% of container)
    if (bounds.width < 0.05 || bounds.height < 0.05) {
      // Too small — clear selection
      updateState({ selectionBounds: null });
      selectionEl.style.display = 'none';
      return;
    }

    updateState({ selectionBounds: bounds });
  }
}

export function clearSelection() {
  updateState({ selectionBounds: null, selectionEnabled: false });
  if (selectionEl) selectionEl.style.display = 'none';
}

export function updateSelectionVisibility(enabled) {
  if (selectionEl) {
    selectionEl.style.display = enabled && state.selectionBounds ? 'block' : 'none';
  }
}
```

### Export changes in `src/core/export.js`

When `state.selectionBounds` is set, crop the final canvas before download:

```javascript
// In exportToPNG, after the html2canvas call produces `canvas`:

if (state.selectionBounds) {
  const sel = state.selectionBounds;
  const cropX = Math.round(sel.x * canvas.width);
  const cropY = Math.round(sel.y * canvas.height);
  const cropW = Math.round(sel.width * canvas.width);
  const cropH = Math.round(sel.height * canvas.height);

  const croppedCanvas = document.createElement('canvas');
  croppedCanvas.width = cropW;
  croppedCanvas.height = cropH;
  const cropCtx = croppedCanvas.getContext('2d');
  cropCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  // Use croppedCanvas instead of canvas for download
  const link = document.createElement('a');
  link.download = filename;
  link.href = croppedCanvas.toDataURL('image/png', 1.0);
  link.click();
  return; // skip the normal download path
}
```

### UI: Add toggle in sidebar (`index.html` + `form.js`)

```html
<!-- In the Export section of the sidebar -->
<div class="flex items-center justify-between">
  <label class="text-xs font-bold text-slate-600">Select Region</label>
  <input type="checkbox" id="selection-toggle" class="toggle-checkbox" />
</div>
<p id="selection-hint" class="text-[9px] text-slate-400 hidden">
  Draw a rectangle on the poster to select an export region
</p>
```

```javascript
// In setupControls()
const selectionToggle = document.getElementById('selection-toggle');
if (selectionToggle) {
  selectionToggle.addEventListener('change', (e) => {
    updateState({ selectionEnabled: e.target.checked });
    updateSelectionVisibility(e.target.checked);
    document.getElementById('selection-hint')?.classList.toggle('hidden', !e.target.checked);
  });
}
```

---

## Feature 3: Street Name Labels at High Zoom

### Strategy

The OpenFreeMap vector tiles already contain a `transportation_name` source layer with street names. The current `generateMapLibreStyle()` in `map-init.js` simply doesn't include a text layer for it. We add one conditionally based on zoom level and visible area size.

### Changes to `src/map/map-init.js`

Add street name layers to `generateMapLibreStyle()`:

```javascript
function generateMapLibreStyle(theme) {
  const layers = [
    // ... existing layers (background, water, park, roads) stay unchanged ...

    // === NEW: Street name labels ===
    {
      id: 'road-labels-primary',
      source: 'openfreemap',
      'source-layer': 'transportation_name',
      type: 'symbol',
      minzoom: 14,  // Only show when zoomed in enough
      filter: ['match', ['get', 'class'],
        ['primary', 'secondary', 'motorway'], true, false],
      layout: {
        'symbol-placement': 'line',
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],  // OpenFreeMap's available font
        'text-size': [
          'interpolate', ['linear'], ['zoom'],
          14, 10,
          16, 12,
          18, 14
        ],
        'text-max-angle': 30,
        'text-padding': 5,
        'symbol-spacing': 250,
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'viewport',
      },
      paint: {
        'text-color': theme.text || '#000000',
        'text-halo-color': theme.bg || '#ffffff',
        'text-halo-width': 1.5,
        'text-opacity': [
          'interpolate', ['linear'], ['zoom'],
          14, 0.6,
          16, 0.85,
          18, 1.0
        ]
      }
    },
    {
      id: 'road-labels-minor',
      source: 'openfreemap',
      'source-layer': 'transportation_name',
      type: 'symbol',
      minzoom: 15,  // Minor streets only at higher zoom
      filter: ['match', ['get', 'class'],
        ['tertiary', 'residential', 'service', 'street'], true, false],
      layout: {
        'symbol-placement': 'line',
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': [
          'interpolate', ['linear'], ['zoom'],
          15, 8,
          17, 10,
          18, 12
        ],
        'text-max-angle': 30,
        'text-padding': 2,
        'symbol-spacing': 200,
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'viewport',
      },
      paint: {
        'text-color': theme.text || '#000000',
        'text-halo-color': theme.bg || '#ffffff',
        'text-halo-width': 1.0,
        'text-opacity': [
          'interpolate', ['linear'], ['zoom'],
          15, 0.5,
          17, 0.75,
          18, 0.9
        ]
      }
    }
  ];

  return {
    version: 8,
    name: theme.name,
    // IMPORTANT: add glyphs URL for text rendering
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      openfreemap: {
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet'
      }
    },
    layers
  };
}
```

### Making it toggleable via state

Add to `state.js` defaults:

```javascript
showStreetNames: false,   // user toggle
```

Add a UI toggle in the Artistic theme config section of `index.html`:

```html
<div id="street-names-control" class="hidden">
  <div class="flex items-center justify-between">
    <label class="text-xs font-bold text-slate-600">Street Names</label>
    <input type="checkbox" id="street-names-toggle" class="toggle-checkbox" />
  </div>
  <p class="text-[9px] text-slate-400 mt-1">
    Shows street labels at zoom ≥14. Best for small areas.
  </p>
</div>
```

Wire it in `form.js`:

```javascript
const streetNamesToggle = document.getElementById('street-names-toggle');
const streetNamesControl = document.getElementById('street-names-control');

if (streetNamesToggle) {
  streetNamesToggle.addEventListener('change', (e) => {
    updateState({ showStreetNames: e.target.checked });
  });
}

// In the subscriber callback, show/hide based on render mode:
if (streetNamesControl) {
  streetNamesControl.classList.toggle('hidden', currentState.renderMode !== 'artistic');
}
if (streetNamesToggle) {
  streetNamesToggle.checked = !!currentState.showStreetNames;
}
```

Then conditionally include the label layers in `generateMapLibreStyle()`:

```javascript
function generateMapLibreStyle(theme) {
  const layers = [
    /* ...existing layers... */
  ];

  // Only add labels if the user toggled them on
  if (state.showStreetNames) {
    layers.push(
      { /* road-labels-primary from above */ },
      { /* road-labels-minor from above */ }
    );
  }

  return {
    version: 8,
    name: theme.name,
    // Glyphs URL is needed even if no labels — harmless to always include
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: { /* ... */ },
    layers
  };
}
```

### Smart auto-detection: only show labels when area is small enough

Instead of (or in addition to) a manual toggle, you can automatically enable labels when the zoom is high and the poster covers a small geographic area:

```javascript
// In generateMapLibreStyle or in the subscriber
function shouldShowStreetNames() {
  if (!state.showStreetNames) return false;

  // Only meaningful at zoom >= 14
  if (state.zoom < 14) return false;

  // Optional: estimate visible area in km²
  // At zoom 14, each tile covers roughly 2.4km × 2.4km
  // At zoom 16, roughly 0.6km × 0.6km — perfect for street names
  return true;
}
```

### Street names in SVG export

When exporting to SVG with street names enabled, query the `symbol` layers too:

```javascript
// In export-svg.js, add after road lines:
const symbols = features.filter(f => f.layer.type === 'symbol');

let textElements = '';
for (const f of symbols) {
  const name = f.properties.name;
  if (!name) continue;

  const geom = f.geometry;
  if (geom.type === 'Point') {
    const [x, y] = project(geom.coordinates);
    textElements += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}"
      font-family="'Noto Sans', sans-serif" font-size="9"
      fill="${theme.text}" text-anchor="middle"
      opacity="0.8">${escapeXml(name)}</text>\n`;
  }
  // For line-placed labels, you'd need to compute a path and use <textPath>
  // This is more complex — see the advanced approach below
}
```

For proper **line-following text** in SVG (matching MapLibre's `symbol-placement: 'line'`):

```javascript
// Advanced: text along road paths
for (const f of symbols) {
  const name = f.properties.name;
  if (!name) continue;

  // Find the matching road geometry
  // Use the feature's geometry if it's a LineString
  if (f.geometry.type === 'LineString') {
    const pathId = `label-path-${labelCounter++}`;
    const d = lineToPath(f.geometry.coordinates);

    textElements += `<defs><path id="${pathId}" d="${d}" /></defs>
      <text font-family="'Noto Sans', sans-serif" font-size="9"
            fill="${theme.text}" opacity="0.8">
        <textPath href="#${pathId}" startOffset="50%" text-anchor="middle">
          ${escapeXml(name)}
        </textPath>
      </text>\n`;
  }
}
```

---

## Summary of All File Changes

| File | Action | Feature |
|------|--------|---------|
| `src/core/export-svg.js` | **New file** | SVG export |
| `src/core/export.js` | Export `captureMapSnapshot`, add crop logic | SVG fallback + Selection |
| `src/ui/selection-overlay.js` | **New file** | Square selection |
| `src/map/map-init.js` | Add `glyphs` URL + street name layers in `generateMapLibreStyle()` | Street names |
| `src/core/state.js` | Add `selectionEnabled`, `selectionBounds`, `showStreetNames` | Selection + Street names |
| `src/ui/form.js` | Wire new toggles + subscriber updates | All features |
| `main.js` | Import + wire SVG export button, init selection overlay | SVG + Selection |
| `index.html` | Add SVG button, selection toggle, street names toggle | All features |

### Recommended implementation order

1. **Street names** (smallest change, highest visual impact — just modify `generateMapLibreStyle` + add the `glyphs` property)
2. **SVG export** (new module, high value for print/design users)
3. **Selection** (most UI work, useful but not critical)
