import { useEffect, useMemo, useState } from 'react';
import { imageUrl, loadIndex, loadMap } from './data/load';
import {
  HEAT_INFO,
  MAP_IDS,
  MAP_LABELS,
  MARKER_KINDS,
  type HeatKind,
  type Index,
  type MapData,
  type MapId,
  type MarkerKind,
} from './data/types';
import { MapCanvas } from './components/MapCanvas';
import { Sidebar } from './components/Sidebar';
import { Timeline } from './components/Timeline';
import { densityGrid, paintGrid } from './lib/heatmap';
import { HUMAN_AGG, HUMAN_COLORS } from './lib/style';
import { readUrl, writeUrl } from './lib/url';

export interface Filters {
  days: Set<string>;
  matchId: string | null; // null = every match passing the day filter
  humans: boolean;
  bots: boolean;
  paths: boolean;
  markers: Set<MarkerKind>;
  heat: HeatKind;
}

export default function App() {
  const init = useMemo(readUrl, []);
  const [index, setIndex] = useState<Index | null>(null);
  const [map, setMap] = useState<MapId>(init.map ?? 'AmbroseValley');
  const [data, setData] = useState<MapData | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({
    days: new Set(init.days ?? []),
    matchId: init.match ?? null,
    humans: true,
    bots: true,
    paths: true,
    markers: new Set<MarkerKind>(MARKER_KINDS.filter((k) => k !== 'Loot')),
    heat: init.heat ?? 'off',
  });
  const [tCursor, setTCursor] = useState(Infinity);
  const [highlight, setHighlight] = useState<number | null>(null);

  useEffect(() => {
    loadIndex()
      .then((ix) => {
        setIndex(ix);
        setFilters((f) => (f.days.size ? f : { ...f, days: new Set(ix.days) }));
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    let live = true;
    setData(null);
    setImage(null);
    setHighlight(null);
    loadMap(map)
      .then((d) => live && setData(d))
      .catch((e) => setError(String(e)));
    const img = new Image();
    img.onload = () => live && setImage(img);
    img.src = imageUrl(map);
    return () => {
      live = false;
    };
  }, [map]);

  useEffect(() => writeUrl({ map, match: filters.matchId, heat: filters.heat }), [map, filters.matchId, filters.heat]);

  const update = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  const selectMatch = (id: string | null) => {
    update({ matchId: id });
    setHighlight(null);
    setTCursor(id ? 0 : Infinity);
  };

  // Matches passing the day filter; a selected match that is filtered out is dropped.
  const visibleMatches = useMemo(() => {
    if (!data) return [];
    return data.matches.map((m, i) => ({ m, i })).filter(({ m }) => filters.days.has(m.day));
  }, [data, filters.days]);

  const match = useMemo(() => {
    if (!data || !filters.matchId) return null;
    const i = data.matches.findIndex((m) => m.id === filters.matchId);
    return i >= 0 ? { m: data.matches[i], i } : null;
  }, [data, filters.matchId]);

  /** 1 for every journey that should be drawn. */
  const mask = useMemo(() => {
    if (!data) return new Uint8Array(0);
    const mk = new Uint8Array(data.players.length);
    const scope = match ? [match] : visibleMatches;
    for (const { m } of scope)
      for (const p of m.players) {
        const pl = data.players[p];
        if ((pl.human && filters.humans) || (!pl.human && filters.bots)) mk[p] = 1;
      }
    return mk;
  }, [data, match, visibleMatches, filters.humans, filters.bots]);

  const colorOf = useMemo(() => {
    if (!data || !match) return () => HUMAN_AGG;
    const order = new Map<number, string>();
    match.m.players
      .filter((p) => data.players[p].human)
      .forEach((p, k) => order.set(p, HUMAN_COLORS[k % HUMAN_COLORS.length]));
    return (p: number) => order.get(p) ?? HUMAN_AGG;
  }, [data, match]);

  const maxT = useMemo(() => {
    if (match) return match.m.dur;
    return visibleMatches.reduce((a, { m }) => Math.max(a, m.dur), 0);
  }, [match, visibleMatches]);

  const heatCanvas = useMemo(() => {
    if (!data || filters.heat === 'off') return null;
    const { grid, count } = densityGrid(data, mask, HEAT_INFO[filters.heat].codes, tCursor);
    if (!count) return null;
    const cv = document.createElement('canvas');
    paintGrid(grid, cv);
    return cv;
  }, [data, mask, filters.heat, tCursor]);

  if (error)
    return (
      <div className="fatal">
        Could not load data: {error}. Run <code>python pipeline/build_data.py</code> first.
      </div>
    );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="dot" /> LILA BLACK <span className="muted">· Player Journeys</span>
        </div>
        <nav className="map-tabs" aria-label="Map">
          {MAP_IDS.map((id) => (
            <button
              key={id}
              className={id === map ? 'active' : ''}
              onClick={() => {
                setMap(id);
                selectMatch(null);
              }}
            >
              {MAP_LABELS[id]}
              {index && <span className="count">{index.maps[id]?.matches ?? 0}</span>}
            </button>
          ))}
        </nav>
      </header>
      <div className="body">
        <Sidebar
          index={index}
          data={data}
          filters={filters}
          update={update}
          visibleMatches={visibleMatches}
          match={match}
          selectMatch={selectMatch}
          mask={mask}
          tCursor={tCursor}
          highlight={highlight}
          setHighlight={setHighlight}
          colorOf={colorOf}
        />
        <main className="stage">
          {data ? (
            <MapCanvas
              data={data}
              image={image}
              mask={mask}
              markers={filters.markers}
              showPaths={filters.paths}
              tCursor={tCursor}
              heat={heatCanvas}
              singleMatch={!!match}
              highlight={highlight}
              colorOf={colorOf}
              onPickPlayer={setHighlight}
            />
          ) : (
            <div className="loading">Loading {MAP_LABELS[map]}…</div>
          )}
          {data && (
            <Timeline
              data={data}
              match={match?.m ?? null}
              maxT={maxT}
              t={tCursor}
              setT={setTCursor}
              mask={mask}
              matchCount={match ? 1 : visibleMatches.length}
            />
          )}
        </main>
      </div>
    </div>
  );
}
