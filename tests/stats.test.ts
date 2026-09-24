import { describe, expect, it } from 'vitest';
import { makeNote, makeTodo, setDone } from '../core/item';
import { summarize } from '../core/stats';
import type { Item, Tag } from '../core/types';

/** 本周锚点:2026-09-24(周四);本周为 09-21(一) → 09-27(日) */
const ANCHOR = '2026-09-24T12:00:00+08:00';

const d = (day: string, hh = 20) => `2026-09-${day}T${String(hh).padStart(2, '0')}:00:00+08:00`;

/** 造一个已完成待办 */
function doneTodo(id: number, day: string, tag: Tag = '学习'): Item {
  return setDone(
    makeTodo({ id, title: `t${id}`, tag, createdAt: d('20', 9) }),
    true,
    d(day),
  );
}

/** 造一个未完成待办,可带 due */
function openTodo(id: number, due: string | null = null): Item {
  return makeTodo({ id, title: `t${id}`, tag: '学习', createdAt: d('20', 9), due });
}

describe('summarize —— 空数据', () => {
  it('没有数据时不报错,比率返回 null 而不是 0 或 NaN', () => {
    const s = summarize([], ANCHOR);
    expect(s.weekDone).toBe(0);
    expect(s.weekPlanned).toBe(0);
    // 关键:本周没有计划时不能显示 0% —— 那是「一件没做」的误导,
    // 实际是「本周没有要做的」。用 null 让界面显示「—」
    expect(s.weekRatio).toBeNull();
    expect(s.streak).toBe(0);
  });

  it('七天桶恒为 7 项,周一在前', () => {
    expect(summarize([], ANCHOR).daily.map((x) => x.dateKey)).toEqual([
      '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24',
      '2026-09-25', '2026-09-26', '2026-09-27',
    ]);
  });

  it('标签分布恒为三项,顺序固定', () => {
    expect(summarize([], ANCHOR).byTag.map((x) => x.tag)).toEqual(['学习', '工作', '生活']);
  });
});

describe('daily —— 每日完成柱状图', () => {
  it('按 doneAt 归属到自然日', () => {
    const s = summarize([doneTodo(1, '22'), doneTodo(2, '22'), doneTodo(3, '24')], ANCHOR);
    const byKey = Object.fromEntries(s.daily.map((x) => [x.dateKey, x.count]));
    expect(byKey['2026-09-22']).toBe(2);
    expect(byKey['2026-09-24']).toBe(1);
    expect(byKey['2026-09-23']).toBe(0);
  });

  it('凌晨完成仍归属当天,不回退', () => {
    const item = setDone(
      makeTodo({ id: 4, title: 'x', tag: '学习', createdAt: d('20', 9) }),
      true,
      '2026-09-23T00:30:00+08:00',
    );
    const s = summarize([item], ANCHOR);
    expect(s.daily.find((x) => x.dateKey === '2026-09-23')?.count).toBe(1);
    expect(s.daily.find((x) => x.dateKey === '2026-09-22')?.count).toBe(0);
  });

  it('上周完成的不进本周桶,也不进 weekDone', () => {
    const s = summarize([doneTodo(5, '20')], ANCHOR);
    expect(s.weekDone).toBe(0);
    expect(s.daily.every((x) => x.count === 0)).toBe(true);
  });

  it('未来日期被标记为 isFuture', () => {
    const s = summarize([], ANCHOR);
    expect(s.daily.find((x) => x.dateKey === '2026-09-24')?.isFuture).toBe(false);
    expect(s.daily.find((x) => x.dateKey === '2026-09-25')?.isFuture).toBe(true);
    expect(s.daily.find((x) => x.dateKey === '2026-09-27')?.isFuture).toBe(true);
  });
});

describe('weekPlanned —— 口径为 due 落点,不是 createdAt', () => {
  it('due 落在本周的未完成待办计入计划数', () => {
    const s = summarize([openTodo(1, d('25'))], ANCHOR);
    expect(s.weekPlanned).toBe(1);
    expect(s.weekDone).toBe(0);
    expect(s.weekRatio).toBe(0);
  });

  it('没有 due 的待办不计入计划数', () => {
    // 本周创建的、无 due 的待办 —— 按 createdAt 口径会被算进来,按 due 口径不会
    expect(summarize([openTodo(1, null)], ANCHOR).weekPlanned).toBe(0);
  });

  it('due 落在外面的待办不计入', () => {
    expect(summarize([openTodo(1, '2026-10-05T18:00:00+08:00')], ANCHOR).weekPlanned).toBe(0);
  });

  it('本周创建但 due 在下周的待办不计入', () => {
    const t = makeTodo({
      id: 1, title: 'x', tag: '学习', createdAt: d('24', 9),
      due: '2026-09-30T18:00:00+08:00',
    });
    expect(summarize([t], ANCHOR).weekPlanned).toBe(0);
  });
});

describe('weekRatio —— 完成度', () => {
  it('完成 2 项、计划 4 项 → 0.5', () => {
    // 四条的 due 都落在本周,其中两条已完成 —— 分母才真的等于 4
    const items = [
      setDone(makeTodo({ id: 1, title: 't1', tag: '学习', createdAt: d('20', 9), due: d('22') }), true, d('22')),
      setDone(makeTodo({ id: 2, title: 't2', tag: '学习', createdAt: d('20', 9), due: d('23') }), true, d('23')),
      openTodo(3, d('25')), openTodo(4, d('26')),
    ];
    expect(summarize(items, ANCHOR).weekRatio).toBe(0.5);
  });

  it('完成了计划外的条目,比率封顶为 1,但原始计数如实反映', () => {
    // 计划 1 项,却完成了 3 项(其中两项没有 due)。比率不该显示 300%
    const items = [
      openTodo(1, d('25')),
      doneTodo(2, '22'), doneTodo(3, '23'), doneTodo(4, '24'),
    ];
    const s = summarize(items, ANCHOR);
    expect(s.weekDone).toBe(3);
    expect(s.weekPlanned).toBe(1);
    expect(s.weekRatio).toBe(1);
  });

  it('计划项全部完成 → 1', () => {
    const items = [
      setDone(makeTodo({ id: 1, title: 't1', tag: '学习', createdAt: d('20', 9), due: d('22') }), true, d('22')),
      setDone(makeTodo({ id: 2, title: 't2', tag: '学习', createdAt: d('20', 9), due: d('23') }), true, d('23')),
    ];
    expect(summarize(items, ANCHOR).weekRatio).toBe(1);
  });
});

describe('byTag —— 标签分布', () => {
  it('按本周完成件数计比例', () => {
    const items = [
      doneTodo(1, '22', '学习'), doneTodo(2, '23', '学习'),
      doneTodo(3, '24', '工作'), doneTodo(4, '24', '生活'),
    ];
    const s = summarize(items, ANCHOR);
    const by = Object.fromEntries(s.byTag.map((x) => [x.tag, x]));
    expect(by['学习']!.count).toBe(2);
    expect(by['学习']!.ratio).toBe(0.5);
    expect(by['工作']!.count).toBe(1);
    expect(by['工作']!.ratio).toBe(0.25);
    expect(by['生活']!.ratio).toBe(0.25);
  });

  it('上周完成的不计入本周标签分布', () => {
    const s = summarize([doneTodo(1, '20', '学习')], ANCHOR);
    expect(s.byTag.every((x) => x.count === 0)).toBe(true);
  });

  it('无完成记录时比例全为 0,不产生 NaN', () => {
    const s = summarize([openTodo(1, d('25'))], ANCHOR);
    expect(s.byTag.map((x) => x.ratio)).toEqual([0, 0, 0]);
  });
});

describe('streak —— 连续打卡', () => {
  it('连做三天 → 3', () => {
    const items = [doneTodo(1, '22'), doneTodo(2, '23'), doneTodo(3, '24')];
    expect(summarize(items, ANCHOR).streak).toBe(3);
  });

  it('当天尚未完成不算断 —— 从昨天往回数', () => {
    // 24 日(今天)还没做,但 22、23 连着做了 → 2
    const items = [doneTodo(1, '22'), doneTodo(2, '23')];
    expect(summarize(items, ANCHOR).streak).toBe(2);
  });

  it('中间断一天则中断', () => {
    const items = [doneTodo(1, '21'), doneTodo(2, '22'), doneTodo(3, '24')];
    // 24 有、23 无 → 只数到 1
    expect(summarize(items, ANCHOR).streak).toBe(1);
  });

  it('今天和昨天都没有 → 0', () => {
    expect(summarize([doneTodo(1, '20')], ANCHOR).streak).toBe(0);
  });

  it('一天完成多件只算一次打卡', () => {
    const items = [doneTodo(1, '24'), doneTodo(2, '24'), doneTodo(3, '24')];
    expect(summarize(items, ANCHOR).streak).toBe(1);
  });

  it('跨月连续也能数对', () => {
    const items = [
      setDone(makeTodo({ id: 1, title: 'a', tag: '学习', createdAt: d('20', 9) }), true, '2026-09-29T20:00:00+08:00'),
      setDone(makeTodo({ id: 2, title: 'b', tag: '学习', createdAt: d('20', 9) }), true, '2026-09-30T20:00:00+08:00'),
      setDone(makeTodo({ id: 3, title: 'c', tag: '学习', createdAt: d('20', 9) }), true, '2026-10-01T20:00:00+08:00'),
    ];
    expect(summarize(items, '2026-10-01T12:00:00+08:00').streak).toBe(3);
  });
});

describe('随手记不出现在任何统计里', () => {
  it('被污染成 done 的随手记也不计入', () => {
    const dirty: Item = {
      id: 99, kind: 'note', title: '一个想法', tag: '学习',
      prio: null, due: null, done: true, doneAt: d('24'),
      createdAt: d('20', 9), imageUris: [],
    };
    const s = summarize([dirty], ANCHOR);
    expect(s.weekDone).toBe(0);
    expect(s.byTag.every((x) => x.count === 0)).toBe(true);
    expect(s.streak).toBe(0);
  });

  it('随手记的 due 不污染计划数', () => {
    // makeNote 已把 due 置 null,这里直接构造一个被污染的
    const dirty: Item = {
      id: 98, kind: 'note', title: 'x', tag: '学习',
      prio: null, due: d('25'), done: false, doneAt: null,
      createdAt: d('20', 9), imageUris: [],
    };
    expect(summarize([dirty], ANCHOR).weekPlanned).toBe(0);
  });

  it('makeNote 建出的随手记天然不进统计', () => {
    const n = makeNote({ id: 97, title: '记一笔', tag: '生活', createdAt: d('20', 9) });
    expect(summarize([n], ANCHOR).weekDone).toBe(0);
  });
});
