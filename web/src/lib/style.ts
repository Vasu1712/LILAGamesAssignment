import type { MarkerKind } from '../data/types';

// Markers are encoded by shape AND colour, so they stay distinguishable for
// colour-blind users and on every minimap palette.
export const MARKER_STYLE: Record<MarkerKind, { color: string; glyph: string }> = {
  Kill: { color: '#ff4d4f', glyph: '✕' },
  Killed: { color: '#ff4d4f', glyph: '▼' },
  BotKill: { color: '#ffb020', glyph: '✕' },
  BotKilled: { color: '#ffb020', glyph: '▼' },
  KilledByStorm: { color: '#c08cff', glyph: '◆' },
  Loot: { color: '#41d99a', glyph: '■' },
};

/** Fixed-order colours for human journeys inside one match (rarely more than 2). */
export const HUMAN_COLORS = ['#ff7a45', '#4dabf7', '#f06595', '#ffd43b', '#9775fa', '#63e6be'];
export const HUMAN_AGG = '#ff7a45';
export const BOT_COLOR = '#a9bcd0';

export function drawMarker(ctx: CanvasRenderingContext2D, kind: MarkerKind, x: number, y: number, alpha: number, scale = 1) {
  const { color } = MARKER_STYLE[kind];
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  switch (kind) {
    case 'Kill':
    case 'BotKill': {
      const s = 5 * scale;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - s, y - s);
      ctx.lineTo(x + s, y + s);
      ctx.moveTo(x + s, y - s);
      ctx.lineTo(x - s, y + s);
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.lineWidth = 2 + 3 * scale;
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5 * scale;
      ctx.stroke();
      break;
    }
    case 'Killed':
    case 'BotKilled': {
      const s = 6 * scale;
      ctx.beginPath();
      ctx.moveTo(x - s, y - s * 0.7);
      ctx.lineTo(x + s, y - s * 0.7);
      ctx.lineTo(x, y + s);
      ctx.closePath();
      fillRing(ctx, color);
      break;
    }
    case 'KilledByStorm': {
      const s = 6.5 * scale;
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s, y);
      ctx.lineTo(x, y + s);
      ctx.lineTo(x - s, y);
      ctx.closePath();
      fillRing(ctx, color);
      break;
    }
    case 'Loot': {
      const s = 3 * scale;
      ctx.beginPath();
      ctx.rect(x - s, y - s, s * 2, s * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.stroke();
      break;
    }
  }
  ctx.globalAlpha = 1;
}

function fillRing(ctx: CanvasRenderingContext2D, color: string) {
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#111';
  ctx.stroke();
}
