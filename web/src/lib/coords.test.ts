import { describe, expect, it } from 'vitest';
import { minimapToWorld, worldToMinimap } from './coords';

const ambrose = { scale: 900, originX: -370, originZ: -473, size: 1024 };

describe('worldToMinimap', () => {
  it('matches the worked example in the data README', () => {
    const [px, py] = worldToMinimap(-301.45, -355.55, ambrose);
    expect(Math.round(px)).toBe(78);
    expect(Math.round(py)).toBe(890);
  });

  it('flips the vertical axis (world +z is up on the image)', () => {
    const [, low] = worldToMinimap(0, -400, ambrose);
    const [, high] = worldToMinimap(0, 300, ambrose);
    expect(high).toBeLessThan(low);
  });

  it('round-trips', () => {
    const [x, z] = minimapToWorld(...worldToMinimap(123.4, -56.7, ambrose), ambrose);
    expect(x).toBeCloseTo(123.4, 4);
    expect(z).toBeCloseTo(-56.7, 4);
  });
});
