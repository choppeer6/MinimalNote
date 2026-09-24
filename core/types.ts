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
