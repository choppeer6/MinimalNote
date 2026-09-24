# 极简小记 M1 · 数据层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为「极简小记」建立经过测试的数据层 —— 纯 TypeScript 领域核心(条目模型、日期归属、统计口径)+ 鸿蒙侧的 RDB 存储适配层。

**Architecture:** 领域逻辑与平台解耦。`core/` 是零依赖的纯 TypeScript,只做数据变换,不碰任何鸿蒙 API,因此可以在 Node 上用 vitest 跑真实测试。`entry/` 侧的 ArkTS 代码只做两件事:把 `core/` 的类型映射成 RDB 表,以及把 RDB 的行读出来喂给 `core/`。这样统计口径这类最容易出错的逻辑可以在没有鸿蒙工具链的机器上被钉死,而不是等到统计页做出来才发现数字对不上。

**Tech Stack:** TypeScript（纯逻辑层，Node 22 + vitest 验证）、ArkTS / `@kit.ArkData` 的 `relationalStore`（存储层，需 DevEco Studio 验证）

---

## 背景与前置约束

本计划假定以下事实,它们来自 `docs/superpowers/specs/2026-09-24-minimalnote-design.md`:

- **D2 统一条目模型**:单一 `Item` 实体,用 `kind` 区分 `todo` / `note`
- **D4 本地存储**:数据全部留在本机,不上云
- **A 部分可在任何有 Node 的机器上完成并验证**(当前开发机即满足)
- **B 部分需要 DevEco Studio**,当前开发机尚未安装 —— 见 `2026-09-24-harmonyos-toolchain-setup.md`

### 本计划中替设计文档定死的三个未决问题

设计文档留了 U1–U7 七个未决问题,其中三个必须在数据层落地前定死,否则统计页的数字无从解释:

| 编号 | 原问题 | 本计划的决断 | 理由 |
|---|---|---|---|
| **U4** | 「本周计划数」按 `due` 落点还是按 `createdAt`? | **按 `due` 落点**。`weekPlanned` = `due` 落在本周的 `todo` 条数,不论完成与否 | `due` 是「我打算什么时候做」的显式承诺。按 `createdAt` 会把积压已久的老待办算进本周计划,分母虚高、完成度虚低。没有 `due` 的待办不承诺时间,不该进分母 |
| **U5** | 统计页「日均专注时长」从哪来? | **砍掉该指标**。`StatsSummary` 不提供任何时长字段 | 当前数据模型没有任何可推导专注时长的字段。设计文档第 9 节已警告这是唯一凭空捏造的指标 —— 要么补采集机制,要么砍。补采集需要新增 `startedAt` 与前台计时,M1 范围内不做 |
| **U1** | 目标 API 版本? | **本计划对 API 版本不敏感** —— `core/` 是纯 TS,零鸿蒙依赖;B 部分的表结构在 API 9–12 之间无差异。真正受 U1 影响的是 UI 与服务卡片(M2 / M5),不影响 M1 | — |

> U2(卡片↔App 同步)与 M1 无关,留到 M5 前定。U3(重复规则)、U6(语音)、U7(提醒存活)属 M4/M6。

### 一条贯穿全局的时间处理约定

**日期归属一律取自 ISO 8601 字符串自带的偏移量,不做本机时区换算。**

`'2026-09-24T00:30:00+08:00'` 归属 `2026-09-24` —— 无论跑这段代码的机器在 UTC+8、UTC 还是 UTC-5。若用 `new Date(iso)` 再读 `getDate()`,同一份数据在不同时区的机器上会落到不同的自然日,统计结果不可复现。这是数据层最容易被忽略、也最难事后排查的一类 bug,因此本计划用测试把它钉死(Task 2)。

---

## File Structure

```
MinimalNote/
├── package.json                      # 仅开发期依赖(vitest / typescript),不进 App
├── tsconfig.json
├── vitest.config.ts
├── core/                             # 纯领域逻辑,零鸿蒙依赖,Node 可跑
│   ├── types.ts                      # Tag / Prio / Kind / Item
│   ├── date.ts                       # ISO 解析、自然日归属、周切分
│   ├── item.ts                       # 构造、不变量、升格、勾选
│   └── stats.ts                      # 周统计口径、连续打卡
├── tests/
│   ├── date.test.ts
│   ├── item.test.ts
│   └── stats.test.ts
└── entry/src/main/ets/data/          # ArkTS 存储层,需 DevEco 验证
    ├── schema.ets                    # 建表 SQL 与列名
    └── ItemDao.ets                   # RDB 增删改查
```

**为什么 `core/` 与 `entry/` 分开而不是合成 ArkTS 一个文件:** 鸿蒙的 `.ets` 文件无法用 Node 直接执行,任何写进 `.ets` 的逻辑都只能在装了 DevEco 的机器上验证。把纯逻辑留在 `.ts` 里,统计口径和日期归属这类高风险代码就始终有测试护着;`.ets` 侧只剩「读写数据库、搬运字段」这种薄到几乎不会出错的代码。

---

# A 部分 · 纯逻辑层(今天可完成并验证)

## Task 0: 初始化 TypeScript + vitest 环境

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `tests/smoke.test.ts`

- [ ] **Step 1: 确认 Node 可用**

Run: `node -v`
Expected: `v22.x.x`(本机实测为 `v22.19.0`,Node 18+ 均可)

- [ ] **Step 2: 写 `package.json`**

```json
{
  "name": "minimalnote-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "极简小记 · 数据层纯逻辑核心(不参与 App 打包)",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

> `private: true` 是刻意的:这个 `package.json` 只为跑测试存在,鸿蒙工程不依赖它。

- [ ] **Step 3: 写 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["core/**/*.ts", "tests/**/*.ts"]
}
```

> `noUncheckedIndexedAccess` 与 `exactOptionalPropertyTypes` 会让 `Item` 的可空字段处理更啰嗦,但也正是它能在编译期拦住「`doneAt` 可能是 `null` 却被当成 `string` 用」这类统计 bug。值得。

- [ ] **Step 4: 写 `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 5: 写冒烟测试 `tests/smoke.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

describe('测试环境', () => {
  it('能跑起来', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: 装依赖**

Run: `npm install -D typescript vitest @types/node`
Expected: 命令成功,生成 `node_modules/` 与 `package-lock.json`,无 `ERESOLVE` 报错

- [ ] **Step 7: 跑测试,确认环境通了**

Run: `npm test`
Expected: PASS,输出包含 `tests/smoke.test.ts (1 test)` 与 `1 passed`

- [ ] **Step 8: 类型检查**

Run: `npm run typecheck`
Expected: 无输出(退出码 0)。若报找不到 `node` 类型,说明 Step 6 没装全

- [ ] **Step 9: 提交**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts tests/smoke.test.ts
git commit -m "chore: 初始化数据层测试环境(typescript + vitest)" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 1: 定义 `Item` 类型

**Files:**
- Create: `core/types.ts`
- Test: 由 `npm run typecheck` 覆盖(纯类型文件,无运行时行为,不写单测)

- [ ] **Step 1: 写 `core/types.ts`**

```ts
/** 彩色标签的三档取值 —— 与设计文档 D5 的颜料色板一一对应 */
export type Tag = '学习' | '工作' | '生活';

/** 优先级三档 */
export type Prio = 'high' | 'mid' | 'low';

/** 条目形态:待办参与统计,随手记不参与 */
export type Kind = 'todo' | 'note';

/**
 * 统一条目模型 —— D2 的落地形式。
 *
 * 不变量(由 core/item.ts 的 normalizeItem 强制):
 *   kind === 'note'  →  prio / due / doneAt 恒为 null,done 恒为 false
 *   kind === 'todo'  →  done === true 时 doneAt 必须非 null
 *
 * 日期字段一律为 ISO 8601 带偏移量的时间戳,例:'2026-09-24T21:00:00+08:00'
 */
export interface Item {
  /** 自增主键 */
  id: number;
  kind: Kind;
  /** 正文 —— 语音转写结果最终也落到这里 */
  title: string;
  tag: Tag;
  /** 仅 todo 有值 */
  prio: Prio | null;
  /** 仅 todo 有值;null = 不提醒 */
  due: string | null;
  /** 仅 todo 有意义 */
  done: boolean;
  /** 仅 todo 有值,用于统计归属日 */
  doneAt: string | null;
  createdAt: string;
  /** 图片附件,可为空 */
  imageUris: string[];
}

/** 标签的固定展示顺序 —— 统计页标签分布按此排序,不随数据变化而抖动 */
export const TAG_ORDER: readonly Tag[] = ['学习', '工作', '生活'] as const;
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: 无输出(退出码 0)

- [ ] **Step 3: 提交**

```bash
git add core/types.ts
git commit -m "feat(core): 定义 Item 统一条目模型与标签顺序" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 2: ISO 8601 解析与自然日归属

**这是整个数据层最容易出错的模块。** 目标是把「时间戳 → 自然日」这个映射做成**不依赖本机时区**的纯函数。

**Files:**
- Create: `core/date.ts`
- Test: `tests/date.test.ts`

- [ ] **Step 1: 写失败的测试 `tests/date.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { addDays, dayKey, parseIso, weekKeys, weekdayIndex } from '../core/date';

describe('parseIso', () => {
  it('拆出墙上时间的日期与时刻', () => {
    const p = parseIso('2026-09-24T21:05:00+08:00');
    expect(p.dateKey).toBe('2026-09-24');
    expect(p.hour).toBe(21);
    expect(p.minute).toBe(5);
  });

  it('接受 Z 结尾的 UTC 时间戳', () => {
    expect(parseIso('2026-09-24T13:00:00Z').dateKey).toBe('2026-09-24');
  });

  it('接受省略秒的形式', () => {
    expect(parseIso('2026-09-24T13:00Z').dateKey).toBe('2026-09-24');
  });

  it('接受带毫秒的形式', () => {
    expect(parseIso('2026-09-24T13:00:00.123+08:00').dateKey).toBe('2026-09-24');
  });

  it('拒绝缺少时间部分的纯日期', () => {
    expect(() => parseIso('2026-09-24')).toThrow(/不是合法的 ISO 8601/);
  });

  it('拒绝缺少时区偏移量的时间戳', () => {
    expect(() => parseIso('2026-09-24T21:00:00')).toThrow(/不是合法的 ISO 8601/);
  });

  it('拒绝不存在的日期', () => {
    expect(() => parseIso('2026-02-30T10:00:00+08:00')).toThrow(/日期不存在/);
  });

  it('拒绝越界的时刻', () => {
    expect(() => parseIso('2026-09-24T24:00:00+08:00')).toThrow(/时刻越界/);
  });
});

describe('dayKey —— 归属取自字符串自带的偏移量,不做本机时区换算', () => {
  it('凌晨的时刻仍归属当天,不回退到前一天', () => {
    // 这条是本模块存在的理由:若用 new Date(iso).getDate(),
    // 在 UTC 机器上 '2026-09-24T00:30:00+08:00' 会变成 09-23 16:30Z,落到前一天
    expect(dayKey('2026-09-24T00:30:00+08:00')).toBe('2026-09-24');
  });

  it('深夜的时刻仍归属当天,不前进到后一天', () => {
    expect(dayKey('2026-09-24T23:30:00+08:00')).toBe('2026-09-24');
  });

  it('同一物理时刻的不同偏移量写法,各自按自己的墙上时间归属', () => {
    expect(dayKey('2026-09-24T01:00:00+08:00')).toBe('2026-09-24');
    expect(dayKey('2026-09-24T01:00:00-05:00')).toBe('2026-09-24');
    expect(dayKey('2026-09-23T23:00:00-05:00')).toBe('2026-09-23');
  });
});

describe('weekdayIndex —— 周一为 0,周日为 6', () => {
  it('2026-09-24 是周四', () => {
    expect(weekdayIndex('2026-09-24T12:00:00+08:00')).toBe(3);
  });

  it('2026-09-21 是周一', () => {
    expect(weekdayIndex('2026-09-21T12:00:00+08:00')).toBe(0);
  });

  it('2026-09-27 是周日,落在 6 而不是 0', () => {
    expect(weekdayIndex('2026-09-27T12:00:00+08:00')).toBe(6);
  });
});

describe('addDays', () => {
  it('跨月前进', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
  });

  it('跨年前进', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('跨月后退', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('闰年 2 月 29 日存在', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('weekKeys —— 周一开头的七个自然日', () => {
  it('返回包含锚点日的那一周', () => {
    expect(weekKeys('2026-09-24T12:00:00+08:00')).toEqual([
      '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24',
      '2026-09-25', '2026-09-26', '2026-09-27',
    ]);
  });

  it('锚点落在周日时,该周仍从周一起算', () => {
    expect(weekKeys('2026-09-27T12:00:00+08:00')).toEqual([
      '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24',
      '2026-09-25', '2026-09-26', '2026-09-27',
    ]);
  });

  it('锚点落在周一时,该周从当天起算', () => {
    expect(weekKeys('2026-09-21T00:00:00+08:00')[0]).toBe('2026-09-21');
  });
});
```

- [ ] **Step 2: 跑测试,确认失败**

Run: `npx vitest run tests/date.test.ts`
Expected: FAIL —— 报错形如 `Failed to resolve import "../core/date"`,因为文件还不存在

- [ ] **Step 3: 写实现 `core/date.ts`**

```ts
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
```

- [ ] **Step 4: 跑测试,确认通过**

Run: `npx vitest run tests/date.test.ts`
Expected: PASS,`21 passed`

- [ ] **Step 5: 类型检查**

Run: `npm run typecheck`
Expected: 无输出

- [ ] **Step 6: 提交**

```bash
git add core/date.ts tests/date.test.ts
git commit -m "feat(core): ISO 8601 解析与自然日归属,不依赖本机时区" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 3: 条目构造与不变量

**Files:**
- Create: `core/item.ts`
- Test: `tests/item.test.ts`

- [ ] **Step 1: 写失败的测试 `tests/item.test.ts`**

```ts
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
```

- [ ] **Step 2: 跑测试,确认失败**

Run: `npx vitest run tests/item.test.ts`
Expected: FAIL,报 `Failed to resolve import "../core/item"`

- [ ] **Step 3: 写实现 `core/item.ts`**

```ts
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
```

- [ ] **Step 4: 跑测试,确认通过**

Run: `npx vitest run tests/item.test.ts`
Expected: PASS,`16 passed`

- [ ] **Step 5: 类型检查**

Run: `npm run typecheck`
Expected: 无输出

- [ ] **Step 6: 提交**

```bash
git add core/item.ts tests/item.test.ts
git commit -m "feat(core): 条目构造、不变量、勾选与升格" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 4: 周统计口径

**Files:**
- Create: `core/stats.ts`
- Test: `tests/stats.test.ts`

- [ ] **Step 1: 写失败的测试 `tests/stats.test.ts`**

```ts
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
    const items = [
      doneTodo(1, '22'), doneTodo(2, '23'),
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

  it('全部完成 → 1', () => {
    const items = [openTodo(1, d('25')), doneTodo(2, '22')];
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
```

- [ ] **Step 2: 跑测试,确认失败**

Run: `npx vitest run tests/stats.test.ts`
Expected: FAIL,报 `Failed to resolve import "../core/stats"`

- [ ] **Step 3: 写实现 `core/stats.ts`**

```ts
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
```

- [ ] **Step 4: 跑测试,确认通过**

Run: `npx vitest run tests/stats.test.ts`
Expected: PASS,`26 passed`

- [ ] **Step 5: 跑全量测试**

Run: `npm test`
Expected: PASS,`64 passed`(smoke 1 + date 21 + item 16 + stats 26) —— Task 5 再加 7 项,最终 71 项

- [ ] **Step 6: 类型检查**

Run: `npm run typecheck`
Expected: 无输出

- [ ] **Step 7: 提交**

```bash
git add core/stats.ts tests/stats.test.ts
git commit -m "feat(core): 周统计口径与连续打卡,due 落点为计划数分母" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 5: 用真实数据核对原型

原型 `prototype/index.html` 里的统计数字是硬编码的 `WEEK_SEED = [3,5,2,4,6,1,2]`。这一步用 `core/` 算出真数字,核对量级是否合理 —— 如果纯逻辑层算出来的东西和原型的观感差太远,说明口径理解有偏差,此时修正的代价最小。

**Files:**
- Create: `tests/fixture.test.ts`

- [ ] **Step 1: 写测试 `tests/fixture.test.ts`**

```ts
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
```

- [ ] **Step 2: 跑测试**

Run: `npx vitest run tests/fixture.test.ts`
Expected: PASS,`7 passed`

> 若某条失败,先别改测试 —— 先判断是「口径实现错了」还是「我对原型数据的解读错了」。前者改 `core/`,后者改本文件的 `SEEDS`。这一步的价值就在于逼出这个判断。

- [ ] **Step 3: 通读结果并记录偏差**

把上面算出的真实数字和原型截图里的硬编码数字对照,把差异写进设计文档第 11 节(原型中标注为演示占位的部分),说明哪些数字在接入真实数据后会变。

- [ ] **Step 4: 提交**

```bash
git add tests/fixture.test.ts docs/superpowers/specs/2026-09-24-minimalnote-design.md
git commit -m "test(core): 用原型演示数据核对统计口径" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

# B 部分 · 鸿蒙存储层(需 DevEco Studio)

> **前置条件:已完成 `2026-09-24-harmonyos-toolchain-setup.md`,DevEco 诊断全绿。**
> B 部分的命令本机当前跑不了。执行前请确认 `hvigorw` 可用。

## Task 6: 生成鸿蒙工程骨架

**不要手写工程脚手架。** `build-profile.json5`、`module.json5`、`oh-package.json5`、`hvigorfile.ts` 等文件由 DevEco 模板生成,手写极易出错且无谓。用 IDE 生成,再把 `core/` 接进去。

**Files:**
- Create via DevEco: 整个 `entry/` 模块
- Modify: `entry/src/main/ets/` 下新增 `data/` 目录

- [ ] **Step 1: 用 DevEco 创建工程**

DevEco Studio → `Create Project` → `Application` → `Empty Ability` → Next,配置:

| 字段 | 值 |
|---|---|
| Project name | `MinimalNote` |
| Bundle name | `com.choppeer6.minimalnote` |
| Save location | `E:\home\choppeer6\VscodeProgram\MinimalNote`(**必须无中文、无空格**) |
| Compatible SDK | 选 DevEco 提供的最高可用版本(HarmonyOS NEXT / API 12+) |
| Module name | `entry` |
| Device type | Phone |

> Save location 指向已有目录时,IDE 可能提示目录非空。选择在其中创建即可 —— 现有的 `core/`、`docs/`、`prototype/` 不受影响。

- [ ] **Step 2: 确认工程能编译**

Run: `hvigorw assembleHap --mode module -p product=default`
Expected: 构建成功,`entry/build/default/outputs/default/entry-default-unsigned.hap` 生成

> 若提示找不到 `hvigorw`,说明命令行工具未加入 PATH —— 见工具链文档第 6 节。

- [ ] **Step 3: 在模拟器或真机上跑通模板 App**

Run: DevEco 里点 Run(真机需先配签名,见工具链文档第 7 节)
Expected: 设备上出现模板页面,显示 `Hello World`

- [ ] **Step 4: 提交工程骨架**

```bash
git add entry build-profile.json5 oh-package.json5 hvigorfile.ts hvigor/
git commit -m "chore: DevEco 生成的鸿蒙工程骨架" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 7: RDB 建表与 DAO

**Files:**
- Create: `entry/src/main/ets/data/schema.ets`
- Create: `entry/src/main/ets/data/ItemDao.ets`
- Test: `entry/src/ohosTest/ets/test/ItemDao.test.ets`

- [ ] **Step 1: 写建表语句 `entry/src/main/ets/data/schema.ets`**

```ts
/** Item 表结构 —— 与 core/types.ts 的 Item 一一对应 */
export const TABLE_NAME = 'items';

export const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  tag         TEXT    NOT NULL,
  prio        TEXT,
  due         TEXT,
  done        INTEGER NOT NULL DEFAULT 0,
  done_at     TEXT,
  created_at  TEXT    NOT NULL,
  image_uris  TEXT    NOT NULL DEFAULT '[]'
);
`;

/** 统计查询按 done_at 过滤,建索引 */
export const CREATE_INDEX_DONE_AT_SQL =
  `CREATE INDEX IF NOT EXISTS idx_items_done_at ON ${TABLE_NAME} (done_at);`;

/** 计划数按 due 过滤,建索引 */
export const CREATE_INDEX_DUE_SQL =
  `CREATE INDEX IF NOT EXISTS idx_items_due ON ${TABLE_NAME} (due);`;

/**
 * 列名映射。数据库用 snake_case,TypeScript 用 camelCase。
 * 集中在这里,避免 DAO 里散落字符串字面量。
 */
export const COLUMNS = [
  'id', 'kind', 'title', 'tag', 'prio', 'due',
  'done', 'done_at', 'created_at', 'image_uris',
] as const;
```

- [ ] **Step 2: 写 DAO `entry/src/main/ets/data/ItemDao.ets`**

```ts
import { relationalStore } from '@kit.ArkData';
import type { Item, Kind, Prio, Tag } from '../../../../../core/types';
import {
  COLUMNS,
  CREATE_INDEX_DONE_AT_SQL,
  CREATE_INDEX_DUE_SQL,
  CREATE_TABLE_SQL,
  TABLE_NAME,
} from './schema';

const STORE_CONFIG: relationalStore.StoreConfig = {
  name: 'minimalnote.db',
  securityLevel: relationalStore.SecurityLevel.S1,
};

/** RDB 的一行 —— 列名为 snake_case */
interface ItemRow {
  id: number;
  kind: string;
  title: string;
  tag: string;
  prio: string | null;
  due: string | null;
  done: number;
  done_at: string | null;
  created_at: string;
  image_uris: string;
}

export class ItemDao {
  private store: relationalStore.RdbStore | null = null;

  async init(context: Context): Promise<void> {
    this.store = await relationalStore.getRdbStore(context, STORE_CONFIG);
    await this.store.executeSql(CREATE_TABLE_SQL);
    await this.store.executeSql(CREATE_INDEX_DONE_AT_SQL);
    await this.store.executeSql(CREATE_INDEX_DUE_SQL);
  }

  /** 行 → Item。normalizeItem 由调用方施加,这里只做类型搬运。 */
  private toItem(row: ItemRow): Item {
    return {
      id: row.id,
      kind: row.kind as Kind,
      title: row.title,
      tag: row.tag as Tag,
      prio: row.prio as Prio | null,
      due: row.due,
      done: row.done === 1,
      doneAt: row.done_at,
      createdAt: row.created_at,
      imageUris: JSON.parse(row.image_uris) as string[],
    };
  }

  private toValues(item: Item): relationalStore.ValuesBucket {
    return {
      id: item.id,
      kind: item.kind,
      title: item.title,
      tag: item.tag,
      prio: item.prio,
      due: item.due,
      done: item.done ? 1 : 0,
      done_at: item.doneAt,
      created_at: item.createdAt,
      image_uris: JSON.stringify(item.imageUris),
    };
  }

  async insert(item: Item): Promise<number> {
    return this.requireStore().insert(TABLE_NAME, this.toValues(item));
  }

  async update(item: Item): Promise<number> {
    const store = this.requireStore();
    const predicates = new relationalStore.RdbPredicates(TABLE_NAME);
    predicates.equalTo('id', item.id);
    return store.update(this.toValues(item), predicates);
  }

  async remove(id: number): Promise<number> {
    const store = this.requireStore();
    const predicates = new relationalStore.RdbPredicates(TABLE_NAME);
    predicates.equalTo('id', id);
    return store.delete(predicates);
  }

  async findAll(): Promise<Item[]> {
    const store = this.requireStore();
    const predicates = new relationalStore.RdbPredicates(TABLE_NAME);
    predicates.orderByDesc('created_at');
    const rs = await store.query(predicates, [...COLUMNS]);
    const out: Item[] = [];
    while (rs.goToNextRow()) {
      out.push(this.toItem(rs.getRow() as unknown as ItemRow));
    }
    rs.close();
    return out;
  }

  private requireStore(): relationalStore.RdbStore {
    if (this.store === null) {
      throw new Error('ItemDao 未初始化,请先 await init(context)');
    }
    return this.store;
  }
}
```

> 上面 `import ... from '../../../../../core/types'` 的相对路径需要按 IDE 实际生成的目录结构校正。DevEco 会帮你补全。若相对路径跨出模块导致构建失败,改用工程内的路径别名(在 `build-profile.json5` 里配 `paths`)。

- [ ] **Step 3: 写 DAO 测试 `entry/src/ohosTest/ets/test/ItemDao.test.ets`**

```ts
import { describe, beforeAll, it, expect } from '@ohos/hypium';
import { ItemDao } from '../../../main/ets/data/ItemDao';
import { makeTodo, setDone } from '../../../../../core/item';

export default function itemDaoTest() {
  describe('ItemDao', () => {
    let dao: ItemDao;

    beforeAll(async () => {
      dao = new ItemDao();
      await dao.init(globalThis.abilityContext);
    });

    it('写入后能原样读出', 0, async () => {
      const item = makeTodo({
        id: 1, title: '背 50 个单词', tag: '学习',
        createdAt: '2026-09-24T09:41:00+08:00',
        prio: 'mid', due: '2026-09-25T21:00:00+08:00',
      });
      await dao.insert(item);
      const got = (await dao.findAll()).find((x) => x.id === 1)!;
      expect(got.title).toBe('背 50 个单词');
      expect(got.prio).toBe('mid');
      expect(got.done).toBe(false);
    });

    it('勾选状态能持久化', 0, async () => {
      const item = makeTodo({ id: 2, title: '买菜', tag: '生活', createdAt: '2026-09-24T09:41:00+08:00' });
      await dao.insert(item);
      await dao.update(setDone(item, true, '2026-09-24T20:00:00+08:00'));
      const got = (await dao.findAll()).find((x) => x.id === 2)!;
      expect(got.done).toBe(true);
      expect(got.doneAt).toBe('2026-09-24T20:00:00+08:00');
    });

    it('image_uris 空数组能正确往返', 0, async () => {
      const item = makeTodo({ id: 3, title: 'x', tag: '学习', createdAt: '2026-09-24T09:41:00+08:00' });
      await dao.insert(item);
      const got = (await dao.findAll()).find((x) => x.id === 3)!;
      expect(JSON.stringify(got.imageUris)).toBe('[]');
    });

    it('删除后读不到', 0, async () => {
      const item = makeTodo({ id: 4, title: 'y', tag: '学习', createdAt: '2026-09-24T09:41:00+08:00' });
      await dao.insert(item);
      await dao.remove(4);
      expect((await dao.findAll()).find((x) => x.id === 4)).toBeUndefined();
    });
  });
}
```

- [ ] **Step 4: 跑测试**

Run: `hvigorw test --mode module -p module=entry@ohosTest`
Expected: PASS,4 项通过

- [ ] **Step 5: 提交**

```bash
git add entry/src/main/ets/data/ entry/src/ohosTest/
git commit -m "feat(data): Item 的 RDB 建表与 DAO" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 8: 统计页接入真实数据源

**Files:**
- Create: `entry/src/main/ets/data/StatsSource.ets`
- Modify: 统计页(Tab 2)

- [ ] **Step 1: 写 `entry/src/main/ets/data/StatsSource.ets`**

```ts
import { ItemDao } from './ItemDao';
import { normalizeItem } from '../../../../../core/item';
import { summarize, type StatsSummary } from '../../../../../core/stats';
import type { Item } from '../../../../../core/types';

/** 统计页的唯一数据来源:读库 → 过不变量 → 交给纯逻辑层汇总 */
export class StatsSource {
  constructor(private dao: ItemDao) {}

  /** nowISO 由调用方传入,便于测试与「跨零点刷新」 */
  async summary(nowISO: string): Promise<StatsSummary> {
    const raw = await this.dao.findAll();
    // normalizeItem 会拦掉 done=true 却没有 doneAt 的脏数据,
    // 而不是让统计静默算错
    const items: Item[] = raw.map(normalizeItem);
    return summarize(items, nowISO);
  }
}
```

- [ ] **Step 2: 在统计页接上并核对数字**

把 `StatsSource.summary(...)` 的结果绑到统计页的环形图与柱状图。

> **注意**:`new Date().toISOString()` 产出的是 `Z` 结尾的 UTC 时间戳。若 App 要按本地墙上时间统计,应改成带本地偏移量的格式。**这一点在接真机时验证** —— 在设备时区非 UTC 的情况下对比柱状图最后一根柱子和当天日期是否对得上。设计文档 U1 相关风险在此处落地。

- [ ] **Step 3: 真机验收**

在真机上:新建 3 条待办 → 完成 1 条 → 打开统计页
Expected: 完成度显示 `1/3`(或 `1/N`,N = 本周 due 落点条数),柱状图当天有 1 根柱子,连续打卡显示 1

- [ ] **Step 4: 提交**

```bash
git add entry/src/main/ets/data/StatsSource.ets entry/src/main/ets/pages/
git commit -m "feat(stats): 统计页接入真实数据源" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## M1 完成标准

- [ ] `npm test` 全绿(71 项)
- [ ] `npm run typecheck` 无输出
- [ ] DevEco 工程能构建出 HAP
- [ ] 真机上新建 / 勾选 / 删除待办,重启 App 后数据仍在
- [ ] 统计页数字与手工核算一致
- [ ] 设计文档第 9 节的 U4、U5 已按本计划的决断更新状态

## 已知的后续缺口(不在 M1 范围)

| 缺口 | 归属 |
|---|---|
| 卡片与 App 的数据同步机制 | U2 → M5,是功能 1 的技术核心 |
| 待办重复规则(每日/每周) | U3 → 当前模型不支持,「背 50 个单词」只能手动重建 |
| 语音识别离线/在线与方言支持 | U6 → M6 |
| App 被杀死后提醒是否仍触发 | U7 → M4 |
| 里程碑时间线、人力估算、风险清单 | 本计划不含 —— 需要的话另出一份排期文档 |

## 执行记录(A 部分,2026-09-24)

A 部分(Task 0–5)已执行完毕,`npm test` 71 项全绿、`npm run typecheck` 退出码 0,分 6 次提交落在 `feat/m1-data-layer` 分支上。

执行中与本计划的偏差,记录在此以免后人对着计划困惑:

1. **测试数对不上。** 本计划原写 59 项(smoke 1 + date 19 + item 16 + stats 23),实际 71 项。写计划时数错了 date(实为 21)和 stats(实为 26),又漏算了 Task 5 的 fixture(7 项)。上文相关行已按实测改正。计划里的数字是估算,以 `npm test` 的真实输出为准。

2. **`weekRatio` 有一项测试是错的,实现是对的。** 原计划里的「完成 2 项、计划 4 项 → 0.5」用 `doneTodo()` 造已完成条目,而 `doneTodo()` 不设 `due`。按 U4 口径,无 `due` 的待办不进分母,于是 `weekPlanned` 实际是 2 而非 4,比率算出 1。旁边的「全部完成 → 1」也因同样原因**侥幸**通过 —— 它根本没验证到想验证的东西。

   修法是把四条都补上落在本周的 `due`,让分母真的等于 4;并且把这个理由写进测试注释,免得以后有人又照原样"简化"回去。

   这正是 A/B 拆分的价值所在:一个统计语义的错,443 ms 的纯 TypeScript 测试就抓出来了,全程不需要鸿蒙工具链。若等到 ArkTS 阶段再发现,排查成本高一个数量级。

3. **工具链版本比计划里新。** 实装 TypeScript 7.0.2、vitest 5.0.1、@types/node 26.6.2,计划里写的是 5.x / 2.x。无影响。
