import type { Index, MapData, MapId, RawMapFile } from './types';

const base = import.meta.env.BASE_URL;
const cache = new Map<MapId, Promise<MapData>>();

export async function loadIndex(): Promise<Index> {
  const r = await fetch(`${base}data/index.json`);
  if (!r.ok) throw new Error(`index.json: HTTP ${r.status}`);
  return r.json();
}

export function loadMap(map: MapId): Promise<MapData> {
  let p = cache.get(map);
  if (!p) {
    p = fetch(`${base}data/${map}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`${map}.json: HTTP ${r.status}`);
        return r.json() as Promise<RawMapFile>;
      })
      .then(decode);
    p.catch(() => cache.delete(map));
    cache.set(map, p);
  }
  return p;
}

export function decode(raw: RawMapFile): MapData {
  const n = raw.rows.p.length;
  const p = Int32Array.from(raw.rows.p);
  const buckets: number[][] = raw.players.map(() => []);
  for (let i = 0; i < n; i++) buckets[p[i]].push(i);
  return {
    map: raw.map,
    config: raw.config,
    matches: raw.matches,
    players: raw.players,
    n,
    p,
    t: Float32Array.from(raw.rows.t),
    x: Float32Array.from(raw.rows.x),
    y: Float32Array.from(raw.rows.y),
    h: Float32Array.from(raw.rows.h),
    e: Uint8Array.from(raw.rows.e),
    rowsByPlayer: buckets.map((b) => Int32Array.from(b)),
  };
}

export const imageUrl = (map: MapId) => `${base}minimaps/${map}.webp`;
