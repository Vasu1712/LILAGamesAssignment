import { MAP_IDS, type HeatKind, type MapId } from '../data/types';

// Keep the view in the query string so a designer can paste a link to an exact match.
const HEATS: HeatKind[] = ['off', 'traffic', 'kills', 'deaths', 'storm', 'loot'];

export function readUrl(): { map?: MapId; match?: string; heat?: HeatKind; days?: string[] } {
  const q = new URLSearchParams(window.location.search);
  const map = q.get('map') as MapId | null;
  const heat = q.get('heat') as HeatKind | null;
  return {
    map: map && MAP_IDS.includes(map) ? map : undefined,
    match: q.get('match') ?? undefined,
    heat: heat && HEATS.includes(heat) ? heat : undefined,
  };
}

export function writeUrl(s: { map: MapId; match: string | null; heat: HeatKind }) {
  const q = new URLSearchParams();
  q.set('map', s.map);
  if (s.match) q.set('match', s.match);
  if (s.heat !== 'off') q.set('heat', s.heat);
  window.history.replaceState(null, '', `${window.location.pathname}?${q}`);
}
