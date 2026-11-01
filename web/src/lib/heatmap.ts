import type { EvCode, MapData } from '../data/types';

export const GRID = 128; // 1024 / 128 = 8 minimap px per cell

/**
 * Bin selected rows into a GRID x GRID density field, then smooth it with three box-blur
 * passes (a cheap Gaussian approximation). Returns densities scaled to 0..1.
 */
export function densityGrid(
  d: MapData,
  playerMask: Uint8Array,
  codes: readonly EvCode[],
  tMax: number,
  radius = 2,
): { grid: Float32Array; count: number } {
  const want = new Uint8Array(8);
  for (const c of codes) want[c] = 1;
  const g = new Float32Array(GRID * GRID);
  const size = d.config.size;
  let count = 0;
  for (let i = 0; i < d.n; i++) {
    if (!want[d.e[i]] || !playerMask[d.p[i]] || d.t[i] > tMax) continue;
    const cx = Math.floor((d.x[i] / size) * GRID);
    const cy = Math.floor((d.y[i] / size) * GRID);
    if (cx < 0 || cy < 0 || cx >= GRID || cy >= GRID) continue;
    g[cy * GRID + cx] += 1;
    count++;
  }
  if (count === 0) return { grid: g, count };
  const tmp = new Float32Array(g.length);
  for (let pass = 0; pass < 3; pass++) {
    boxBlur(g, tmp, radius, true);
    boxBlur(tmp, g, radius, false);
  }
  // Normalise to the 99.5th percentile of non-empty cells so a single hot spot does not
  // flatten everything else (values above it saturate).
  const nz = Array.from(g).filter((v) => v > 0).sort((a, b) => a - b);
  const ref = nz[Math.min(nz.length - 1, Math.floor(nz.length * 0.995))] || 1;
  for (let i = 0; i < g.length; i++) g[i] = Math.min(1, g[i] / ref);
  return { grid: g, count };
}

function boxBlur(src: Float32Array, dst: Float32Array, r: number, horizontal: boolean) {
  const w = 2 * r + 1;
  for (let a = 0; a < GRID; a++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += at(src, a, k, horizontal);
    for (let b = 0; b < GRID; b++) {
      dst[horizontal ? a * GRID + b : b * GRID + a] = acc / w;
      acc += at(src, a, b + r + 1, horizontal) - at(src, a, b - r, horizontal);
    }
  }
}

function at(src: Float32Array, a: number, b: number, horizontal: boolean) {
  if (b < 0 || b >= GRID) return 0;
  return src[horizontal ? a * GRID + b : b * GRID + a];
}

// Heat ramp: transparent -> amber -> orange -> red, alpha rising with density so the
// map stays visible under cold areas.
const STOPS: [number, number, number, number, number][] = [
  [0.0, 255, 220, 110, 0],
  [0.08, 255, 220, 110, 0.08],
  [0.3, 255, 190, 70, 0.45],
  [0.6, 255, 120, 30, 0.7],
  [1.0, 215, 25, 40, 0.9],
];
const LUT = (() => {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    let k = 0;
    while (k < STOPS.length - 2 && v > STOPS[k + 1][0]) k++;
    const [a, b] = [STOPS[k], STOPS[k + 1]];
    const f = (v - a[0]) / (b[0] - a[0]);
    for (let c = 1; c <= 4; c++) {
      const val = a[c] + (b[c] - a[c]) * f;
      lut[i * 4 + c - 1] = c === 4 ? val * 255 : val;
    }
  }
  return lut;
})();

export const HEAT_GRADIENT_CSS = `linear-gradient(90deg, ${STOPS.map(
  (s) => `rgba(${s[1]},${s[2]},${s[3]},${Math.max(s[4], 0.15)}) ${s[0] * 100}%`,
).join(', ')})`;

export function paintGrid(grid: Float32Array, canvas: HTMLCanvasElement) {
  canvas.width = GRID;
  canvas.height = GRID;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(GRID, GRID);
  for (let i = 0; i < grid.length; i++) {
    const li = Math.round(grid[i] * 255) * 4;
    img.data.set(LUT.subarray(li, li + 4), i * 4);
  }
  ctx.putImageData(img, 0, 0);
}
