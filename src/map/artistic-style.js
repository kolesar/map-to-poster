import { state } from '../core/state.js';

export function generateMapLibreStyle(theme) {
	const nameField = ['get', 'name'];

	const sourceConfig = { type: 'vector', url: 'https://tiles.openfreemap.org/planet' };

	const waterLayer = 'water';
	const landLayer = 'park';
	const roadLayer = 'transportation';
	const roadClassField = 'class';
	const labelsLayer = 'transportation_name';

	const layers = [
		{
			id: 'background',
			type: 'background',
			paint: { 'background-color': theme.bg }
		},
		{
			id: 'water',
			source: 'openfreemap',
			'source-layer': waterLayer,
			type: 'fill',
			paint: { 'fill-color': theme.water }
		},
		{
			id: 'park',
			source: 'openfreemap',
			'source-layer': landLayer,
			type: 'fill',
			paint: { 'fill-color': theme.parks }
		},
		{
			id: 'road-default',
			source: 'openfreemap',
			'source-layer': roadLayer,
			type: 'line',
			filter: ['!', ['match', ['get', roadClassField], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential'], true, false]],
			paint: { 'line-color': theme.road_default, 'line-width': 0.5 }
		},
		{
			id: 'road-residential',
			source: 'openfreemap',
			'source-layer': roadLayer,
			type: 'line',
			filter: ['==', ['get', roadClassField], 'residential'],
			paint: { 'line-color': theme.road_residential, 'line-width': 0.5 }
		},
		{
			id: 'road-tertiary',
			source: 'openfreemap',
			'source-layer': roadLayer,
			type: 'line',
			filter: ['==', ['get', roadClassField], 'tertiary'],
			paint: { 'line-color': theme.road_tertiary, 'line-width': 0.8 }
		},
		{
			id: 'road-secondary',
			source: 'openfreemap',
			'source-layer': roadLayer,
			type: 'line',
			filter: ['==', ['get', roadClassField], 'secondary'],
			paint: { 'line-color': theme.road_secondary, 'line-width': 1.0 }
		},
		{
			id: 'road-primary',
			source: 'openfreemap',
			'source-layer': roadLayer,
			type: 'line',
			filter: ['==', ['get', roadClassField], 'primary'],
			paint: { 'line-color': theme.road_primary, 'line-width': 1.5 }
		},
		{
			id: 'road-motorway',
			source: 'openfreemap',
			'source-layer': roadLayer,
			type: 'line',
			filter: ['match', ['get', roadClassField], ['motorway', 'trunk'], true, false],
			paint: { 'line-color': theme.road_motorway, 'line-width': 2.0 }
		},
		{
			id: 'route-line-casing',
			source: 'route-source',
			type: 'line',
			layout: {
				'line-cap': 'round',
				'line-join': 'round',
				'visibility': state.showRoute ? 'visible' : 'none'
			},
			paint: {
				'line-color': theme.bg || '#ffffff',
				'line-width': 9
			}
		},
		{
			id: 'route-line',
			source: 'route-source',
			type: 'line',
			layout: {
				'line-cap': 'round',
				'line-join': 'round',
				'visibility': state.showRoute ? 'visible' : 'none'
			},
			paint: {
				'line-color': theme.route || '#EF4444',
				'line-width': 4
			}
		}
	];

	if (state.showStreetNames) {
		layers.push(
			{
				id: 'road-labels-primary',
				source: 'openfreemap',
				'source-layer': labelsLayer,
				type: 'symbol',
				minzoom: 12,
				filter: ['match', ['get', roadClassField],
					['primary', 'secondary', 'motorway', 'trunk'], true, false],
				layout: {
					'symbol-placement': 'line',
					'text-field': nameField,
					'text-font': ['Noto Sans Regular'],
					'text-size': [
						'interpolate', ['linear'], ['zoom'],
						12, 8,
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
						12, 0.4,
						14, 0.6,
						16, 0.85,
						18, 1.0
					]
				}
			},
			{
				id: 'road-labels-minor',
				source: 'openfreemap',
				'source-layer': labelsLayer,
				type: 'symbol',
				minzoom: 13,
				filter: ['match', ['get', roadClassField],
					['tertiary', 'residential', 'service'], true, false],
				layout: {
					'symbol-placement': 'line',
					'text-field': nameField,
					'text-font': ['Noto Sans Regular'],
					'text-size': [
						'interpolate', ['linear'], ['zoom'],
						13, 6,
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
						13, 0.3,
						15, 0.5,
						17, 0.75,
						18, 0.9
					]
				}
			}
		);
	}

	const style = {
		version: 8,
		name: theme.name,
		glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
		sources: {
			openfreemap: sourceConfig,
			'route-source': {
				type: 'geojson',
				data: {
					type: 'Feature',
					properties: {},
					geometry: {
						type: 'LineString',
						coordinates: [[state.routeStartLon, state.routeStartLat], [state.routeEndLon, state.routeEndLat]]
					}
				}
			}
		},
		layers
	};
	return style;
}
