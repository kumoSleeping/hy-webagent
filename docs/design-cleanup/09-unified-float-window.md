# 09 — 悬浮小窗:统一尺寸 + 拖动 + 改大小 + 记忆(设计稿 E)

日期:2026-07-26。08 的再迭代(与桌面版 PI-HGUI 2f246b9 同源):**大小两态整体删除**,悬浮卡变成一张可拖动、可改大小、有记忆的小窗。

## 行为

- **统一一种尺寸**:默认 `min(34rem, 100vw-2rem) × min(24rem, 100dvh-12rem)`,所有面板同一张卡,内容内部滚动。
- **默认位置不居中**:右缘与 composer 右缘同一条线(`--pi-float-right` 实测),低位悬浮(`--pi-float-bottom` 实测)。
- **头部按住拖动**;**右下角折角握把改大小**(min 240×160)。拖/改过 → `data-free` + inline 几何,写 `localStorage["pi-float-panel-rect-v1"]`,下次原样恢复(钳到当前窗口)。
- **可以出界**:四周留 56px 可抓余量,顶部不许出;窗口缩放自动钳回。
- **无 ✕ 无 ⤢**:关闭 = 点卡外 / Escape / 再点同一工具栏按钮。

## 实现

- `stores/composerPanelStore.ts` 回退到无 stance 版本(eb2c3a4 原样)。
- `ComposerPanelChrome.tsx` 重写:头部拖动 + 握把 + localStorage/clampRect;不再依赖 store、无按钮、无截断检测;指针交互全 pointer capture,`touch-action:none`。
- `ComposerBar.tsx`:去 `data-stance`;测量 effect 同时写 `--pi-float-bottom` / `--pi-float-right`(`innerWidth - dockRect.right`)。
- `design.css`:右锚定 + 定高;`[data-free]` 释放锚;`.pi-float-panel-grip` 折角;入场动画改 `transform: translateY`(不再需要 translate 居中);handle-btn 样式全删。

## 排查

- 复位默认位置:`localStorage.removeItem("pi-float-panel-rect-v1")` 刷新(暂无 UI 入口)。
- 默认不贴右缘:`--pi-float-right` 未写入 → ComposerBar 测量 effect 早退或 dock 类名变了。
- 几何逻辑只用 window resize 事件,无 ResizeObserver 依赖(jsdom 安全);141 测试全绿,build 通过。
