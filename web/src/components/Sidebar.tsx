import { useMemo, useState } from 'react';
import type { Filters } from '../App';
import {
  Ev,
  HEAT_INFO,
  MARKER_INFO,
  MARKER_KINDS,
  type HeatKind,
  type Index,
  type MapData,
  type MarkerKind,
  type RawMatch,
} from '../data/types';
import { dayLabel, mmss, shortId, startLabel } from '../lib/format';
import { HEAT_GRADIENT_CSS } from '../lib/heatmap';
import { BOT_COLOR, HUMAN_AGG, MARKER_STYLE } from '../lib/style';

interface Props {
  index: Index | null;
  data: MapData | null;
  filters: Filters;
  update: (p: Partial<Filters>) => void;
  visibleMatches: { m: RawMatch; i: number }[];
  match: { m: RawMatch; i: number } | null;
  selectMatch: (id: string | null) => void;
  mask: Uint8Array;
  tCursor: number;
  highlight: number | null;
  setHighlight: (p: number | null) => void;
  colorOf: (p: number) => string;
}

const KIND_OF_CODE: Partial<Record<number, MarkerKind>> = {
  [Ev.Kill]: 'Kill',
  [Ev.Killed]: 'Killed',
  [Ev.BotKill]: 'BotKill',
  [Ev.BotKilled]: 'BotKilled',
  [Ev.KilledByStorm]: 'KilledByStorm',
  [Ev.Loot]: 'Loot',
};

type Sort = 'action' | 'longest' | 'newest' | 'crowded';
const action = (m: RawMatch) =>
  (m.counts.Kill ?? 0) + (m.counts.Killed ?? 0) + (m.counts.BotKill ?? 0) + (m.counts.BotKilled ?? 0) + (m.counts.KilledByStorm ?? 0);

const FATE_LABEL: Record<string, string> = {
  survived: 'survived / extracted',
  killed_by_player: 'killed by player',
  killed_by_bot: 'killed by bot',
  storm: 'died to storm',
  killed: 'killed',
};

export function Sidebar(p: Props) {
  const { data, filters, update } = p;
  const [sort, setSort] = useState<Sort>('action');
  const [query, setQuery] = useState('');

  const counts = useMemo(() => {
    const c: Record<MarkerKind, number> = { Kill: 0, Killed: 0, BotKill: 0, BotKilled: 0, KilledByStorm: 0, Loot: 0 };
    if (!data) return c;
    for (let r = 0; r < data.n; r++) {
      const k = KIND_OF_CODE[data.e[r]];
      if (k && p.mask[data.p[r]] && data.t[r] <= p.tCursor) c[k]++;
    }
    return c;
  }, [data, p.mask, p.tCursor]);

  const journeys = useMemo(() => {
    let h = 0;
    let b = 0;
    if (data) for (let i = 0; i < p.mask.length; i++) if (p.mask[i]) data.players[i].human ? h++ : b++;
    return { h, b };
  }, [data, p.mask]);

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = p.visibleMatches.filter(({ m }) => !q || m.id.toLowerCase().includes(q));
    const by: Record<Sort, (a: RawMatch, b: RawMatch) => number> = {
      action: (a, b) => action(b) - action(a) || b.dur - a.dur,
      longest: (a, b) => b.dur - a.dur,
      newest: (a, b) => b.start - a.start,
      crowded: (a, b) => b.players.length - a.players.length || action(b) - action(a),
    };
    return list.sort((a, b) => by[sort](a.m, b.m));
  }, [p.visibleMatches, sort, query]);

  const days = p.index?.days ?? [];
  const toggleDay = (d: string) => {
    const s = new Set(filters.days);
    if (s.has(d)) s.delete(d);
    else s.add(d);
    update({ days: s });
    if (p.match && !s.has(p.match.m.day)) p.selectMatch(null);
  };
  const toggleMarker = (k: MarkerKind) => {
    const s = new Set(filters.markers);
    if (s.has(k)) s.delete(k);
    else s.add(k);
    update({ markers: s });
  };

  return (
    <aside className="sidebar">
      <section>
        <h3>
          Date <span className="muted small">(UTC day folders)</span>
        </h3>
        <div className="chips">
          {days.map((d) => (
            <button key={d} className={`chip ${filters.days.has(d) ? 'on' : ''}`} onClick={() => toggleDay(d)}>
              {dayLabel(d)}
              {d === 'February_14' && <span title="Partial day: data collection was still running"> *</span>}
            </button>
          ))}
          <button className="chip ghost" onClick={() => update({ days: new Set(days) })}>
            All
          </button>
        </div>
      </section>

      <section className="matches">
        <h3>
          Match <span className="muted small">{p.visibleMatches.length} in range</span>
        </h3>
        <button className={`match-row all ${p.match ? '' : 'sel'}`} onClick={() => p.selectMatch(null)}>
          <strong>All matches</strong>
          <span className="muted small">aggregate view of every journey in the date range</span>
        </button>
        <div className="match-tools">
          <input placeholder="Search match id…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort matches">
            <option value="action">Most combat</option>
            <option value="crowded">Most players</option>
            <option value="longest">Longest</option>
            <option value="newest">Newest</option>
          </select>
        </div>
        <div className="match-list">
          {sorted.map(({ m }) => (
            <button
              key={m.id}
              className={`match-row ${p.match?.m.id === m.id ? 'sel' : ''}`}
              onClick={() => p.selectMatch(m.id)}
            >
              <div className="row1">
                <code>{shortId(m.id)}</code>
                <span className="muted small">{startLabel(m.start)}</span>
              </div>
              <div className="row2 small">
                <span title="match length">{mmss(m.dur)}</span>
                <span title="human journeys">
                  <i className="sw" style={{ background: HUMAN_AGG }} />
                  {m.humans}
                </span>
                <span title="bot journeys">
                  <i className="sw" style={{ background: BOT_COLOR }} />
                  {m.bots}
                </span>
                {(['Kill', 'BotKill', 'BotKilled', 'KilledByStorm', 'Loot'] as MarkerKind[]).map(
                  (k) =>
                    !!m.counts[k] && (
                      <span key={k} title={MARKER_INFO[k].label} style={{ color: MARKER_STYLE[k].color }}>
                        {MARKER_STYLE[k].glyph}
                        <span className="txt">{m.counts[k]}</span>
                      </span>
                    ),
                )}
              </div>
            </button>
          ))}
          {!sorted.length && <div className="muted small pad">No matches for this filter.</div>}
        </div>
      </section>

      <section>
        <h3>Players</h3>
        <div className="toggles">
          <Toggle on={filters.humans} onClick={() => update({ humans: !filters.humans })}>
            <i className="line" style={{ background: HUMAN_AGG }} /> Humans <span className="count">{journeys.h}</span>
          </Toggle>
          <Toggle on={filters.bots} onClick={() => update({ bots: !filters.bots })}>
            <i className="line dashed" style={{ borderColor: BOT_COLOR }} /> Bots <span className="count">{journeys.b}</span>
          </Toggle>
          <Toggle on={filters.paths} onClick={() => update({ paths: !filters.paths })}>
            Movement paths
          </Toggle>
        </div>
      </section>

      <section>
        <h3>Event markers</h3>
        <div className="toggles">
          {MARKER_KINDS.map((k) => (
            <Toggle key={k} on={filters.markers.has(k)} onClick={() => toggleMarker(k)} title={MARKER_INFO[k].hint}>
              <span className="glyph" style={{ color: MARKER_STYLE[k].color }}>
                {MARKER_STYLE[k].glyph}
              </span>
              {MARKER_INFO[k].label}
              <span className="count">{counts[k]}</span>
            </Toggle>
          ))}
        </div>
      </section>

      <section>
        <h3>Heatmap</h3>
        <div className="seg">
          {(['off', ...Object.keys(HEAT_INFO)] as HeatKind[]).map((h) => (
            <button key={h} className={filters.heat === h ? 'on' : ''} onClick={() => update({ heat: h })}>
              {h === 'off' ? 'Off' : HEAT_INFO[h as Exclude<HeatKind, 'off'>].label}
            </button>
          ))}
        </div>
        {filters.heat !== 'off' && (
          <div className="heat-legend">
            <span className="muted small">low</span>
            <div className="bar" style={{ background: HEAT_GRADIENT_CSS }} />
            <span className="muted small">high</span>
          </div>
        )}
        <p className="muted small">
          Uses the same scope as the map: date, match, humans/bots and the timeline position.
        </p>
      </section>

      {p.match && data && (
        <section>
          <h3>
            In this match <span className="muted small">click to highlight</span>
          </h3>
          <div className="players">
            {p.match.m.players.map((pi) => {
              const pl = data.players[pi];
              return (
                <button
                  key={pi}
                  className={`player ${p.highlight === pi ? 'sel' : ''} ${p.mask[pi] ? '' : 'hidden'}`}
                  onClick={() => p.setHighlight(p.highlight === pi ? null : pi)}
                >
                  <i
                    className={pl.human ? 'sw' : 'sw ring'}
                    style={pl.human ? { background: p.colorOf(pi) } : { borderColor: BOT_COLOR }}
                  />
                  <span>{pl.human ? 'Human' : 'Bot'}</span>
                  <code>{shortId(pl.id)}</code>
                  {pl.human && !pl.uuid && (
                    <span className="flag" title="Numeric user_id (README says bot) but emits human telemetry">
                      id?
                    </span>
                  )}
                  <span className="muted small fate">{FATE_LABEL[pl.fate]}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </aside>
  );
}

function Toggle(props: { on: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button className={`toggle ${props.on ? 'on' : ''}`} onClick={props.onClick} title={props.title} aria-pressed={props.on}>
      <span className="check">{props.on ? '✓' : ''}</span>
      {props.children}
    </button>
  );
}
