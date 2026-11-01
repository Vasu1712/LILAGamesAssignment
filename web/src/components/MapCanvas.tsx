import { useCallback, useEffect, useRef, useState } from 'react';
import { Ev, describeEvent, type MapData, type MarkerKind } from '../data/types';
import { minimapToWorld } from '../lib/coords';
import { mmss, shortId } from '../lib/format';
import { BOT_COLOR, MARKER_STYLE, drawMarker } from '../lib/style';

export interface MapCanvasProps {
  data: MapData;
  image: HTMLImageElement | null;
  mask: Uint8Array; // visible players
  markers: Set<MarkerKind>;
  showPaths: boolean;
  tCursor: number;
  heat: HTMLCanvasElement | null;
  singleMatch: boolean;
  highlight: number | null;
  colorOf: (player: number) => string;
  onPickPlayer: (player: number | null) => void;
}

interface View {
  k: number;
  tx: number;
  ty: number;
}

const CODE_TO_KIND: Record<number, MarkerKind | undefined> = {
  [Ev.Kill]: 'Kill',
  [Ev.Killed]: 'Killed',
  [Ev.BotKill]: 'BotKill',
  [Ev.BotKilled]: 'BotKilled',
  [Ev.KilledByStorm]: 'KilledByStorm',
  [Ev.Loot]: 'Loot',
};
const isMove = (e: number) => e === Ev.Position || e === Ev.BotPosition;
const isDeath = (e: number) => e === Ev.Killed || e === Ev.BotKilled || e === Ev.KilledByStorm;

export function MapCanvas(props: MapCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>({ k: 1, tx: 0, ty: 0 });
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const propsRef = useRef(props);
  propsRef.current = props;
  const frame = useRef(0);
  const [hover, setHover] = useState<{ sx: number; sy: number; row: number } | null>(null);
  const [cursorWorld, setCursorWorld] = useState<[number, number] | null>(null);

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    const { w, h, dpr } = sizeRef.current;
    const v = viewRef.current;
    const p = propsRef.current;
    const d = p.data;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // World-space layers: minimap, heatmap, paths.
    ctx.setTransform(dpr * v.k, 0, 0, dpr * v.k, dpr * v.tx, dpr * v.ty);
    const S = d.config.size;
    if (p.image) {
      ctx.globalAlpha = p.heat ? 0.55 : 1;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(p.image, 0, 0, S, S);
      ctx.globalAlpha = 1;
    }
    if (p.heat) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(p.heat, 0, 0, S, S);
    }

    if (p.showPaths) {
      const dense = !p.singleMatch;
      for (let pl = 0; pl < d.players.length; pl++) {
        if (!p.mask[pl]) continue;
        const info = d.players[pl];
        const rows = d.rowsByPlayer[pl];
        const hl = p.highlight === pl;
        const dim = p.highlight !== null && !hl;
        ctx.beginPath();
        let started = false;
        for (let j = 0; j < rows.length; j++) {
          const r = rows[j];
          if (d.t[r] > p.tCursor) break;
          if (!isMove(d.e[r])) continue;
          if (started) ctx.lineTo(d.x[r], d.y[r]);
          else {
            ctx.moveTo(d.x[r], d.y[r]);
            started = true;
          }
        }
        if (!started) continue;
        ctx.strokeStyle = info.human ? p.colorOf(pl) : BOT_COLOR;
        const base = dim ? 0.12 : dense ? (info.human ? 0.28 : 0.2) : info.human ? 0.95 : 0.7;
        ctx.globalAlpha = p.heat ? base * (dense ? 0.25 : 0.6) : base;
        ctx.lineWidth = (hl ? 3 : info.human ? (dense ? 1.2 : 2) : 1.2) / v.k;
        ctx.setLineDash(info.human ? [] : [4 / v.k, 3 / v.k]);
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // Screen-space layers: markers and playheads keep a constant on-screen size.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const toS = (r: number): [number, number] => [d.x[r] * v.k + v.tx, d.y[r] * v.k + v.ty];
    // Smaller markers when many matches are stacked; grow a little when zoomed in.
    const markerScale = (p.singleMatch ? 1 : 0.65) * Math.min(1.4, Math.max(1, v.k / 2));
    // Loot first so combat markers sit on top.
    for (const pass of [0, 1]) {
      for (let r = 0; r < d.n; r++) {
        const kind = CODE_TO_KIND[d.e[r]];
        if (!kind || !p.markers.has(kind) || !p.mask[d.p[r]] || d.t[r] > p.tCursor) continue;
        if ((kind === 'Loot') !== (pass === 0)) continue;
        const dim = p.highlight !== null && p.highlight !== d.p[r];
        const [sx, sy] = toS(r);
        if (sx < -10 || sy < -10 || sx > w + 10 || sy > h + 10) continue;
        drawMarker(ctx, kind, sx, sy, dim ? 0.25 : p.heat ? (p.singleMatch ? 0.8 : 0.3) : 1, markerScale);
      }
    }

    // Playheads: where each player is at tCursor (single match only).
    if (p.singleMatch && Number.isFinite(p.tCursor)) {
      for (let pl = 0; pl < d.players.length; pl++) {
        if (!p.mask[pl]) continue;
        const pos = positionAt(d, pl, p.tCursor);
        if (!pos) continue;
        const [wx, wy, dead] = pos;
        const sx = wx * v.k + v.tx;
        const sy = wy * v.k + v.ty;
        const human = d.players[pl].human;
        ctx.globalAlpha = dead ? 0.35 : 1;
        ctx.beginPath();
        ctx.arc(sx, sy, human ? 6 : 4.5, 0, Math.PI * 2);
        ctx.fillStyle = human ? p.colorOf(pl) : '#1b2230';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = human ? '#fff' : BOT_COLOR;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }, []);

  const schedule = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(draw);
  }, [draw]);

  const fit = useCallback(() => {
    const { w, h } = sizeRef.current;
    const S = propsRef.current.data.config.size;
    const k = Math.min(w, h) / S;
    viewRef.current = { k, tx: (w - S * k) / 2, ty: (h - S * k) / 2 };
    schedule();
  }, [schedule]);

  // Size tracking.
  useEffect(() => {
    const wrap = wrapRef.current!;
    const cv = canvasRef.current!;
    let first = true;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      sizeRef.current = { w, h, dpr };
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
      if (first) {
        first = false;
        fit();
      } else schedule();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fit, schedule]);

  // Re-fit when the map changes, redraw on any prop change.
  useEffect(() => fit(), [props.data.map, fit]);
  useEffect(() => schedule());

  // Pan / zoom.
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const onWheel = (ev: React.WheelEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    zoomAt(ev.clientX - rect.left, ev.clientY - rect.top, Math.exp(-ev.deltaY * 0.0015));
  };
  const zoomAt = (sx: number, sy: number, f: number) => {
    const v = viewRef.current;
    const k = Math.min(40, Math.max(0.3, v.k * f));
    const r = k / v.k;
    viewRef.current = { k, tx: sx - (sx - v.tx) * r, ty: sy - (sy - v.ty) * r };
    schedule();
  };
  // React's wheel listener is passive; block page scroll natively.
  useEffect(() => {
    const cv = canvasRef.current!;
    const stop = (e: WheelEvent) => e.preventDefault();
    cv.addEventListener('wheel', stop, { passive: false });
    return () => cv.removeEventListener('wheel', stop);
  }, []);

  const onDown = (ev: React.PointerEvent) => {
    drag.current = { x: ev.clientX, y: ev.clientY, moved: false };
    (ev.target as Element).setPointerCapture(ev.pointerId);
  };
  const onMove = (ev: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;
    const v = viewRef.current;
    if (drag.current) {
      const dx = ev.clientX - drag.current.x;
      const dy = ev.clientY - drag.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.current.moved = true;
      drag.current.x = ev.clientX;
      drag.current.y = ev.clientY;
      viewRef.current = { ...v, tx: v.tx + dx, ty: v.ty + dy };
      setHover(null);
      schedule();
      return;
    }
    const wx = (sx - v.tx) / v.k;
    const wy = (sy - v.ty) / v.k;
    setCursorWorld(minimapToWorld(wx, wy, props.data.config));
    const row = pickMarker(sx, sy);
    setHover(row === null ? null : { sx, sy, row });
  };
  const onUp = (ev: React.PointerEvent) => {
    const wasDrag = drag.current?.moved;
    drag.current = null;
    if (wasDrag) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const row = pickMarker(ev.clientX - rect.left, ev.clientY - rect.top);
    props.onPickPlayer(row === null ? null : props.data.p[row]);
  };

  /** Nearest visible marker within 10 screen px. */
  const pickMarker = (sx: number, sy: number): number | null => {
    const p = propsRef.current;
    const d = p.data;
    const v = viewRef.current;
    let best: number | null = null;
    let bestD = 100;
    for (let r = 0; r < d.n; r++) {
      const kind = CODE_TO_KIND[d.e[r]];
      if (!kind || !p.markers.has(kind) || !p.mask[d.p[r]] || d.t[r] > p.tCursor) continue;
      const dx = d.x[r] * v.k + v.tx - sx;
      const dy = d.y[r] * v.k + v.ty - sy;
      const dd = dx * dx + dy * dy;
      // Prefer combat over loot when stacked.
      const bias = kind === 'Loot' ? 20 : 0;
      if (dd + bias < bestD) {
        bestD = dd + bias;
        best = r;
      }
    }
    return best;
  };

  const d = props.data;
  const tip = hover && tooltip(d, hover.row);

  return (
    <div className="map-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        onWheel={onWheel}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => {
          setHover(null);
          setCursorWorld(null);
        }}
        style={{ cursor: hover ? 'pointer' : 'grab' }}
      />
      <div className="zoom-ctl">
        <button onClick={() => zoomAt(sizeRef.current.w / 2, sizeRef.current.h / 2, 1.4)} title="Zoom in">
          +
        </button>
        <button onClick={() => zoomAt(sizeRef.current.w / 2, sizeRef.current.h / 2, 1 / 1.4)} title="Zoom out">
          −
        </button>
        <button onClick={fit} title="Fit map">
          ⤢
        </button>
      </div>
      {cursorWorld && (
        <div className="coord-readout">
          world x {cursorWorld[0].toFixed(0)} · z {cursorWorld[1].toFixed(0)}
        </div>
      )}
      {tip && hover && (
        <div className="tooltip" style={{ left: hover.sx + 14, top: hover.sy + 14 }}>
          <div className="tip-title">
            <span className="tip-swatch" style={{ color: MARKER_STYLE[tip.kind].color }}>
              {MARKER_STYLE[tip.kind].glyph}
            </span>
            {describeEvent(tip.kind, tip.human)}
          </div>
          <div>
            {tip.human ? 'Human' : 'Bot'} <code>{shortId(tip.player)}</code>
          </div>
          <div className="muted">
            at {mmss(tip.t)} · elevation {tip.h.toFixed(0)}
          </div>
          <div className="muted small">click to highlight this player</div>
        </div>
      )}
    </div>
  );
}

function tooltip(d: MapData, r: number) {
  const kind = CODE_TO_KIND[d.e[r]];
  if (!kind) return null;
  const pl = d.players[d.p[r]];
  return { kind, player: pl.id, human: pl.human, t: d.t[r], h: d.h[r] };
}

/** Interpolated position of a player at time t; null before their first sample. */
function positionAt(d: MapData, pl: number, t: number): [number, number, boolean] | null {
  const rows = d.rowsByPlayer[pl];
  let prev = -1;
  let next = -1;
  let dead = false;
  for (let j = 0; j < rows.length; j++) {
    const r = rows[j];
    if (d.t[r] <= t) {
      if (isDeath(d.e[r])) dead = true;
      prev = r;
    } else {
      next = r;
      break;
    }
  }
  if (prev < 0) return null;
  // After the last sample with no death the player has left the match (extracted).
  if (dead || next < 0) return [d.x[prev], d.y[prev], dead || t - d.t[prev] > 10];
  const span = d.t[next] - d.t[prev];
  const f = span > 0 ? (t - d.t[prev]) / span : 0;
  return [d.x[prev] + (d.x[next] - d.x[prev]) * f, d.y[prev] + (d.y[next] - d.y[prev]) * f, false];
}
