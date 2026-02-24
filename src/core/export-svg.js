import { getArtisticMapInstance } from '../map/map-init.js';
import { state, getSelectedArtisticTheme, getSelectedTheme } from './state.js';

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

	const features = map.queryRenderedFeatures();

	const fills = [];
	const lines = [];
	const symbols = [];

	for (const f of features) {
		const type = f.layer.type;
		if (type === 'fill') fills.push(f);
		else if (type === 'line') lines.push(f);
		else if (type === 'symbol') symbols.push(f);
	}

	function project(lngLat) {
		const p = map.project(lngLat);
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
		const widthMap = {
			'road-default': 0.5, 'road-residential': 0.5,
			'road-tertiary': 0.8, 'road-secondary': 1.0,
			'road-primary': 1.5, 'road-motorway': 2.0
		};
		const strokeWidth = widthMap[layerId] || 0.5;
		const themeKey = layerId.replace(/-/g, '_');
		const strokeColor = theme[themeKey] || theme.road_default;

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

	let routePaths = '';
	if (state.showRoute && state.routeGeometry && state.routeGeometry.length > 0) {
		const routeCoords = state.routeGeometry;
		if (routeCoords.length >= 2) {
			const routePathD = lineToPath(routeCoords);
			const casingWidth = 6;
			routePaths += `<path d="${routePathD}" fill="none" stroke="${theme.bg || '#ffffff'}" stroke-width="${casingWidth}" stroke-linecap="round" stroke-linejoin="round" />\n`;
			routePaths += `<path d="${routePathD}" fill="none" stroke="${theme.route || '#EF4444'}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />\n`;
		}
	}

	let streetLabels = '';
	if (state.showStreetNames && symbols.length > 0) {
		for (const f of symbols) {
			const name = f.properties?.name || f.properties?.name_en;
			if (!name) continue;
			const geom = f.geometry;
			if (geom.type === 'Point') {
				const [x, y] = project(geom.coordinates);
				streetLabels += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}"
					font-family="'Noto Sans', sans-serif" font-size="10"
					fill="${theme.text || '#000000'}"
					text-anchor="middle"
					dy="4">${escapeXml(name)}</text>\n`;
			}
		}
	}

	const markersSVG = buildMarkersSVG(map, effectiveW, effectiveH, matWidth, theme);

	const overlayEffectSVG = buildOverlayEffectSVG(width, height, matWidth);

	const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.3"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="${theme.bg}" />

  <g transform="translate(${matWidth}, ${matWidth})">
    <rect width="${effectiveW}" height="${effectiveH}" fill="${theme.bg}" />

    <g class="fills">
      ${fillPaths}
    </g>

    <g class="roads">
      ${linePaths}
    </g>

    <g class="routes">
      ${routePaths}
    </g>

    <g class="street-labels">
      ${streetLabels}
    </g>

    ${markersSVG}
  </g>

  ${overlayEffectSVG}

  ${buildOverlayTextSVG(width, height, matWidth, theme)}
</svg>`;

	return svg;
}

function buildMarkersSVG(map, effectiveW, effectiveH, matWidth, theme) {
	if (!state.showRoute) return '';

	const canvas = map.getCanvas();
	const scaleX = effectiveW / canvas.width;
	const scaleY = effectiveH / canvas.height;

	function projectMarker(lat, lon) {
		const p = map.project([lon, lat]);
		return [p.x * scaleX, p.y * scaleY];
	}

	const startSize = (state.routeStartEndSize || 1) * 36;
	const waypointSize = (state.routeWaypointSize || 1) * 36;
	const startIcon = state.routeStartEndIcon || 'pin';
	const waypointIcon = state.routeWaypointIcon || 'circle';

	let markers = '';

	const [startX, startY] = projectMarker(state.routeStartLat, state.routeStartLon);
	const [endX, endY] = projectMarker(state.routeEndLat, state.routeEndLon);

	markers += getMarkerSVG('A', startX, startY, startSize, startIcon, theme);
	markers += getMarkerSVG('B', endX, endY, startSize, startIcon, theme);

	const viaPoints = state.routeViaPoints || [];
	for (let i = 0; i < viaPoints.length; i++) {
		const via = viaPoints[i];
		const [vx, vy] = projectMarker(via.lat, via.lon);
		markers += getMarkerSVG('', vx, vy, waypointSize, waypointIcon, theme);
	}

	return markers;
}

function getMarkerSVG(label, x, y, size, iconType, theme) {
	const color = theme.text || '#333333';
	const strokeWidth = 2;
	const s = size;

	if (iconType === 'pin') {
		return `<g transform="translate(${x}, ${y})" filter="url(#shadow)">
			<path d="M0,${-s/2} C${-s/3},${-s/2} ${-s/2},${-s/6} ${-s/2},${s/6} C${-s/2},${s/3} 0,${s/2} 0,${s/2} C0,${s/2} ${s/2},${s/3} ${s/2},${s/6} C${s/2},${-s/6} ${s/3},${-s/2} 0,${-s/2}" fill="white" stroke="${color}" stroke-width="${strokeWidth}"/>
			${label ? `<text x="0" y="${s/6}" text-anchor="middle" font-size="${s/4}" font-weight="bold" fill="${color}">${label}</text>` : ''}
		</g>`;
	} else if (iconType === 'square') {
		const half = s / 2;
		return `<g transform="translate(${x}, ${y})" filter="url(#shadow)">
			<rect x="${-half}" y="${-half}" width="${s}" height="${s}" fill="white" stroke="${color}" stroke-width="${strokeWidth}"/>
			${label ? `<text x="0" y="${half/3}" text-anchor="middle" font-size="${s/4}" font-weight="bold" fill="${color}">${label}</text>` : ''}
		</g>`;
	} else if (iconType === 'diamond') {
		const half = s / 2;
		return `<g transform="translate(${x}, ${y})" filter="url(#shadow)">
			<rect x="${-half}" y="${-half}" width="${s}" height="${s}" fill="white" stroke="${color}" stroke-width="${strokeWidth}" transform="rotate(45)"/>
			${label ? `<text x="0" y="${half/3}" text-anchor="middle" font-size="${s/4}" font-weight="bold" fill="${color}" transform="rotate(-45)">${label}</text>` : ''}
		</g>`;
	} else {
		return `<g transform="translate(${x}, ${y})" filter="url(#shadow)">
			<circle cx="0" cy="0" r="${s/2}" fill="white" stroke="${color}" stroke-width="${strokeWidth}"/>
			${label ? `<text x="0" y="${s/6}" text-anchor="middle" font-size="${s/4}" font-weight="bold" fill="${color}">${label}</text>` : ''}
		</g>`;
	}
}

function buildOverlayEffectSVG(width, height, matWidth) {
	const bgType = state.overlayBgType;
	if (!bgType || bgType === 'none') return '';

	const effectiveW = width - 2 * matWidth;
	const effectiveH = height - 2 * matWidth;
	const cx = matWidth + effectiveW / 2;
	const cy = matWidth + effectiveH / 2;

	if (bgType === 'vignette') {
		const radius = Math.max(effectiveW, effectiveH) * 0.8;
		return `<defs>
    <radialGradient id="vignetteGrad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="transparent"/>
      <stop offset="60%" stop-color="transparent"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.4)"/>
    </radialGradient>
  </defs>
  <rect x="${matWidth}" y="${matWidth}" width="${effectiveW}" height="${effectiveH}" fill="url(#vignetteGrad)"/>`;
	} else if (bgType === 'radial') {
		const radius = Math.max(effectiveW, effectiveH) * 0.6;
		return `<defs>
    <radialGradient id="radialGrad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.3)"/>
      <stop offset="40%" stop-color="rgba(255,255,255,0.1)"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
  </defs>
  <circle cx="${cx}" cy="${cy}" r="${radius}" fill="url(#radialGrad)"/>`;
	}

	return '';
}

function buildOverlayTextSVG(width, height, matWidth, theme) {
	const cityName = state.cityOverride || state.city;
	const coords = formatCoordsForSVG(state.lat, state.lon);
	const textColor = theme.text || '#000000';

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
	const { captureMapSnapshot } = await import('./export.js');
	const snapshot = await captureMapSnapshot();
	const theme = getSelectedTheme();

	const overlayEffectSVG = buildOverlayEffectSVG(width, height, matWidth);

	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.3"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="${theme.background || '#ffffff'}" />
  ${snapshot ? `<image x="${matWidth}" y="${matWidth}"
    width="${width - 2 * matWidth}" height="${height - 2 * matWidth}"
    href="${snapshot}" />` : ''}
  ${overlayEffectSVG}
  ${buildOverlayTextSVG(width, height, matWidth, theme)}
</svg>`;
}
