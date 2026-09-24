import { describe, expect, it } from 'vitest';
import {
  isCounted,
  makeNote,
  makeTodo,
  normalizeItem,
  promoteToTodo,
  setDone,
} from '../core/item';
import type { Item } from '../core/types';

const T = '2026-09-24T09:00:00+08:00';

describe('makeTodo', () => {
  it('建出的待办字段齐备', () => {
    const it0 = makeTodo({ id: 1, title: '背 50 个单词', tag: '学习', createdAt: T });
    expect(it0.kind).toBe('todo');
    expect(it0.done).toBe(false);
    expect(it0.doneAt).toBeNull();
    expect(it0.prio).toBeNull();
    expect(it0.due).toBeNull();
    expect(it0.imageUris).toEqual([]);
  });

  it('可带优先级与截止时间', () => {
    const it0 = makeTodo({
      id: 1, title: '交周报', tag: '工作', createdAt: T,
      prio: 'high', due: '2026-09-25T18:00:00+08:00',
    });
    expect(it0.prio).toBe('high');
    expect(it0.due).toBe('2026-09-25T18:00:00+08:00');
  });

  it('非法标题被拒绝', () => {
    expect(() => makeTodo({ id: 1, title: '   ', tag: '学习', createdAt: T }))
      .toThrow(/标题不能为空/);
  });
});

describe('makeNote', () => {
  it('随手记的待办字段恒为空', () => {
    const n = makeNote({ id: 2, title: '同事推荐的那本书', tag: '生活', createdAt: T });
    expect(n.kind).toBe('note');
    expect(n.prio).toBeNull();
    expect(n.due).toBeNull();
    expect(n.done).toBe(false);
    expect(n.doneAt).toBeNull();
  });
});

describe('normalizeItem —— 强制不变量', () => {
  it('把 note 上误带的待办字段清空', () => {
    const dirty: Item = {
      id: 3, kind: 'note', title: '记一笔', tag: '学习',
      prio: 'high', due: '2026-09-25T18:00:00+08:00',
      done: true, doneAt: '2026-09-25T19:00:00+08:00',
      createdAt: T, imageUris: [],
    };
    const clean = normalizeItem(dirty);
    expect(clean.prio).toBeNull();
    expect(clean.due).toBeNull();
    expect(clean.done).toBe(false);
    expect(clean.doneAt).toBeNull();
  });

  it('done 为 false 时清空 doneAt', () => {
    const dirty: Item = {
      id: 4, kind: 'todo', title: '买菜', tag: '生活',
      prio: null, due: null, done: false, doneAt: '2026-09-25T19:00:00+08:00',
      createdAt: T, imageUris: [],
    };
    expect(normalizeItem(dirty).doneAt).toBeNull();
  });

  it('todo 已勾选却缺 doneAt 时报错,而不是编造一个时间', () => {
    // 编造 doneAt 会把完成记录归到错误的日子,污染统计。宁可炸出来。
    const broken: Item = {
      id: 5, kind: 'todo', title: '写周报', tag: '工作',
      prio: null, due: null, done: true, doneAt: null,
      createdAt: T, imageUris: [],
    };
    expect(() => normalizeItem(broken)).toThrow(/必须有 doneAt/);
  });
});

describe('setDone', () => {
  it('勾选时写入完成时刻', () => {
    const t = makeTodo({ id: 6, title: '买菜', tag: '生活', createdAt: T });
    const done = setDone(t, true, '2026-09-24T20:00:00+08:00');
    expect(done.done).toBe(true);
    expect(done.doneAt).toBe('2026-09-24T20:00:00+08:00');
  });

  it('取消勾选时清空完成时刻', () => {
    const t = makeTodo({ id: 6, title: '买菜', tag: '生活', createdAt: T });
    const undone = setDone(setDone(t, true, '2026-09-24T20:00:00+08:00'), false, '2026-09-24T21:00:00+08:00');
    expect(undone.done).toBe(false);
    expect(undone.doneAt).toBeNull();
  });

  it('对随手记勾选无效 —— 随手记没有完成态', () => {
    const n = makeNote({ id: 7, title: '一个想法', tag: '学习', createdAt: T });
    expect(() => setDone(n, true, '2026-09-24T20:00:00+08:00'))
      .toThrow(/随手记不能勾选/);
  });

  it('不修改原对象', () => {
    const t = makeTodo({ id: 8, title: '买菜', tag: '生活', createdAt: T });
    setDone(t, true, '2026-09-24T20:00:00+08:00');
    expect(t.done).toBe(false);
  });
});

describe('promoteToTodo —— 随手记升格为待办', () => {
  it('升格后带上待办字段', () => {
    const n = makeNote({ id: 9, title: '有空查一下那个库', tag: '工作', createdAt: T });
    const t = promoteToTodo(n, { prio: 'mid', due: '2026-09-26T18:00:00+08:00' });
    expect(t.kind).toBe('todo');
    expect(t.prio).toBe('mid');
    expect(t.due).toBe('2026-09-26T18:00:00+08:00');
    expect(t.done).toBe(false);
    expect(t.doneAt).toBeNull();
    expect(t.id).toBe(9);
    expect(t.title).toBe('有空查一下那个库');
  });

  it('对已是待办的条目升格会报错 —— 反向降格不提供', () => {
    const t = makeTodo({ id: 10, title: '买菜', tag: '生活', createdAt: T });
    expect(() => promoteToTodo(t, { prio: null, due: null })).toThrow(/已经是待办/);
  });
});

describe('isCounted —— 统计只认已完成待办', () => {
  it('已完成的待办计入', () => {
    const t = setDone(makeTodo({ id: 11, title: 'a', tag: '学习', createdAt: T }), true, T);
    expect(isCounted(t)).toBe(true);
  });

  it('未完成的待办不计入', () => {
    expect(isCounted(makeTodo({ id: 12, title: 'a', tag: '学习', createdAt: T }))).toBe(false);
  });

  it('随手记永不计入,即便被污染成 done', () => {
    const n: Item = {
      id: 13, kind: 'note', title: 'a', tag: '学习',
      prio: null, due: null, done: true, doneAt: T,
      createdAt: T, imageUris: [],
    };
    expect(isCounted(n)).toBe(false);
  });
});
