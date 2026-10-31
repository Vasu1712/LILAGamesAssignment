// Shapes of the JSON written by pipeline/build_data.py, and the decoded in-memory model.

export type MapId = 'AmbroseValley' | 'GrandRift' | 'Lockdown';
export const MAP_IDS: MapId[] = ['AmbroseValley', 'GrandRift', 'Lockdown'];
export const MAP_LABELS: Record<MapId, string> = {
  AmbroseValley: 'Ambrose Valley',
  GrandRift: 'Grand Rift',
  Lockdown: 'Lockdown',
};

/** Event codes; must match EVENT_CODES in the pipeline. */
export const Ev = {
  Position: 0,
  BotPosition: 1,
  Kill: 2,
  Killed: 3,
  BotKill: 4,
  BotKilled: 5,
  KilledByStorm: 6,
  Loot: 7,
} as const;
export type EvCode = (typeof Ev)[keyof typeof Ev];

/** The discrete (non-movement) events a designer can toggle as markers. */
export type MarkerKind = 'Kill' | 'Killed' | 'BotKill' | 'BotKilled' | 'KilledByStorm' | 'Loot';
export const MARKER_KINDS: MarkerKind[] = ['Kill', 'Killed', 'BotKill', 'BotKilled', 'KilledByStorm', 'Loot'];

export const MARKER_INFO: Record<MarkerKind, { label: string; hint: string }> = {
  Kill: { label: 'PvP kill', hint: 'Player killed another human (killer position)' },
  Killed: { label: 'PvP death', hint: 'Player killed by another human (victim position)' },
  BotKill: { label: 'PvE kill', hint: 'Human killed a bot, or a bot scored a kill (killer position)' },
  BotKilled: { label: 'PvE death', hint: 'Human killed by a bot, or a bot was killed (victim position)' },
  KilledByStorm: { label: 'Storm death', hint: 'Player died to the storm' },
  Loot: { label: 'Loot', hint: 'Item picked up' },
};

/** Actor-aware wording: the same event code reads differently in a bot's own journey. */
export function describeEvent(kind: MarkerKind, actorHuman: boolean): string {
  if (actorHuman) {
    return {
      Kill: 'Killed a human player',
      Killed: 'Killed by a human player',
      BotKill: 'Killed a bot',
      BotKilled: 'Killed by a bot',
      KilledByStorm: 'Died to the storm',
      Loot: 'Picked up loot',
    }[kind];
  }
  return { Kill: 'Bot killed a player', Killed: 'Bot was killed', BotKill: 'Bot scored a kill', BotKilled: 'Bot was killed', KilledByStorm: 'Bot died to the storm', Loot: 'Bot picked up loot' }[kind];
}

export type HeatKind = 'off' | 'traffic' | 'kills' | 'deaths' | 'storm' | 'loot';
export const HEAT_INFO: Record<Exclude<HeatKind, 'off'>, { label: string; codes: EvCode[] }> = {
  traffic: { label: 'Traffic', codes: [Ev.Position, Ev.BotPosition] },
  kills: { label: 'Kill zones', codes: [Ev.Kill, Ev.BotKill] },
  deaths: { label: 'Death zones', codes: [Ev.Killed, Ev.BotKilled, Ev.KilledByStorm] },
  storm: { label: 'Storm deaths', codes: [Ev.KilledByStorm] },
  loot: { label: 'Loot', codes: [Ev.Loot] },
};

export type Fate = 'survived' | 'killed_by_player' | 'killed_by_bot' | 'storm' | 'killed';

export interface RawMatch {
  id: string;
  day: string; // source folder, e.g. "February_10"
  start: number; // unix seconds
  dur: number; // seconds
  players: number[];
  humans: number;
  bots: number;
  counts: Partial<Record<MarkerKind, number>>;
}

export interface RawPlayer {
  id: string;
  human: boolean; // from telemetry (Position vs BotPosition)
  uuid: boolean; // user_id is a UUID (README's human rule)
  m: number; // match index
  fate: Fate;
}

export interface RawMapFile {
  map: MapId;
  config: { scale: number; originX: number; originZ: number; size: number };
  matches: RawMatch[];
  players: RawPlayer[];
  rows: { p: number[]; t: number[]; x: number[]; y: number[]; h: number[]; e: number[] };
}

export interface Index {
  days: string[];
  maps: Record<MapId, { matches: number; rows: number; humans: number; image: string }>;
  stats: Record<string, number>;
}

/** Decoded, render-ready data for one map. Rows are sorted by (match, time). */
export interface MapData {
  map: MapId;
  config: RawMapFile['config'];
  matches: RawMatch[];
  players: RawPlayer[];
  n: number;
  p: Int32Array; // player index per row
  t: Float32Array; // seconds since match start
  x: Float32Array; // minimap px (0..1024)
  y: Float32Array;
  h: Float32Array; // world elevation
  e: Uint8Array; // event code
  /** Row indices per player, in time order. */
  rowsByPlayer: Int32Array[];
}
