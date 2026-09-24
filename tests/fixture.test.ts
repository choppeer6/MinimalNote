import { describe, expect, it } from 'vitest';
import { makeNote, makeTodo, setDone } from '../core/item';
import { summarize } from '../core/stats';
import type { Item, Prio, Tag } from '../core/types';

/**
 * 复刻原型里的七条演示数据(prototype/index.html 的 items 数组),
 * 用真实统计口径算一遍,核对量级是否讲得通。
 */
const ANCHOR = '2026-09-24T12:00:00+08:00';

interface Seed {
  id: number;
  kind: 'todo' | 'note';
  title: string;
  tag: Tag;
  prio: Prio | null;
  due: string | null;
  done: boolean;
  /** 完成日,如 '22' */
  doneDay?: string;
}

const SEEDS: Seed[] = [
  { id: 101, kind: 'todo', title: '完成第三章读书笔记', tag: '学习', prio: 'high', due: '2026-09-24T21:00:00+08:00', done: false },
  { id: 102, kind: 'todo', title: '回复产品评审邮件', tag: '工作', prio: 'mid', due: null, done: true, doneDay: '23' },
  { id: 103, kind: 'todo', title: '背 50 个单词', tag: '学习', prio: 'mid', due: '2026-09-25T21:00:00+08:00', done: false },
  { id: 104, kind: 'todo', title: '买牛奶和鸡蛋', tag: '生活', prio: 'low', due: null, done: false },
  { id: 105, kind: 'todo', title: '整理上周会议纪要', tag: '工作', prio: 'low', due: null, done: true, doneDay: '22' },
  { id: 106, kind: 'note', title: '灵感:统计页可以做成习惯日历', tag: '学习', prio: null, due: null, done: false },
  { id: 107, kind: 'note', title: '同事推荐的《深度工作》,周末去借', tag: '生活', prio: null, due: null, done: false },
];

function build(seeds: Seed[]): Item[] {
  return seeds.map((s) => {
    const base = {
      id: s.id, title: s.title, tag: s.tag,
      createdAt: '2026-09-24T09:41:00+08:00',
    };
    if (s.kind === 'note') {
      return makeNote(base);
    }
    const todo = makeTodo({ ...base, prio: s.prio, due: s.due });
    return s.done ? setDone(todo, true, `2026-09-${s.doneDay}T19:00:00+08:00`) : todo;
  });
}

describe('原型演示数据', () => {
  const s = summarize(build(SEEDS), ANCHOR);

  it('本周完成 2 件(102、105)', () => {
    expect(s.weekDone).toBe(2);
  });

  it('本周计划 2 件(101、103 的 due 落在本周)', () => {
    // 104 无 due,102 / 105 虽已完成但无 due —— 都不进分母
    expect(s.weekPlanned).toBe(2);
  });

  it('完成度为 2/2 = 1', () => {
    expect(s.weekRatio).toBe(1);
  });

  it('两条随手记一件都没进统计', () => {
    expect(s.weekDone).toBe(2);
  });

  it('每日柱状图:22 日 1 件、23 日 1 件,其余为 0', () => {
    const by = Object.fromEntries(s.daily.map((x) => [x.dateKey, x.count]));
    expect(by['2026-09-22']).toBe(1);
    expect(by['2026-09-23']).toBe(1);
    expect(by['2026-09-21']).toBe(0);
    expect(by['2026-09-24']).toBe(0);
  });

  it('标签分布:学习 0、工作 2、生活 0', () => {
    const by = Object.fromEntries(s.byTag.map((x) => [x.tag, x.count]));
    expect(by['学习']).toBe(0);
    expect(by['工作']).toBe(2);
    expect(by['生活']).toBe(0);
  });

  it('连续打卡:22、23 连着做了,24 日尚未完成 → 2', () => {
    expect(s.streak).toBe(2);
  });
});
