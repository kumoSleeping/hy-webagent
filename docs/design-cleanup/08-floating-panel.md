# 08 — composer 面板改为独立悬浮卡(设计稿 D)

> **⚠ 已被 [09](09-unified-float-window.md) 迭代**(同日):两态与 ⤢/✕ 移除,统一尺寸 + 拖动 + 改大小 + localStorage 记忆。

日期:2026-07-26。与桌面版 PI-HGUI 同步的呈现改版:composer 面板不再「从工具栏缝里长出来」,改为**与输入框零几何关联的低位悬浮卡**。用户原话:"不想和输入框有关联,要一个独立板块,出现得恰到好处",且明确不要抽拉把手。

## 行为

- 点工具栏按钮(或键盘 ←→)→ 悬浮卡 160ms 上浮入场:水平居中,悬在输入区上方留缝处,四边留白。
- **贴身(hug,默认)**:高度 = 内容实高,封顶 `min(45dvh, 100dvh-13rem)`;宽 `min(34rem, 100vw-2.5rem)`。模型 4 行就 4 行高。
- **满台(stage)**:大卡,`top: 2.25rem` ~ 留缝底,宽 `min(46rem, …)`,依旧独立不融卡。
- 头部行 = 标题 / ⤢⤡ / ✕;**⤢ 只在内容被截断时出现**(「看到它就代表下面还有」)。
- **tree 并入**:不再是 CenterStage mode,默认 stance=stage;CenterStage 只剩 preview/dialog/extension。
- 每种面板记住上次形态(会话级 `stanceByKind`);Escape / 点卡外 / 再点同钮关闭不变;手机(≤639px)按钮命中区加大、卡宽 `100vw-1.5rem`。

## 实现(与 PI-HGUI c842380/29cddff 同源)

| 文件 | 改动 |
|---|---|
| `stores/composerPanelStore.ts` | `PanelStance` + `stance`/`stanceByKind`/`setStance`;全部打开路径经 `stanceFor()`(tree 默认 stage) |
| `components/chat/ComposerPanelChrome.tsx` | 新:头部行 + 截断检测(ResizeObserver 有环境保护,jsdom 无 RO 时靠 MutationObserver + resize 兜底) |
| `components/chat/ComposerBar.tsx` | `.pi-float-panel`(fixed)替代工具栏内嵌 `.pi-composer-panel`;`--pi-float-bottom` 由 useLayoutEffect 量 dock 顶写入(输入框长高卡片跟着上移);新 prop `treeContent`;`showInlinePanel`/`isElevatedPanel` 移除 |
| `components/chat/CenterStage.tsx` | 删 tree mode;`useCenterStageOpen` 只看 dialog/preview/extension |
| `lib/composerLayout.ts`(+test) | 删 `isElevatedPanel` |
| `design.css` | 删旧弹窗几何(基块/20rem 定高/model-account 特例/mobile 附着规则);新增 `.pi-composer-panel-handle*` 与 `.pi-float-panel` 段;入场动画用 `translate` 属性(不用 transform,避免顶掉 -50% 居中) |

## 陷阱备忘

- `.pi-float-panel` 是 `position: fixed`:**祖先链(shell/dock/interactive-shell/app-shell)禁止出现 transform/filter/perspective**,否则 fixed 被劫持。`pi-chat-reveal` 只动 opacity,安全。
- jsdom 没有 ResizeObserver:新代码全部 `typeof ResizeObserver === "undefined"` 保护(useFittedToolbarItems 靠 desktop 早退侥幸,别效仿)。
- 旧 `.pi-composer-panel` 容器类已删;`.pi-composer-panel-stack/scroll/item-*` 等**内容类**仍在服役,勿顺手清。

验证:`client` 141 测试全绿,`npm run build` 通过。
