// 赛事方评分:冰速稳定性、左右对称性、走线正常度
import { HOG_Z, SHEET_W, ZONES_ALONG, ZONES_SIDE } from './constants';
import type { EndScore, ThrowResult, ZoneStat } from './types';
import { clamp } from './rng';

function grade(total: number): string {
  if (total >= 95) return 'S · 大师级冰面';
  if (total >= 88) return 'A · 赛事级';
  if (total >= 78) return 'B · 合格';
  if (total >= 65) return 'C · 勉强可用';
  return 'D · 教练组要找你谈话';
}

export function scoreEnd(
  end: number,
  zones: ZoneStat[],
  throws: ThrowResult[],
  penalties: string[],
): EndScore {
  const notes: string[] = [];

  // ---- 1. 冰速稳定性:沿赛道 8 段 hog 秒数的离散度 ----
  const alongMean = Array.from({ length: ZONES_ALONG }, (_, a) => {
    const zs = zones.filter((z) => z.along === a);
    return zs.reduce((s, z) => s + z.hogSeconds, 0) / zs.length;
  });
  const meanT = alongMean.reduce((s, v) => s + v, 0) / alongMean.length;
  const spread = Math.max(...alongMean) - Math.min(...alongMean);
  const stability = clamp(100 - spread * 38 - Math.abs(meanT - 14.5) * 3.2, 0, 100);
  if (spread > 0.7) notes.push(`冰速前后波动 ${spread.toFixed(2)}s,运动员手感会乱`);
  if (Math.abs(meanT - 14.5) > 1.0) notes.push(`平均冰速 ${meanT.toFixed(2)}s,偏离 14.5s 赛事标准`);

  // ---- 2. 左右对称:左/右条带同段冰速差 ----
  let symErr = 0;
  for (let a = 0; a < ZONES_ALONG; a++) {
    const left = zones[a * ZONES_SIDE];
    const right = zones[a * ZONES_SIDE + 2];
    symErr += Math.abs(left.hogSeconds - right.hogSeconds);
  }
  symErr /= ZONES_ALONG;
  const symmetry = clamp(100 - symErr * 130, 0, 100);
  if (symErr > 0.25) notes.push(`左右冰速差 ${symErr.toFixed(2)}s,两侧壶路不一样`);

  // ---- 3. 走线正常度:试滑壶横移 + 废冰罚分 ----
  let path = 100;
  const valid = throws.filter((t) => t.hogSeconds < 40);
  if (valid.length) {
    const lat = valid.reduce((s, t) => s + Math.abs(t.lateralAtHogM), 0) / valid.length;
    const cw = valid.find((t) => t.spin === 'cw');
    const ccw = valid.find((t) => t.spin === 'ccw');
    if (cw && ccw) {
      const asymmetry = Math.abs(Math.abs(cw.lateralAtHogM) - Math.abs(ccw.lateralAtHogM));
      path -= asymmetry * 120;
    }
    path -= clamp((lat - 0.55) * 70, 0, 55); // 正常 curl 横移约 0.6~1.1m
    path = clamp(path, 0, 100);
    if (lat > 1.6) notes.push('壶走线明显跑偏,冰面有坡度或卵石不均');  }
  if (!valid.length) {
    path = 0;
    notes.push('没有完成任何一次有效试滑');
  }

  const penalty = penalties.length * 12;
  const total = clamp(
    Math.round(stability * 0.4 + symmetry * 0.3 + path * 0.3 - penalty), 0, 100,
  );
  if (penalties.length) notes.push(...penalties);
  if (!notes.length) notes.push('冰速均匀、两侧一致、走线干净,无可挑剔');

  return {
    end,
    stability: Math.round(stability),
    symmetry: Math.round(symmetry),
    path: Math.round(path),
    penalty,
    total,
    grade: grade(total),
    notes,
  };
}

/** 供 UI 显示的全局统计 */
export function globalStats(zones: ZoneStat[]) {
  const hog = zones.map((z) => z.hogSeconds);
  const dens = zones.map((z) => z.density);
  return {
    hogMin: Math.min(...hog),
    hogMax: Math.max(...hog),
    hogMean: hog.reduce((s, v) => s + v, 0) / hog.length,
    densityMean: dens.reduce((s, v) => s + v, 0) / dens.length,
    frostMean: zones.reduce((s, z) => s + z.frost, 0) / zones.length,
    wearMean: zones.reduce((s, z) => s + z.wear, 0) / zones.length,
  };
}

export function zoneAt(x: number, z: number): number {
  const side = clamp(Math.floor((x + SHEET_W / 2) / (SHEET_W / 3)), 0, 2);
  const along = clamp(Math.floor((z + HOG_Z * 2 + 1) / ((HOG_Z * 2 + 2) / ZONES_ALONG)),
    0, ZONES_ALONG - 1);
  return along * ZONES_SIDE + side;
}
