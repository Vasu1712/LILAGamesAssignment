import { useEffect, useMemo, useRef, useState } from 'react';
import { Ev, type MapData, type RawMatch } from '../data/types';
import { mmss } from '../lib/format';
import { MARKER_STYLE } from '../lib/style';

interface Props {
  data: MapData;
  match: RawMatch | null;
  maxT: number;
  t: number; // Infinity = show everything
  setT: (t: number) => void;
  mask: Uint8Array;
  matchCount: number;
}

const SPEEDS = [1, 5, 10, 25];

export function Timeline({ data, match, maxT, t, setT, mask, matchCount }: Props) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => setPlaying(false), [match?.id, data.map]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const cur = Number.isFinite(tRef.current) && tRef.current < maxT ? tRef.current : 0;
      const next = cur + dt * speed;
      if (next >= maxT) {
        setT(maxT);
        setPlaying(false);
        return;
      }
      setT(next);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, maxT, setT]);

  // Ticks for combat / storm events so a designer can jump straight to the action.
  const ticks = useMemo(() => {
    if (!maxT) return [];
    const out: { t: number; color: string; key: number }[] = [];
    const kinds: Record<number, keyof typeof MARKER_STYLE> = {
      [Ev.Kill]: 'Kill',
      [Ev.Killed]: 'Killed',
      [Ev.BotKill]: 'BotKill',
      [Ev.BotKilled]: 'BotKilled',
      [Ev.KilledByStorm]: 'KilledByStorm',
    };
    for (let r = 0; r < data.n; r++) {
      const k = kinds[data.e[r]];
      if (k && mask[data.p[r]]) out.push({ t: data.t[r], color: MARKER_STYLE[k].color, key: r });
    }
    return out.length > 400 ? [] : out; // aggregate views get too dense to be useful
  }, [data, mask, maxT]);

  const shown = Number.isFinite(t) ? Math.min(t, maxT) : maxT;

  return (
    <div className="timeline">
      <button
        className="play"
        onClick={() => {
          if (!playing && (!Number.isFinite(t) || t >= maxT)) setT(0);
          setPlaying(!playing);
        }}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <div className="track-wrap">
        <div className="ticks">
          {ticks.map((k) => (
            <i key={k.key} style={{ left: `${(k.t / maxT) * 100}%`, background: k.color }} />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={maxT || 1}
          step={1}
          value={shown}
          onChange={(e) => {
            setPlaying(false);
            setT(Number(e.target.value));
          }}
          aria-label="Match time"
        />
      </div>
      <div className="time">
        <strong>{mmss(shown)}</strong>
        <span className="muted"> / {mmss(maxT)}</span>
      </div>
      <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
      <button
        className="ghost"
        onClick={() => {
          setPlaying(false);
          setT(Infinity);
        }}
        title="Show the whole match"
      >
        Full
      </button>
      <span className="muted small hint">
        {match ? 'match clock' : `time since match start, across ${matchCount} matches`}
      </span>
    </div>
  );
}
