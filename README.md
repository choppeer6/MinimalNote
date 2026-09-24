# 极简小记 · MinimalNote

> 鸿蒙轻量级待办与笔记工具 —— **在桌面卡片上直接打卡,不用打开 App。**

针对日常碎片化记事"启动慢、操作繁"的痛点:把"记一笔"的路径从五步压到一步,让"要不要做"成为记录时唯一需要判断的事。

---

## 现在有什么

| 路径 | 内容 |
|---|---|
| `prototype/index.html` | **可点击交互原型 v0.1** —— 单文件、零依赖、零构建 |
| `docs/superpowers/specs/2026-09-24-minimalnote-design.md` | 设计文档:决策、数据模型、鸿蒙技术映射、未决问题 |
| `docs/superpowers/plans/2026-09-24-harmonyos-toolchain-setup.md` | **工具链部署计划** —— 装 DevEco Studio 的完整步骤 |
| `docs/superpowers/plans/2026-09-24-minimalnote-m1-data-layer.md` | **M1 实现计划** —— 数据层:A 部分纯 TS(今天可跑),B 部分 ArkTS/RDB |

> 鸿蒙 ArkTS 工程尚未开始。**M1 的 A 部分(纯 TypeScript 领域核心 + vitest 测试)不依赖鸿蒙工具链,可立即执行;B 部分需要先按工具链计划装好 DevEco Studio。**

## 跑一下原型

直接双击 `prototype/index.html`,或用浏览器打开:

```bash
# Windows
start prototype/index.html

# macOS
open prototype/index.html
```

建议在这几处停一下:

1. **点左侧桌面卡片上的方框** —— 右侧手机列表会实时同步。这是"免开 App 秒级打卡"的说服力所在
2. **点「记点什么…」** —— 注意底部两个按钮:「记为待办」vs「只存为备忘」,这是统一条目模型的落地形式
3. **点面板里的麦克风** —— 模拟语音逐字转写
4. **右上角 ☀** —— 日间 / 夜记切换

## 核心设计

**统一条目模型** —— 记录时不必先想"这是待办还是笔记":

```ts
interface Item {
  id: number;
  kind: 'todo' | 'note';   // note 不参与完成度统计
  title: string;
  tag: '学习' | '工作' | '生活';
  prio: 'high' | 'mid' | 'low' | null;
  due: string | null;      // ISO 8601
  done: boolean;
  doneAt: string | null;   // ISO 8601
  createdAt: string;
  imageUris: string[];
}
```

**三 Tab** —— 待办 / 统计 / 我的。统计是核心卖点,需要有稳定的家。

**纸墨视觉** —— 暖米白纸面 `#F6F2EA`、墨黑文字 `#1C1A17`、低饱和"颜料"标签色、楷体点缀。刻意避开通用 AI 审美。

## 诚实说明

原型中以下部分是**模拟的**,实现时需替换:统计数字为硬编码合成数据、语音转文字是定时器吐出固定句子、图片 / 标签管理 / 卡片尺寸 / 代理提醒点击仅弹提示条、数据仅存内存刷新即重置。

设计文档第 9 节列了 7 个**未决问题**,其中 U2(卡片与 App 的数据同步机制)是核心卖点的技术关键;U5(专注时长数据来源)是原型里唯一凭空捏造、当前模型无法推导的指标。

## 许可

尚未指定。
