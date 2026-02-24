import L from 'leaflet';
import maplibregl from 'maplibre-gl';
import { state, updateState, getSelectedTheme, getSelectedArtisticTheme } from '../core/state.js';
import { findBestInsertIndex } from '../core/utils.js';
import { fetchOSRMRoute } from '../core/routing.js';
import { getMap, getArtisticMap } from './map-init.js';

let routeStartMarker = null;
let routeEndMarker = null;
let routeLine = null;
let routeLineCasing = null;
let ghostMarker = null;
let viaMarkers = [];
let artisticViaMarkers = [];
let artisticRouteStartMarker = null;
let artisticRouteEndMarker = null;
	let isSyncing = false;
let lastWaypointIcon = null;
let lastWaypointSize = null;
let lastStartEndIcon = null;
let lastStartEndSize = null;

export async function updateRouteGeometry() {
	const points = [
		[state.routeStartLat, state.routeStartLon],
		...(state.routeViaPoints || []).map(p => [p.lat, p.lon]),
		[state.routeEndLat, state.routeEndLon]
	];
	const coords = await fetchOSRMRoute(points);
	updateState({ routeGeometry: coords });
	syncRouteMarkers();
}

export function insertViaPoint(lat, lon) {
	const via = [...(state.routeViaPoints || [])];
	const routePoints = [
		{ lat: state.routeStartLat, lon: state.routeStartLon },
		...via,
		{ lat: state.routeEndLat, lon: state.routeEndLon }
	];
	const index = findBestInsertIndex(lat, lon, routePoints);

	via.splice(index, 0, { lat, lon });

	updateState({ routeViaPoints: via });
	updateRouteGeometry();
}

export function updateRouteStyles(state) {
	const map = getMap();
	const artisticMap = getArtisticMap();

	if (!map) return;

	const isArtistic = state.renderMode === 'artistic';
	const theme = isArtistic ? getSelectedArtisticTheme() : getSelectedTheme();
	const color = theme.route || '#EF4444';
	const casingColor = isArtistic ? (theme.bg || '#ffffff') : (theme.background || '#ffffff');

	if (state.showRoute) {
		const start = [state.routeStartLat, state.routeStartLon];
		const end = [state.routeEndLat, state.routeEndLon];

		const startEndSize = (state.routeStartEndSize || 1) * 36;
		const startEndIcon = state.routeStartEndIcon || 'pin';

		const getStartEndMarkerHtml = (label) => {
			const size = `${startEndSize}px`;

			if (startEndIcon === 'pin') {
				return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="z-index:9999;">
					<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="white" stroke="#333" stroke-width="1.5"/>
					<text x="12" y="13" text-anchor="middle" font-size="10" font-weight="bold" fill="#333">${label}</text>
				</svg>`;
			} else if (startEndIcon === 'square') {
				return `<div style="width:${size};height:${size};background:white;border:2px solid #333;box-shadow:0 2px 4px rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center;z-index:9999;"><span style="font-size:10px;font-weight:bold;color:#333">${label}</span></div>`;
			} else if (startEndIcon === 'diamond') {
				return `<div style="width:${size};height:${size};background:white;border:2px solid #333;transform:rotate(45deg);box-shadow:0 2px 4px rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center;z-index:9999;"><span style="font-size:10px;font-weight:bold;color:#333;transform:rotate(-45deg)">${label}</span></div>`;
			} else {
				return `<div style="width:${size};height:${size};background:white;border:2px solid #333;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center;z-index:9999;"><span style="font-size:10px;font-weight:bold;color:#333">${label}</span></div>`;
			}
		};

		const shouldRecreateStartEnd = window.__routeForceRecreate || lastStartEndIcon !== startEndIcon || lastStartEndSize !== startEndSize;
		if (shouldRecreateStartEnd) {
			window.__routeForceRecreate = false;
		}

		if (!routeStartMarker || shouldRecreateStartEnd) {
			if (routeStartMarker) routeStartMarker.remove();
			lastStartEndIcon = startEndIcon;
			lastStartEndSize = startEndSize;

			routeStartMarker = L.marker(start, {
				draggable: true,
				bubblingMouseEvents: true,
				icon: L.divIcon({
					className: 'route-marker-a',
					html: getStartEndMarkerHtml('A'),
					iconSize: [startEndSize, startEndSize],
					iconAnchor: [startEndSize / 2, startEndSize / 2]
				})
			}).addTo(map);
			routeStartMarker.on('drag', () => {
				if (isSyncing) return;
				isSyncing = true;
				const pos = routeStartMarker.getLatLng();
				updateState({ routeStartLat: pos.lat, routeStartLon: pos.lng });
				syncRouteMarkers(false);
				isSyncing = false;
			});
			routeStartMarker.on('dragend', updateRouteGeometry);
		} else {
			routeStartMarker.setLatLng(start);
		}

		if (!routeEndMarker || shouldRecreateStartEnd) {
			if (routeEndMarker) routeEndMarker.remove();

			routeEndMarker = L.marker(end, {
				draggable: true,
				icon: L.divIcon({
					className: 'route-marker-b',
					html: getStartEndMarkerHtml('B'),
					iconSize: [startEndSize, startEndSize],
					iconAnchor: [startEndSize / 2, startEndSize / 2]
				})
			}).addTo(map);
			routeEndMarker.on('drag', () => {
				if (isSyncing) return;
				isSyncing = true;
				const pos = routeEndMarker.getLatLng();
				updateState({ routeEndLat: pos.lat, routeEndLon: pos.lng });
				syncRouteMarkers(false);
				isSyncing = false;
			});
			routeEndMarker.on('dragend', updateRouteGeometry);
		} else {
			if (!isSyncing) routeEndMarker.setLatLng(end).addTo(map);
		}

		const via = state.routeViaPoints || [];
		const routeCoords = (state.routeGeometry && state.routeGeometry.length > 0)
			? state.routeGeometry.map(c => [c[1], c[0]])
			: [start, ...via.map(p => [p.lat, p.lon]), end];

		if (!routeLineCasing) {
			routeLineCasing = L.polyline(routeCoords, { color: casingColor, weight: 9, opacity: 1.0, lineCap: 'round' }).addTo(map);
		} else {
			if (!isSyncing) routeLineCasing.setLatLngs(routeCoords).setStyle({ color: casingColor, weight: 9 }).addTo(map);
		}

		if (!routeLine) {
			routeLine = L.polyline(routeCoords, {
				color: color,
				weight: 20,
				opacity: 0,
				interactive: true
			}).addTo(map);

			const visibleLine = L.polyline(routeCoords, {
				color: color,
				weight: 4,
				opacity: 1.0,
				lineCap: 'round',
				interactive: false
			}).addTo(map);

			routeLine._visibleLine = visibleLine;

			routeLine.on('mouseover', () => {
				if (isSyncing) return;
				if (!ghostMarker) {
					ghostMarker = L.marker([0, 0], {
						interactive: false,
						icon: L.divIcon({
							className: 'ghost-point',
							html: `<div class="w-3 h-3 bg-white/90 border-2 border-slate-400 rounded-full shadow-sm scale-90"></div>`,
							iconSize: [12, 12],
							iconAnchor: [6, 6]
						})
					}).addTo(map);
				}
				const el = ghostMarker.getElement();
				if (el) el.style.display = 'block';
			});

			routeLine.on('mousemove', (e) => {
				if (isSyncing) return;
				if (ghostMarker) {
					ghostMarker.setLatLng(e.latlng);
					const el = ghostMarker.getElement();
					if (el && el.style.display === 'none') el.style.display = 'block';
				}
			});

			routeLine.on('mouseout', () => {
				if (ghostMarker) {
					const el = ghostMarker.getElement();
					if (el) el.style.display = 'none';
				}
			});

			routeLine.on('mousedown', (e) => {
				L.DomEvent.stopPropagation(e);
				const startPos = e.containerPoint;
				let pointAdded = false;
				let index = -1;

				if (ghostMarker) {
					const el = ghostMarker.getElement();
					if (el) el.style.display = 'none';
				}

				isSyncing = true;
				map.dragging.disable();

				const onMouseMove = (me) => {
					const currentPos = me.containerPoint;
					const dist = startPos.distanceTo(currentPos);

					if (!pointAdded && dist > 5) {
						const via = [...(state.routeViaPoints || [])];
						const routePoints = [
							{ lat: state.routeStartLat, lon: state.routeStartLon },
							...via,
							{ lat: state.routeEndLat, lon: state.routeEndLon }
						];
						index = findBestInsertIndex(me.latlng.lat, me.latlng.lng, routePoints);
						via.splice(index, 0, { lat: me.latlng.lat, lon: me.latlng.lng });
						updateState({ routeViaPoints: via });
						pointAdded = true;
					}

					if (pointAdded && index !== -1) {
						const v = [...state.routeViaPoints];
						v[index] = { lat: me.latlng.lat, lon: me.latlng.lng };
						updateState({ routeViaPoints: v });
						syncRouteMarkers(false);
					}
				};

				const onMouseUp = () => {
					map.off('mousemove', onMouseMove);
					map.off('mouseup', onMouseUp);
					map.dragging.enable();
					isSyncing = false;
					if (pointAdded) {
						updateRouteGeometry();
					}
				};

				map.on('mousemove', onMouseMove);
				map.on('mouseup', onMouseUp);
			});
		} else {
			if (!isSyncing) {
				routeLine.setLatLngs(routeCoords).addTo(map);
				if (routeLine._visibleLine) {
					routeLine._visibleLine.setLatLngs(routeCoords).setStyle({ color: color, weight: 4 }).addTo(map);
				}
			}
		}

		const currentViaData = state.routeViaPoints || [];

		const handleViaDrag = (idx, newLatLng) => {
			if (isSyncing) return;
			isSyncing = true;
			const v = [...(state.routeViaPoints || [])];
			v[idx] = { lat: newLatLng.lat, lon: newLatLng.lng };
			updateState({ routeViaPoints: v });
			syncRouteMarkers(false);
			isSyncing = false;
		};

		const currentIcon = state.routeWaypointIcon || 'circle';
		const currentSize = state.routeWaypointSize || 1;

		if (viaMarkers.length !== currentViaData.length || window.__routeForceRecreate || lastWaypointIcon !== currentIcon || lastWaypointSize !== currentSize) {
			viaMarkers.forEach(m => m.remove());
			viaMarkers = [];
			lastWaypointIcon = currentIcon;
			lastWaypointSize = currentSize;

			const waypointSize = (state.routeWaypointSize || 1) * 36;
			const iconType = state.routeWaypointIcon || 'circle';

			const getWaypointHtml = () => {
				const size = `${waypointSize}px`;
				const half = `${waypointSize / 2}px`;

				if (iconType === 'pin') {
					return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
						<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="white" stroke="#333" stroke-width="1.5"/>
						<circle cx="12" cy="9" r="3" fill="#333"/>
					</svg>`;
				} else if (iconType === 'square') {
					return `<div style="width:${size};height:${size};background:white;border:2px solid #333;box-shadow:0 2px 4px rgba(0,0,0,0.2);"></div>`;
				} else if (iconType === 'diamond') {
					return `<div style="width:${size};height:${size};background:white;border:2px solid #333;transform:rotate(45deg);box-shadow:0 2px 4px rgba(0,0,0,0.2);"></div>`;
				} else {
					return `<div style="width:${size};height:${size};background:white;border:2px solid #333;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,0.2);"></div>`;
				}
			};

			currentViaData.forEach((p, idx) => {
				const dm = L.marker([p.lat, p.lon], {
					draggable: true,
					icon: L.divIcon({
						className: 'via-point',
						html: getWaypointHtml(),
						iconSize: [waypointSize, waypointSize],
						iconAnchor: [waypointSize / 2, waypointSize / 2]
					})
				}).addTo(map);

				dm.on('drag', (e) => handleViaDrag(idx, e.target.getLatLng()));
				dm.on('dragend', () => { isSyncing = false; updateRouteGeometry(); });
				dm.on('dblclick', (e) => {
					L.DomEvent.stopPropagation(e);
					const v = [...state.routeViaPoints];
					v.splice(idx, 1);
					updateState({ routeViaPoints: v });
					updateRouteGeometry();
				});
				viaMarkers.push(dm);
			});
		} else {
			if (!isSyncing) {
				viaMarkers.forEach((m, idx) => {
					const p = currentViaData[idx];
					m.setLatLng([p.lat, p.lon]);
				});
			}
		}

		if (artisticMap) {
			const currentIcon = state.routeWaypointIcon || 'circle';
			const currentSize = state.routeWaypointSize || 1;

			if (artisticViaMarkers.length !== currentViaData.length || window.__routeForceRecreate || lastWaypointIcon !== currentIcon || lastWaypointSize !== currentSize) {
				artisticViaMarkers.forEach(m => m.remove());

				const waypointSize = currentSize * 36;
				const iconType = currentIcon;

				const getWaypointHtml = () => {
					const size = `${waypointSize}px`;

					if (iconType === 'pin') {
						return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
							<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="white" stroke="#333" stroke-width="1.5"/>
							<circle cx="12" cy="9" r="3" fill="#333"/>
						</svg>`;
					} else if (iconType === 'square') {
						return `<div style="width:${size};height:${size};background:white;border:2px solid #333;box-shadow:0 2px 4px rgba(0,0,0,0.2);"></div>`;
					} else if (iconType === 'diamond') {
						return `<div style="width:${size};height:${size};background:white;border:2px solid #333;transform:rotate(45deg);box-shadow:0 2px 4px rgba(0,0,0,0.2);"></div>`;
					} else {
						return `<div style="width:${size};height:${size};background:white;border:2px solid #333;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,0.2);"></div>`;
					}
				};

				artisticViaMarkers = currentViaData.map((p, idx) => {
					const el = document.createElement('div');
					el.className = 'artistic-via-point';
					el.style.display = 'flex';
					el.style.alignItems = 'center';
					el.style.justifyContent = 'center';
					el.style.zIndex = '990';
					el.style.cursor = 'grab';
					el.innerHTML = getWaypointHtml();

					const am = new maplibregl.Marker({ element: el, draggable: true })
						.setLngLat([p.lon, p.lat])
						.addTo(artisticMap);

					am.on('drag', () => {
						if (isSyncing) return;
						isSyncing = true;
						const pos = am.getLngLat();
						const v = [...state.routeViaPoints];
						v[idx] = { lat: pos.lat, lon: pos.lng };
						updateState({ routeViaPoints: v });
						syncRouteMarkers(false);
						isSyncing = false;
					});

					am.on('dragend', updateRouteGeometry);

					el.addEventListener('dblclick', (e) => {
						e.preventDefault();
						e.stopPropagation();
						const v = [...state.routeViaPoints];
						v.splice(idx, 1);
						updateState({ routeViaPoints: v });
						updateRouteGeometry();
					});

					return am;
				});
			} else {
				if (!isSyncing) {
					artisticViaMarkers.forEach((m, idx) => {
						const p = currentViaData[idx];
						if (p) m.setLngLat([p.lon, p.lat]);
					});
				}
			}
		}

		if (artisticMap) {
			if (!artisticRouteStartMarker || shouldRecreateStartEnd) {
				if (artisticRouteStartMarker) artisticRouteStartMarker.remove();

				const el = document.createElement('div');
				el.className = 'route-marker-a';
				el.style.display = 'flex';
				el.style.alignItems = 'center';
				el.style.justifyContent = 'center';
				el.style.zIndex = '1000';
				el.innerHTML = getStartEndMarkerHtml('A');
				artisticRouteStartMarker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([start[1], start[0]]).addTo(artisticMap);
				artisticRouteStartMarker.on('drag', () => {
					if (isSyncing) return;
					isSyncing = true;
					const pos = artisticRouteStartMarker.getLngLat();
					updateState({ routeStartLat: pos.lat, routeStartLon: pos.lng });
					syncRouteMarkers(false);
					isSyncing = false;
				});
				artisticRouteStartMarker.on('dragend', updateRouteGeometry);
			} else {
				if (!isSyncing) artisticRouteStartMarker.setLngLat([start[1], start[0]]).addTo(artisticMap);
			}

			if (!artisticRouteEndMarker || shouldRecreateStartEnd) {
				if (artisticRouteEndMarker) artisticRouteEndMarker.remove();

				const el = document.createElement('div');
				el.className = 'route-marker-b';
				el.style.display = 'flex';
				el.style.alignItems = 'center';
				el.style.justifyContent = 'center';
				el.style.zIndex = '1000';
				el.innerHTML = getStartEndMarkerHtml('B');
				artisticRouteEndMarker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([end[1], end[0]]).addTo(artisticMap);
				artisticRouteEndMarker.on('drag', () => {
					if (isSyncing) return;
					isSyncing = true;
					const pos = artisticRouteEndMarker.getLngLat();
					updateState({ routeEndLat: pos.lat, routeEndLon: pos.lng });
					syncRouteMarkers(false);
					isSyncing = false;
				});
				artisticRouteEndMarker.on('dragend', updateRouteGeometry);
			} else {
				if (!isSyncing) artisticRouteEndMarker.setLngLat([end[1], end[0]]).addTo(artisticMap);
			}

			const source = artisticMap.getSource('route-source');
			if (source && !isSyncing) {
				source.setData({
					type: 'Feature',
					properties: {},
					geometry: {
						type: 'LineString',
						coordinates: (state.routeGeometry && state.routeGeometry.length > 0) ? state.routeGeometry : [[state.routeStartLon, state.routeStartLat], [state.routeEndLon, state.routeEndLat]]
					}
				});
			}
			if (artisticMap.getLayer('route-line')) {
				artisticMap.setLayoutProperty('route-line', 'visibility', 'visible');
				artisticMap.setPaintProperty('route-line', 'line-color', color);
			}
			if (artisticMap.getLayer('route-line-casing')) {
				artisticMap.setLayoutProperty('route-line-casing', 'visibility', 'visible');
				artisticMap.setPaintProperty('route-line-casing', 'line-color', theme.bg || '#ffffff');
			}
			if (artisticMap.getLayer('route-line-glow')) {
				artisticMap.setLayoutProperty('route-line-glow', 'visibility', 'visible');
				artisticMap.setPaintProperty('route-line-glow', 'line-color', color);
			}
		}
	} else {
		if (routeStartMarker) { routeStartMarker.remove(); routeStartMarker = null; }
		if (routeEndMarker) { routeEndMarker.remove(); routeEndMarker = null; }
		if (routeLine) {
			if (routeLine._visibleLine) routeLine._visibleLine.remove();
			routeLine.remove();
			routeLine = null;
		}
		if (routeLineCasing) { routeLineCasing.remove(); routeLineCasing = null; }
		if (ghostMarker) { ghostMarker.remove(); ghostMarker = null; }
		viaMarkers.forEach(m => m.remove());
		viaMarkers = [];
		artisticViaMarkers.forEach(m => m.remove());
		artisticViaMarkers = [];
		if (artisticRouteStartMarker) { artisticRouteStartMarker.remove(); artisticRouteStartMarker = null; }
		if (artisticRouteEndMarker) { artisticRouteEndMarker.remove(); artisticRouteEndMarker = null; }
		lastWaypointIcon = null;
		lastWaypointSize = null;
		lastStartEndIcon = null;
		lastStartEndSize = null;
		window.__routeForceRecreate = false;
		if (artisticMap) {
			if (artisticMap.getLayer('route-line')) artisticMap.setLayoutProperty('route-line', 'visibility', 'none');
			if (artisticMap.getLayer('route-line-casing')) artisticMap.setLayoutProperty('route-line-casing', 'visibility', 'none');
			if (artisticMap.getLayer('route-line-glow')) artisticMap.setLayoutProperty('route-line-glow', 'visibility', 'none');
		}
	}
}

export function syncRouteMarkers(applyGeometry = true) {
	const map = getMap();
	const artisticMap = getArtisticMap();

	if (routeStartMarker) routeStartMarker.setLatLng([state.routeStartLat, state.routeStartLon]);
	if (routeEndMarker) routeEndMarker.setLatLng([state.routeEndLat, state.routeEndLon]);

	const via = state.routeViaPoints || [];
	const points = [
		[state.routeStartLat, state.routeStartLon],
		...via.map(p => [p.lat, p.lon]),
		[state.routeEndLat, state.routeEndLon]
	];

	const routeCoords = (state.routeGeometry && state.routeGeometry.length > 0 && applyGeometry)
		? state.routeGeometry.map(c => [c[1], c[0]])
		: points;

	if (routeLine) {
		routeLine.setLatLngs(routeCoords);
		if (routeLine._visibleLine) routeLine._visibleLine.setLatLngs(routeCoords);
	}
	if (routeLineCasing) routeLineCasing.setLatLngs(routeCoords);

	if (viaMarkers.length === via.length) {
		viaMarkers.forEach((m, i) => m.setLatLng([via[i].lat, via[i].lon]));
	}

	if (artisticRouteStartMarker) artisticRouteStartMarker.setLngLat([state.routeStartLon, state.routeStartLat]);
	if (artisticRouteEndMarker) artisticRouteEndMarker.setLngLat([state.routeEndLon, state.routeEndLat]);

	if (artisticViaMarkers.length === via.length) {
		artisticViaMarkers.forEach((m, i) => m.setLngLat([via[i].lon, via[i].lat]));
	}

	if (artisticMap) {
		const source = artisticMap.getSource('route-source');
		if (source) {
			const artisticCoords = (state.routeGeometry && state.routeGeometry.length > 0 && applyGeometry)
				? state.routeGeometry
				: points.map(p => [p[1], p[0]]);

			source.setData({
				type: 'Feature',
				properties: {},
				geometry: {
					type: 'LineString',
					coordinates: artisticCoords
				}
			});
		}
	}
}
