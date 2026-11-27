/**
 * 赛事评价:每个节点双向各发一只试滑壶,按
 * 冰速稳定性、左右对称、走线正常、结霜控制四个维度打分。
 */
import { SCORE, STONE } from './constants';
import type { EndScore, Grade, TestStoneResult } from './types';

function gradeOf(total: number): Grade {
  if (total >= 92) return 'S';
  if (total >= 82) return 'A';
  if (total >= 68) return 'B';
  if (total >= 50) return 'C';
  return 'D';
}

function bellScore(err: number, tol: number): number {
  return Math.max(0, 100 * Math.exp(-Math.pow(err / tol, 2)));
}

export function scoreEnd(
  end: number,
  simS: number,
  stoneA: TestStoneResult,
  stoneB: TestStoneResult,
  frostMm: number
): EndScore {
  const notes: string[] = [];
  const timeA = stoneA.hogTimeS;
  const timeB = stoneB.hogTimeS;

  // 1) 冰速稳定性:双向平均用时偏离目标
  const times = [timeA, timeB].filter((v): v is number => v !== null);
  const avgTime = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
  const speedScore = times.length === 0 ? 0 : bellScore(Math.abs(avgTime - SCORE.TARGET_HOG_TIME_S), SCORE.SPEED_TOL_S);
  if (times.length < 2) notes.push('有试滑壶没能抵达对面前掷线,冰速过慢');
  else if (Math.abs(avgTime - SCORE.TARGET_HOG_TIME_S) > 3) notes.push(`冰速偏离目标:实测 ${avgTime.toFixed(1)}s / 目标 ${SCORE.TARGET_HOG_TIME_S}s`);

  // 2) 左右(双向)一致性:两只壶用时差 + 漂移差
  const timeSplit = timeA !== null && timeB !== null ? Math.abs(timeA - timeB) : 99;
  const driftSplit = Math.abs(stoneA.lateralDriftM - stoneB.lateralDriftM);
  const symmetryScore = Math.max(0, bellScore(timeSplit, 1.0) * 0.6 + bellScore(driftSplit, 0.4) * 0.4);
  if (timeSplit > 1.5) notes.push(`双向冰速不一致:相差 ${timeSplit.toFixed(2)}s`);

  // 3) 走线:横向漂移是否在容差内
  const drift = Math.max(Math.abs(stoneA.lateralDriftM), Math.abs(stoneB.lateralDriftM));
  const pathScore = bellScore(drift, STONE.PATH_TOL_M);
  if (drift > STONE.PATH_TOL_M) notes.push(`壶走线跑偏,最大横向偏差 ${drift.toFixed(2)}m`);

  // 4) 结霜控制
  const frostScore = bellScore(frostMm, 0.12);
  if (frostMm > 0.15) notes.push(`冰面结霜 ${frostMm.toFixed(2)}mm,冰速被霜层拖慢`);

  const total = Math.round(
    speedScore * SCORE.W_SPEED +
      symmetryScore * SCORE.W_SYMMETRY +
      pathScore * SCORE.W_PATH +
      frostScore * SCORE.W_FROST
  );

  if (notes.length === 0) notes.push('冰速稳定、两侧一致、走线正常,冰面状态优秀');
  return {
    end,
    atSimS: simS,
    speedScore: Math.round(speedScore),
    symmetryScore: Math.round(symmetryScore),
    pathScore: Math.round(pathScore),
    frostScore: Math.round(frostScore),
    total,
    grade: gradeOf(total),
    hogTimeA: timeA ?? -1,
    hogTimeB: timeB ?? -1,
    driftA: stoneA.lateralDriftM,
    driftB: stoneB.lateralDriftM,
    frostMm,
    notes
  };
}

export function aggregateGrade(scores: EndScore[]): { total: number; grade: Grade } {
  if (scores.length === 0) return { total: 0, grade: 'D' };
  const total = Math.round(scores.reduce((a, s) => a + s.total, 0) / scores.length);
  return { total, grade: gradeOf(total) };
}
