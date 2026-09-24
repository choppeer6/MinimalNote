/**
 * 日期工具 —— 全部基于 UTC 内部运算,不读本机时区。
 *
 * 核心约定:自然日归属取自 ISO 字符串自带的偏移量。
 * '2026-09-24T00:30:00+08:00' 恒归属 2026-09-24,
 * 无论执行这段代码的机器设在哪个时区。
 */

export interface IsoParts {
  /** 'YYYY-MM-DD' —— 字符串自带偏移量下的墙上时间日期 */
  dateKey: string;
  hour: number;
  minute: number;
}

const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function parseIso(iso: string): IsoParts {
  const m = ISO_RE.exec(iso);
  if (!m) {
    throw new Error(`不是合法的 ISO 8601 带偏移量时间戳: ${iso}`);
  }

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);

  if (hour > 23 || minute > 59) {
    throw new Error(`时刻越界: ${iso}`);
  }

  // 用 UTC 回环校验日期真实存在,拦掉 2026-02-30 这类
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new Error(`日期不存在: ${iso}`);
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  return { dateKey: `${year}-${pad(month)}-${pad(day)}`, hour, minute };
}

/** 时间戳 → 自然日键 'YYYY-MM-DD' */
export function dayKey(iso: string): string {
  return parseIso(iso).dateKey;
}

/** 自然日键 → 星期序号,周一为 0,周日为 6 */
export function weekdayIndexOfKey(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  // Date.UTC 的 getUTCDay():周日为 0 … 周六为 6;平移成周一为 0
  const jsDay = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return (jsDay + 6) % 7;
}

/** 时间戳 → 星期序号,周一为 0,周日为 6 */
export function weekdayIndex(iso: string): number {
  return weekdayIndexOfKey(dayKey(iso));
}

/** 自然日键加减天数,返回新的自然日键 */
export function addDays(dateKey: string, delta: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d!));
  t.setUTCDate(t.getUTCDate() + delta);
  return t.toISOString().slice(0, 10);
}

/** 锚点所在那一周的七个自然日键,周一在前、周日在后 */
export function weekKeys(anchorISO: string): string[] {
  const monday = addDays(dayKey(anchorISO), -weekdayIndex(anchorISO));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** dateKey 的字典序即时间序,可直接比较 */
export function isAfterKey(a: string, b: string): boolean {
  return a > b;
}
