/**
 * Map Tile Utilities
 *
 * Functions for fetching and composing map tiles from free/open-source providers.
 * Converts lat/lng to tile coordinates and composites multiple tiles into a
 * single image for SVG embedding.
 *
 * Supported Providers (all free with attribution):
 * - terrain: OpenTopoMap (CC-BY-SA)
 * - road: OpenStreetMap (ODbL)
 * - satellite: ESRI World Imagery (free with attribution)
 * - toner: Stadia/Stamen Toner (free tier)
 * - watercolor: Stadia/Stamen Watercolor (free tier)
 *
 * See docs/MAP_TILES.md for full provider details and terms.
 */

import type { MapTileStyle, MapMarker } from '@bendyline/squisq/schemas';

/**
 * Tile provider configuration.
 */
export interface TileProvider {
  /** URL template with {z}, {x}, {y} placeholders */
  url: string;
  /** Attribution text (required for display) */
  attribution: string;
  /** Maximum zoom level */
  maxZoom: number;
  /** Tile size in pixels (default: 256) */
  tileSize?: number;
}

/**
 * Free tile providers for each map style.
 * All require attribution to be displayed.
 */
export const TILE_PROVIDERS: Record<MapTileStyle, TileProvider> = {
  terrain: {
    url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: 'Map: OpenTopoMap (CC-BY-SA)',
    maxZoom: 17,
  },
  road: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery: Esri, Maxar, Earthstar',
    maxZoom: 18,
  },
  toner: {
    url: 'https://tiles.stadiamaps.com/tiles/stamen_toner/{z}/{x}/{y}.png',
    attribution: 'Map: Stadia Maps, Stamen Design',
    maxZoom: 20,
  },
  watercolor: {
    url: 'https://tiles.stadiamaps.com/tiles/stamen_watercolor/{z}/{x}/{y}.jpg',
    attribution: 'Map: Stadia Maps, Stamen Design',
    maxZoom: 16,
  },
};

/**
 * Convert latitude/longitude to tile coordinates at a given zoom level.
 * Uses Web Mercator projection (EPSG:3857).
 */
export function latLngToTile(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y };
}

/**
 * Convert tile coordinates back to lat/lng (top-left corner of tile).
 */
export function tileToLatLng(x: number, y: number, zoom: number): { lat: number; lng: number } {
  const n = Math.pow(2, zoom);
  const lng = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const lat = (latRad * 180) / Math.PI;
  return { lat, lng };
}

/**
 * Get the pixel offset within a tile for a given lat/lng.
 */
export function getPixelOffset(
  lat: number,
  lng: number,
  zoom: number,
  tileSize: number = 256
): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const xTile = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const yTile = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

  return {
    x: (xTile - Math.floor(xTile)) * tileSize,
    y: (yTile - Math.floor(yTile)) * tileSize,
  };
}

/**
 * Calculate which tiles are needed to cover a viewport centered on lat/lng.
 */
export function getTilesForViewport(
  centerLat: number,
  centerLng: number,
  zoom: number,
  viewportWidth: number,
  viewportHeight: number,
  tileSize: number = 256
): Array<{ x: number; y: number; screenX: number; screenY: number }> {
  const centerTile = latLngToTile(centerLat, centerLng, zoom);
  const pixelOffset = getPixelOffset(centerLat, centerLng, zoom, tileSize);

  // How many tiles we need in each direction
  const tilesX = Math.ceil(viewportWidth / tileSize) + 1;
  const tilesY = Math.ceil(viewportHeight / tileSize) + 1;

  // Start tile offset
  const startX = centerTile.x - Math.floor(tilesX / 2);
  const startY = centerTile.y - Math.floor(tilesY / 2);

  // Screen position of the center tile
  const centerScreenX = viewportWidth / 2 - pixelOffset.x;
  const centerScreenY = viewportHeight / 2 - pixelOffset.y;

  const tiles: Array<{ x: number; y: number; screenX: number; screenY: number }> = [];

  for (let dy = 0; dy < tilesY; dy++) {
    for (let dx = 0; dx < tilesX; dx++) {
      const tileX = startX + dx;
      const tileY = startY + dy;
      const screenX = centerScreenX + (tileX - centerTile.x) * tileSize;
      const screenY = centerScreenY + (tileY - centerTile.y) * tileSize;

      tiles.push({ x: tileX, y: tileY, screenX, screenY });
    }
  }

  return tiles;
}

/**
 * Build a tile URL from the provider template.
 */
export function buildTileUrl(provider: TileProvider, x: number, y: number, z: number): string {
  return provider.url.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

/**
 * Fetch a single tile image as an HTMLImageElement.
 */
async function fetchTileImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load tile: ${url}`));
    img.src = url;
  });
}

/**
 * Options for composing a map image.
 */
export interface ComposeMapOptions {
  /** Center coordinates */
  center: { lat: number; lng: number };
  /** Zoom level */
  zoom: number;
  /** Map tile style */
  style: MapTileStyle;
  /** Output width in pixels */
  width: number;
  /** Output height in pixels */
  height: number;
  /** Optional markers to render */
  markers?: MapMarker[];
  /** Show attribution (default: true) */
  showAttribution?: boolean;
}

/**
 * Compose map tiles into a single data URL image.
 *
 * This is the main function for generating map images for blocks.
 * It fetches all needed tiles, composites them on a canvas, and
 * returns a data URL that can be used in an SVG <image> element.
 */
export async function composeMapImage(options: ComposeMapOptions): Promise<string> {
  const { center, zoom, style, width, height, markers = [], showAttribution = true } = options;

  const provider = TILE_PROVIDERS[style];
  const tileSize = provider.tileSize || 256;
  const clampedZoom = Math.min(zoom, provider.maxZoom);

  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  // Fill with a neutral background in case tiles fail to load
  ctx.fillStyle = style === 'toner' ? '#ffffff' : '#e5e7eb';
  ctx.fillRect(0, 0, width, height);

  // Get tiles needed
  const tiles = getTilesForViewport(center.lat, center.lng, clampedZoom, width, height, tileSize);

  // Fetch and draw tiles
  const tilePromises = tiles.map(async (tile) => {
    const url = buildTileUrl(provider, tile.x, tile.y, clampedZoom);
    try {
      const img = await fetchTileImage(url);
      ctx.drawImage(img, tile.screenX, tile.screenY, tileSize, tileSize);
    } catch (err) {
      // Tile failed to load - leave background color
      console.warn(`Tile load failed: ${url}`, err);
    }
  });

  await Promise.all(tilePromises);

  // Draw markers
  for (const marker of markers) {
    drawMarker(ctx, marker, center, clampedZoom, width, height, tileSize);
  }

  // Draw attribution
  if (showAttribution) {
    drawAttribution(ctx, provider.attribution, width, height);
  }

  return canvas.toDataURL('image/png');
}

/**
 * Draw a marker on the canvas.
 */
function drawMarker(
  ctx: CanvasRenderingContext2D,
  marker: MapMarker,
  center: { lat: number; lng: number },
  zoom: number,
  width: number,
  height: number,
  tileSize: number
): void {
  // Calculate screen position of marker relative to center
  const centerTile = latLngToTile(center.lat, center.lng, zoom);
  const markerTile = latLngToTile(marker.lat, marker.lng, zoom);

  const centerOffset = getPixelOffset(center.lat, center.lng, zoom, tileSize);
  const markerOffset = getPixelOffset(marker.lat, marker.lng, zoom, tileSize);

  const dx = (markerTile.x - centerTile.x) * tileSize + (markerOffset.x - centerOffset.x);
  const dy = (markerTile.y - centerTile.y) * tileSize + (markerOffset.y - centerOffset.y);

  const screenX = width / 2 + dx;
  const screenY = height / 2 + dy;

  // Draw marker
  const color = marker.color || '#ef4444';
  const icon = marker.icon || 'pin';

  ctx.save();

  if (icon === 'pin') {
    // Draw pin shape
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(screenX, screenY - 12, 8, Math.PI, 0, false);
    ctx.lineTo(screenX, screenY);
    ctx.closePath();
    ctx.fill();

    // White dot in center
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(screenX, screenY - 12, 3, 0, Math.PI * 2);
    ctx.fill();
  } else if (icon === 'circle') {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(screenX, screenY, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
  } else if (icon === 'star') {
    ctx.fillStyle = color;
    drawStar(ctx, screenX, screenY, 5, 10, 5);
    ctx.fill();
  }

  // Draw label if present
  if (marker.label) {
    ctx.fillStyle = '#1f2937';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(marker.label, screenX, screenY + 20);
  }

  ctx.restore();
}

/**
 * Draw a star shape.
 */
function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  spikes: number,
  outerRadius: number,
  innerRadius: number
): void {
  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / spikes;

  ctx.beginPath();
  ctx.moveTo(cx, cy - outerRadius);

  for (let i = 0; i < spikes; i++) {
    ctx.lineTo(cx + Math.cos(rot) * outerRadius, cy + Math.sin(rot) * outerRadius);
    rot += step;
    ctx.lineTo(cx + Math.cos(rot) * innerRadius, cy + Math.sin(rot) * innerRadius);
    rot += step;
  }

  ctx.lineTo(cx, cy - outerRadius);
  ctx.closePath();
}

/**
 * Draw attribution text on the canvas.
 */
function drawAttribution(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
  height: number
): void {
  ctx.save();

  // Semi-transparent background
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  const padding = 4;
  ctx.font = '10px system-ui, sans-serif';
  const textWidth = ctx.measureText(text).width;
  ctx.fillRect(width - textWidth - padding * 2 - 4, height - 16, textWidth + padding * 2, 14);

  // Text
  ctx.fillStyle = '#374151';
  ctx.textAlign = 'right';
  ctx.fillText(text, width - padding - 4, height - 5);

  ctx.restore();
}

/**
 * Get attribution text for a map style.
 */
export function getAttribution(style: MapTileStyle): string {
  return TILE_PROVIDERS[style].attribution;
}
