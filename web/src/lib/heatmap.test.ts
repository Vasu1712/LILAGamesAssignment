import { describe, expect, it } from 'vitest';
import { decode } from '../data/load';
import { Ev } from '../data/types';
import { GRID, densityGrid } from './heatmap';

const data = decode({
  map: 'Lockdown',
  config: { scale: 1000, originX: -500, originZ: -500, size: 1024 },
  matches: [{ id: 'm', day: 'February_10', start: 0, dur: 100, players: [0, 1], humans: 1, bots: 1, counts: {} }],
  players: [
    { id: 'a', human: true, uuid: true, m: 0, fate: 'survived' },
    { id: '1', human: false, uuid: false, m: 0, fate: 'survived' },
  ],
  rows: {
    p: [0, 0, 1],
    t: [0, 50, 10],
    x: [512, 512, 100],
    y: [512, 512, 100],
    h: [0, 0, 0],
    e: [Ev.Position, Ev.Position, Ev.BotPosition],
  },
});

describe('densityGrid', () => {
  it('peaks where the samples are and respects the player mask', () => {
    const { grid, count } = densityGrid(data, Uint8Array.from([1, 0]), [Ev.Position, Ev.BotPosition], Infinity);
    expect(count).toBe(2);
    const c = (512 / 1024) * GRID;
    expect(grid[c * GRID + c]).toBe(1);
    expect(grid[12 * GRID + 12]).toBe(0);
  });

  it('respects the time cursor', () => {
    expect(densityGrid(data, Uint8Array.from([1, 1]), [Ev.Position], 10).count).toBe(1);
  });
});
