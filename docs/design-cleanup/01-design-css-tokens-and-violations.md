# 01 · design.css:token 化、违规清理与死代码删除

> 设计语言基准(design.css 头部注释):零圆角、系统字体、Apple HIG 灰阶、
> 平面白卡(无玻璃/无 blur)、主题色角标、编辑部式排版。
> 本次改动全部是"把掉队的角落拉回既有体系",不改变设计方向。

## 新增 tokens(`:root`)

| Token | 值 | 用途 |
|---|---|---|
| `--pi-theme-strong` | `color-mix(in srgb, var(--pi-theme) 85%, #000)` | 主题色的 hover/active 深色。**此前各处硬编码 `#dc2626`,换主题色后会失配;现在全部跟随 `--pi-theme`。** |
| `--pi-text-strong` | `#1c1c1e` | 黑底按钮(primary ink)的 hover 深色 |
| `--pi-danger` | `#dc2626` | 错误语义色。此前错误色混用 `#dc2626` / `#d34a4a` / 品牌红三种 |
| `--pi-warn` | `#d97706` | 警告语义色(预算警戒等) |
| `--pi-text-placeholder` | `#a6a6ab` | 输入框 placeholder。替代原 `#a8b0bc`(蓝灰,不在 HIG 灰阶family 里) |
| `--pi-trace-font` / `--pi-trace-font-meta` | `0.75rem` / `0.7rem` | 工作过程链(thinking + tools)的微型字号,此前 0.68/0.72/0.75 三种散落值 |

## 违规修复

- **`.pi-message-context-menu`(消息右键菜单)整体重写**:原样式为圆角 7px/5px +
  `backdrop-filter: blur(16px)` + 大投影,且引用了四个**不存在的 token**
  (`--pi-bg-elevated` / `--pi-border` / `--pi-text-muted`),明显来自另一套设计系统。
  现改为平面直角面板:`--pi-line` 边框 + `--pi-panel` 白底 + `--pi-shadow-float`,
  行 hover 用 `--pi-panel-subtle`,与 toolbar 弹出面板同语言。
- `.pi-web-chrome-bar`:去掉 `backdrop-filter: blur(8px)`,底色改为不透明 `--pi-bg`。
- `.pi-web-chrome-account-badge`:去掉 `border-radius: 0.25rem`。
- `.pi-composer-files-overlay`:删除引用不存在 token 的
  `border-radius: var(--pi-radius-sm) 0 0 0` 行。
- `.pi-composer-connecting`:三处硬编码 `#ef4444`/`#fff` → `--pi-theme`/`--pi-theme-ink`。
- 所有 `#dc2626` hover → `--pi-theme-strong`(send-btn accent、working 徽章、toolbar accent)。
- `.pi-panel-btn--primary:hover` `#1c1c1e` → `--pi-text-strong`;`color:#fff` → `--pi-panel`。
- 错误/警告色 → `--pi-danger` / `--pi-warn`(process step error、web-chrome budget warn)。
- 扩展对话框(`.pi-ext-dialog-*`):`background: white` → `--pi-panel`;
  字号 0.78/0.82/0.68rem → `--pi-panel-font(-desc/-meta)`;
  输入框 focus 边框改 `--pi-theme`(与 `.pi-panel-input:focus` 一致);
  **删除 `.pi-ext-dialog-btn/--primary`(组件改用共享 `.pi-panel-btn`,见文档 04)**。

## 死代码删除

- `.pi-account-panel-*` 全部(约 200 行,含 prefs/toggle/segment/meter):
  AccountPanel 已改用 PanelBody/PanelListRow,TSX 无任何引用。
- `.pi-group-browser` 死类:root/list/empty/row/open/remove/error。
  存活的只有 head/new/form/config-hint(仍被 GroupBrowser 使用)。
- `.pi-notification-*` 全部 + `pi-notification-in/out` keyframes(弹出通知系统删除,见文档 02)。
- 重复 keyframes:删 `pi-loading-spin`、`pi-message-export-spin`(统一用 `pi-spin`)、
  `pi-context-menu-in`(从未被引用)。
- `.pi-composer-badges` 定义了两次(后者覆盖前者):合并为一个
  (`position: static; margin-right: 0.35rem` 为最终生效值)。
- `.pi-glass-light`(与 `.pi-glass` 完全相同)删除;`.pi-glass` 更名 **`.pi-panel-card`**
  ("glass" 是已废弃的毛玻璃时代命名,系统现明确 no glass)。

## 新增:状态栏 flash 样式

`.pi-status-bar--flash` / `.pi-status-bar--flash-error`:弹出通知的替代品,
占用状态栏最上面的 slot 数秒后自动让位;error 用 `--pi-danger`。
详见文档 02。

## 排查提示

- 若发现某处 hover 红色与主题不符,查该处是否仍硬编码色值——本次之后
  design.css 中除 token 定义和 hljs 语法调色板外不应再有 `#dc2626`/`#ef4444`。
- `pi-panel-card` 的使用方:LoginView、SlashCommandMenu、SlashScopedModels、
  FilePreviewWindow(原 `pi-glass` 类)。
