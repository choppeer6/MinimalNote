import { addDays, dayKey, isAfterKey, weekKeys } from './date';
import { isCounted } from './item';
import { TAG_ORDER, type Item, type Tag } from './types';

export interface DayBucket {
  dateKey: string;
  count: number;
  /** 锚点日之后的日期 —— 界面据此不画柱子 */
  isFuture: boolean;
}

export interface TagSlice {
  tag: Tag;
  count: number;
  /** 占本周完成数的比例;无完成记录时为 0 */
  ratio: number;
}

export interface StatsSummary {
  /** 本周完成的待办件数 */
  weekDone: number;
  /** 本周计划数 —— 口径为 due 落在本周的待办件数,不论完成与否 */
  weekPlanned: number;
  /**
   * 本周完成度,weekDone / weekPlanned,封顶为 1。
   * 本周无计划时为 null —— 界面应显示「—」而不是 0%。
   */
  weekRatio: number | null;
  daily: DayBucket[];
  byTag: TagSlice[];
  streak: number;
}

/**
 * 汇总统计。anchorISO 由调用方注入(通常是「现在」),便于测试。
 *
 * 口径见设计文档第 7 节,以及本计划开头对 U4 / U5 的决断。
 */
export function summarize(items: Item[], anchorISO: string): StatsSummary {
  const keys = weekKeys(anchorISO);
  const keySet = new Set(keys);
  const anchorKey = dayKey(anchorISO);

  const counted = items.filter(isCounted);
  const countedInWeek = counted.filter((it) => keySet.has(dayKey(it.doneAt as string)));

  const daily: DayBucket[] = keys.map((k) => ({
    dateKey: k,
    count: 0,
    isFuture: isAfterKey(k, anchorKey),
  }));
  const bucketOf = new Map(daily.map((b) => [b.dateKey, b]));
  for (const it of countedInWeek) {
    const b = bucketOf.get(dayKey(it.doneAt as string));
    if (b) {
      b.count += 1;
    }
  }

  const weekDone = countedInWeek.length;

  const weekPlanned = items.filter(
    (it) => it.kind === 'todo' && it.due !== null && keySet.has(dayKey(it.due)),
  ).length;

  const byTag: TagSlice[] = TAG_ORDER.map((tag) => {
    const count = countedInWeek.filter((it) => it.tag === tag).length;
    return { tag, count, ratio: weekDone === 0 ? 0 : count / weekDone };
  });

  return {
    weekDone,
    weekPlanned,
    weekRatio: weekPlanned === 0 ? null : Math.min(weekDone / weekPlanned, 1),
    daily,
    byTag,
    streak: streakOf(items, anchorISO),
  };
}

/**
 * 连续打卡天数 —— 当天至少完成 1 件待办即算打卡。
 *
 * 当天尚未完成不算断:一天还没过完就判用户断更是不合理的,
 * 因此锚点日无记录时从昨天起算。
 */
export function streakOf(items: Item[], anchorISO: string): number {
  const doneDays = new Set(
    items.filter(isCounted).map((it) => dayKey(it.doneAt as string)),
  );

  const anchorKey = dayKey(anchorISO);
  let cursor = doneDays.has(anchorKey) ? anchorKey : addDays(anchorKey, -1);

  let n = 0;
  while (doneDays.has(cursor)) {
    n += 1;
    cursor = addDays(cursor, -1);
  }
  return n;
}
