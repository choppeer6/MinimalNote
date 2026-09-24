import type { Item, Prio, Tag } from './types';

export interface NewItemInput {
  id: number;
  title: string;
  tag: Tag;
  createdAt: string;
  imageUris?: string[];
}

export interface TodoInput extends NewItemInput {
  prio?: Prio | null;
  due?: string | null;
}

function assertTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    throw new Error('标题不能为空');
  }
  return trimmed;
}

export function makeTodo(input: TodoInput): Item {
  return normalizeItem({
    id: input.id,
    kind: 'todo',
    title: assertTitle(input.title),
    tag: input.tag,
    prio: input.prio ?? null,
    due: input.due ?? null,
    done: false,
    doneAt: null,
    createdAt: input.createdAt,
    imageUris: input.imageUris ?? [],
  });
}

export function makeNote(input: NewItemInput): Item {
  return normalizeItem({
    id: input.id,
    kind: 'note',
    title: assertTitle(input.title),
    tag: input.tag,
    prio: null,
    due: null,
    done: false,
    doneAt: null,
    createdAt: input.createdAt,
    imageUris: input.imageUris ?? [],
  });
}

/**
 * 强制 Item 不变量。任何从数据库读出或从界面收回来的 Item 都应先过这里。
 *
 * 注意:当 kind=todo 且 done=true 却没有 doneAt 时,这里选择抛错而不是补一个时间。
 * 补时间会把完成记录归到错误的日子,让统计静默出错;抛错能让问题当场暴露。
 */
export function normalizeItem(raw: Item): Item {
  if (raw.kind === 'note') {
    return { ...raw, prio: null, due: null, done: false, doneAt: null };
  }

  if (!raw.done) {
    return { ...raw, doneAt: null };
  }

  if (raw.doneAt === null) {
    throw new Error(`kind=todo 且 done=true 的条目必须有 doneAt,id=${raw.id}`);
  }

  return { ...raw };
}

/** 勾选 / 取消勾选。nowISO 由调用方注入,便于测试。 */
export function setDone(item: Item, done: boolean, nowISO: string): Item {
  if (item.kind === 'note') {
    throw new Error(`随手记不能勾选,id=${item.id}`);
  }
  return normalizeItem({
    ...item,
    done,
    doneAt: done ? nowISO : null,
  });
}

/** 随手记 → 待办。反向降格不提供。 */
export function promoteToTodo(
  item: Item,
  opts: { prio: Prio | null; due: string | null },
): Item {
  if (item.kind === 'todo') {
    throw new Error(`已经是待办,无需升格,id=${item.id}`);
  }
  return normalizeItem({
    ...item,
    kind: 'todo',
    prio: opts.prio,
    due: opts.due,
    done: false,
    doneAt: null,
  });
}

/** 统计口径的唯一判据:已完成,且是待办 */
export function isCounted(item: Item): boolean {
  return item.kind === 'todo' && item.done;
}
