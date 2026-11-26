export type PageId = 'operations' | 'inspection' | 'environment' | 'evaluation';

export type Phase = 'prep' | 'between-ends' | 'match' | 'finished' | 'ruined';

export interface VenueSystem {
  id: string;
  venue: string;
  city: string;
  systemName: string;
  coolant: string;
  description: string;
  pipeDefaultC: number;
  pipeMinC: number;
  pipeMaxC: number;
  /** 制冷盘管/接触热阻 m²K/W，越小越强 */
  resistance: number;
  /** 环境控制惯性，秒 */
  climateTauS: number;
  roomDefaultC: number;
  humidityDefaultPct: number;
  humidityTargetPct: number;
  crowdCapacity: number;
  frostThresholdPct: number;
  color: string;
}

export interface LayerRecord {
  id: number;
  thicknessMm: number;
  waterC: number;
  pipeC: number;
  systemId: string;
  neededS: number;
  elapsedS: number;
  completed: boolean;
  frozenThrough: boolean;
}

export interface FloodParams {
  thicknessMm: number;
  waterC: number;
}

export interface BaseScrapeParams {
  cutMm: number;
}

export interface PebbleParams {
  waterC: number;
  tankHeightM: number;
  nozzleMm: number;
  nozzleCount: number;
  walkSpeedMps: number;
  sprayWidthM: number;
  passes: number;
  /** 相对中线的平均偏差，cm；正值偏右 */
  balanceCm: number;
}

export interface PebbleStats {
  applied: boolean;
  batch: number;
  dropletMm: number;
  densityPerM2: number;
  requestedDensityPerM2: number;
  count: number;
  radiusMm: number;
  cutMm: number;
  remainingMm: number;
  contactRadiusMm: number;
  contactFraction: number;
  uniformityPct: number;
  leftDensityPerM2: number;
  rightDensityPerM2: number;
  swathM: number;
  laneCount: number;
  freezeS: number;
  freezeRemainingS: number;
  walkDurationS: number;
  ageEnds: number;
  wornFactor: number;
}

export interface WalkState {
  active: boolean;
  elapsedS: number;
  durationS: number;
  params: PebbleParams;
}

export interface FlatnessMetrics {
  maxLocalDifferenceMm: number;
  p95LocalDifferenceMm: number;
  redAreaPct: number;
  meanMm: number;
  leftMeanMm: number;
  rightMeanMm: number;
  sideHeightDifferenceMm: number;
  unevennessRmsMm: number;
  redCellCount: number;
  cellCount: number;
}

export interface TrialSample {
  t: number;
  x: number;
  z: number;
  speed: number;
}

export interface TrialResult {
  id: number;
  atClockS: number;
  totalS: number;
  leftS: number;
  rightS: number;
  driftCm: number;
  leftDriftCm: number;
  rightDriftCm: number;
  mu: number;
  targetS: number;
  score: number;
  reached: boolean;
  stopZ: number;
  samples: TrialSample[];
  rightSamples: TrialSample[];
  flatness: FlatnessMetrics;
  frost: number;
  message: string;
}

export interface ScoreBreakdown {
  speed: number;
  symmetry: number;
  line: number;
  freeze: number;
  total: number;
}

export interface EndReport {
  end: number;
  clockS: number;
  crowdPct: number;
  roomC: number;
  rhPct: number;
  iceC: number;
  frost: number;
  frostPct: number;
  iceSpeedS: number;
  leftSpeedS: number;
  rightSpeedS: number;
  driftCm: number;
  redAreaPct: number;
  pebbleCount: number;
  scores: ScoreBreakdown;
  verdict: string;
  recommendations: string[];
  ruined: boolean;
}

export interface LogEntry {
  id: number;
  clockS: number;
  level: 'info' | 'good' | 'warn' | 'bad';
  text: string;
}

export interface HistoryPoint {
  clockS: number;
  rh: number;
  frost: number;
  speed: number;
}

export interface GameState {
  venueId: string;
  clockS: number;
  timeScale: number;
  running: boolean;
  phase: Phase;
  currentEnd: number;
  totalEnds: number;

  pipeC: number;
  roomSetC: number;
  dehumidifier: number;
  crowdPct: number;

  roomC: number;
  rhPct: number;
  iceC: number;
  dewPointC: number;
  frost: number;
  frostThresholdPct: number;

  flood: FloodParams;
  baseScrape: BaseScrapeParams;
  pebbleInput: PebbleParams;

  layers: LayerRecord[];
  nextLayerId: number;
  height: Float32Array;
  risk: Float32Array;
  heightNx: number;
  heightNz: number;
  flatness: FlatnessMetrics;
  baseScrapePasses: number;

  walk: WalkState | null;
  pebble: PebbleStats;
  pebbleData: Float32Array | null;

  lastTrial: TrialResult | null;
  trialAnim: { active: boolean; startRealMs: number; durationMs: number; resultId: number } | null;

  reports: EndReport[];
  logs: LogEntry[];
  nextLogId: number;
  history: HistoryPoint[];

  ruined: boolean;
  ruinReason: string;
  certification: { ready: boolean; reasons: string[] };
  fps: number;
  pebbleDrawCount: number;
}
