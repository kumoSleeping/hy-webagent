# 06 · 大面板与输入框的"生长式"融合(--elevated 统一模型)

## 问题(用户反馈)

小面板(命令/模型/历史/文件/账户)是从工具栏条上直接长出来、与输入框融合的;
但 Tree 和文件预览是**独立悬空的板块**,和输入框完全没有交集:

- `--tree` 模式故意做成分离卡片:dock 透明无 ring、面板自带浮动投影、
  面板与 composer 之间有 0.5rem 空隙;
- `--preview` 模式虽然有卡片 ring,但面板底边与 composer 顶边之间隔着一条
  无归属的工具栏空带,读不出连续性;
- 扩展对话框走第三种 `--open`(in-flow)模式,又是一套规则。

## 设计:一种语法,两种尺寸

所有弹出物都从 composer 的工具栏接缝处生长,只是宽度/高度不同:

```
小面板(22rem,右对齐)              大面板(全 dock 宽)
┌────────────┐                 ┌──────────────────────────────┐
│ 列表内容      │                 │ 面板内容(tree/预览/对话框)        │
├────────────┤ ← 细缝           ├──────────────────────────────┤ ← 同一条细缝
│ 按钮条        │                 │  (白带)              [按钮条]   │
└─┬──────────┘                 │ ─ 输入框(边框隐去)────────────── │
  │ 输入框                       └──────────────────────────────┘
                                  ↑ 一张白卡 + box-shadow ring
```

要点:

1. **一个 dock 修饰类 `--elevated`** 取代 `--open` / `--preview` / `--tree` 三套。
   任何 CenterStage 内容(tree / 文件预览 / 扩展对话框 / 扩展 widget)打开时,
   dock 变成一张白卡:`background: --pi-panel` + `box-shadow: 0 0 0 1px ring`
   (ring 用 shadow 画,不用真 border——否则 dock 会被撑大 1px,composer 和
   状态栏会跳动)。
2. **面板绝对定位**在 dock 上方(`.pi-preview-stack` absolute,`left/right: -1px;
   bottom: 100%`),不进文档流 → feed 的预留高度不变,打开面板不回流。
   对话框/扩展 widget 原先是 in-flow(会顶起 composer),现在同样走这条路径。
3. **细缝语法统一**:`.pi-center-stage` 自带 `border`(含 border-bottom),
   底边这条 1px 线与小面板"列表/按钮条"之间的缝完全对应——
   卡片内部从上到下:面板内容 / 细缝 / 工具栏白带(按钮靠右) / 输入框。
4. composer shell 和工具栏在卡内边框隐去(`border-color: transparent`,
   保持盒高不变的原注释逻辑保留);对应工具栏按钮保持 `data-active` 高亮,
   "从哪个按钮长出来"清晰可读。
5. 统一动画:`pi-pop-in-fade 160ms`(原 tree 浮层动画/pi-pop-in 上滑动画不再用)。

## 代码变更

| 文件 | 变更 |
|---|---|
| `design.css` | `--open`/`--preview`/`--tree` 三组规则(约 100 行)合并为一组 `--elevated`;`.pi-center-stage` 基础样式收敛(去 margin-bottom/浮动投影);mobile 对应规则同步合并;删除死类 `.pi-file-preview` |
| `ChatPanel.tsx` | `dockCardOpen`/`elevatedOpen`/`treeOpen` 三个派生态删除,dock 类名只看 `centerStageOpen` |
| `FilePreviewWindow.tsx` | 删除(孤儿组件,无任何引用) |

`isElevatedPanel()`(composerLayout.ts)保留——它仍负责"tree 不走小弹窗"
的路由判断(useCenterStageOpen / ComposerBar)。

## 验证

- tsc + vitest(142 用例)+ vite build 全部通过。
- **本地起 dev(server 3001 + vite 5173)用 Playwright 截图逐一确认**:
  基线 / commands 小面板 / tree / 文件预览(含 files overlay 两段式关闭)
  四种形态均为同一张卡、同一条缝、同一动画;控制台无错误。

## 二次开发注意

- 新增大面板类型:放进 CenterStage 的 mode 即可,不要新增 dock 修饰类;
  凡是出现"面板与 composer 之间有间隙/独立投影"都是回归。
- 本地视觉验证路径:`npm run dev`;admin key 在 `data/admin-key.txt`;
  Playwright 全局包位于 `/opt/homebrew/lib/node_modules/@playwright/cli`,
  需显式指定缓存的 chromium 可执行文件(见 scratchpad drive.mjs 模式)。
