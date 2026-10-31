// World <-> minimap conversion. The pipeline already bakes pixel coordinates into the
// JSON; this module is the single TS reference of the formula (used for the
// cursor readout and unit tests).

export interface MapConfig {
  scale: number;
  originX: number;
  originZ: number;
  size: number; // minimap pixel space, 1024
}

export function worldToMinimap(x: number, z: number, c: MapConfig): [number, number] {
  const u = (x - c.originX) / c.scale;
  const v = (z - c.originZ) / c.scale;
  return [u * c.size, (1 - v) * c.size];
}

export function minimapToWorld(px: number, py: number, c: MapConfig): [number, number] {
  return [(px / c.size) * c.scale + c.originX, (1 - py / c.size) * c.scale + c.originZ];
}
