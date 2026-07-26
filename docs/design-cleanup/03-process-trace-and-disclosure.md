# 03 · 工作过程链(ProcessTrace)与全局折叠语汇统一

## 问题

1. **Web 类工具(read_url / web_search / x_search 等)完全不可展开**:
   `ProcessTrace.ToolStep` 对 `getToolCategory === "web"` 的工具只渲染纯文本行,
   没有 chevron、没有点击,input/output 与错误详情永远无法查看。
2. 展开抽屉里 Input 用 `CodeBlock`(白卡+语言栏),Output 是裸 mono div——同一
   抽屉两种排版;白卡也与灰色 trace 链的低调气质冲突。
3. 全项目三种折叠表达:ProcessTrace 顶层 chevron 在左、step 的 chevron 被
   `order:10; margin-left:auto` 排到最右;FileTree 用换图标(Right↔Down);
   SlashSessionTree 用单图标 rotate-90。
4. 错误图标用品牌红 `--pi-theme`,与"theme red 只用于徽章/边框"的注释矛盾。

## 改动

### ProcessTrace.tsx
- 删除 web 工具特殊分支:**所有工具统一渲染为可展开行**
  (label + target 摘要 + running spinner / error icon)。
- 抽屉统一:Input 和 Output 都用 `.pi-process-step-output` 轻量 mono 块
  (Input 为 pretty-printed JSON),不再引入 CodeBlock。
- target 为占位符 `"…"` 时不渲染摘要 span。
- 错误图标 `text-[var(--pi-theme)]` → `text-[var(--pi-danger)]`。
- `DisclosureIcon` 改为单个 ChevronRight + `.pi-disclosure-icon--open`(rotate 90°),
  CSS 增加 transition;删除 step chevron 靠右的 `order:10; margin-left:auto` 规则
  ——**chevron 全部在行首**。

### FileTree.tsx
- 换图标式折叠(ChevronDown/ChevronRight)→ 同一 rotate 语汇。
- `text-base` → `text-[length:var(--pi-panel-font)]`(走 token)。
- 文件名 span 加 `pi-tree-label`(键盘选中行标题变主题色,由共享选择器接管,
  取代 design.css 里按 utility class 匹配的脆弱补丁选择器)。
- 空状态改用共享 `.pi-panel-empty`。

### lib/toolDisplay.ts
- 删除 `ToolCategory` / `WEB_TOOLS` / `getToolCategory`:唯一使用方就是
  ProcessTrace 的 web 特殊分支,分支删除后成为死代码。

### 测试
- `ProcessTrace.test.tsx`:原 "web actions non-expandable" 用例改为
  "web actions expand like any other tool"(默认折叠 → 点开可见 Input/Output)。

## 排查提示

- 折叠语汇的唯一正确写法:行首 `ChevronRight` + 展开时 rotate 90°
  (`.pi-disclosure-icon--open` 或 Tailwind `rotate-90`)。新增可折叠 UI 请沿用。
- 若要为某类工具恢复"精简行",不要再做不可展开的特殊分支——收敛摘要文案即可,
  展开能力必须保留。
