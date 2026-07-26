# 04 · 面板组件统一(tree / 用户面板 / 扩展对话框 / PanelSurface)

## SlashSessionTree(会话树面板)

- 删除 label 徽章上的 Tailwind `rounded` —— 全项目唯一圆角元素(违反零圆角准则)。
- 节点文本按钮加 **`pi-tree-label`** 类:键盘选中行标题变主题色的效果改由
  `design.css` 的 `.pi-panel-row--selected .pi-tree-label` 共享规则接管。
  同时删除了原来按 utility class 匹配的脆弱补丁选择器
  (`.pi-panel-row--selected > span.truncate`、`button.min-w-0.flex-1`)。
  FileTree 的文件名 span 也使用同一个类。
- 补空状态:树为空 → "No history yet";搜索无结果 → "No matching entries"
  (共享 `.pi-panel-empty` 样式,此前是纯空白)。
- 折叠 chevron 本就是 rotate 语汇,现在与 ProcessTrace/FileTree 完全一致。

## AccountPanel(用户面板)

- **leading 统一为全 icon**:此前同一列表混用 icon(用户/群聊/退出)与
  "01"/"02" 序号(预算/今日),序号从中间行开始显得随机。
  现在:用户 `UserRound`、预算 `Wallet`、今日消耗 `Activity`、
  群聊 `MessagesSquare`、退出 `LogOut`。
- **语言统一为中文**(该面板此前中英混排):
  `admin/account` → `管理员/账户`;`Budget · warn` → `预算 · 接近上限`;
  `Today` → `今日消耗`。群聊子页本来就是中文,不变。
- GroupBrowser 错误信息此前借用 `.pi-panel-empty`(空状态类)且无错误色,
  现在附加 `text-[var(--pi-danger)]`。

## ExtensionDialogHost(扩展对话框)

- confirm/editor/input 三种布局的按钮全部从自绘 `.pi-ext-dialog-btn`
  改为共享 `PanelActions` + `PanelButton`(ghost/primary)——
  与 ChatPanel scoped-models、导出对话框等使用同一套按钮。
- 对应 CSS(`.pi-ext-dialog-btn/--primary/-actions`)已在文档 01 中删除;
  输入框/文字字号并入 `--pi-panel-font` 族。

## GlassPanel → PanelSurface

- `components/common/GlassPanel.tsx` 删除,新建 `PanelSurface.tsx`:
  variants = `card`(默认,对应新 CSS 类 `.pi-panel-card`)、
  `message-user`、`message-assistant`。
  "glass" 命名是毛玻璃时代残留,设计系统已明确 no glass;
  `.pi-glass-light` 与 `.pi-glass` 内容完全相同,一并去重。
- 迁移点:MessageBubble、MessageRenderPage(组件用法);
  LoginView、SlashCommandMenu、SlashScopedModels、FilePreviewWindow
  (原 `pi-glass` 裸类 → `pi-panel-card`)。

## 其余硬编码色清理(TSX 侧)

| 文件 | 变更 |
|---|---|
| LoginView | 错误文字 `#dc2626`→`--pi-danger`;按钮 hover `#1c1c1e`→`--pi-text-strong`;`text-white`→`--pi-panel`;输入框 `bg-white`→`--pi-panel` |
| SlashScopedModels | Save 按钮同上 |
| ComposerBar | placeholder `#a8b0bc`→`--pi-text-placeholder` |
| MediaPreview | 5 处 `#ffffff` → `var(--pi-panel)` |
| MessageBubble | 右键菜单高度常量 92→76(与新 CSS 2×2.25rem+border 同步,有注释标注) |

MonacoEditor 的主题定义仍是字面 hex —— Monaco 的 defineTheme 不支持 CSS 变量,
其值与 token 一一对应(#ef4444=theme、#2c2c2e=text 等),改主题色时需手动同步,
文件顶部即 token 对照。
