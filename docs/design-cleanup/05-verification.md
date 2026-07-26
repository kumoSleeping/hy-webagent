# 05 · 验证记录

日期:2026-07-26

## 结果

- `npx tsc -b --noEmit`:通过,无错误。
- `npx vitest run`:**33 个测试文件 / 142 个用例全部通过**。
- `npm run build`(vite 生产构建):通过。

## 因重构调整的测试

- `ProcessTrace.test.tsx`:
  "renders web actions as non-expandable rows" →
  "lets web actions expand to their input/output like any other tool"
  (web 工具现在与其它工具一致:默认折叠一行,点开可见 Input/Output)。
- `stores/notificationStore.test.ts`:随通知系统一并删除。
- `AccountPanel.test.tsx`:未改动(断言的群聊/退出行文案保持不变)。

## 本系列文档索引

| 文档 | 内容 |
|---|---|
| 01 | design.css token 化、圆角/blur 违规清理、死代码删除、右键菜单重写 |
| 02 | 弹出通知系统删除 → 状态栏 flash(交互替代方案与调用点映射) |
| 03 | ProcessTrace 工具展开统一、全局折叠语汇统一(chevron 左置 + rotate) |
| 04 | tree/用户面板/扩展对话框/PanelSurface 组件统一与 TSX 硬编码色清理 |
| 05 | 本文档(验证记录) |

## 二次开发注意事项

1. **不要新增弹出通知**:统一走 `flashStatus(text, kind)`(statusBarStore)。
2. **不要硬编码颜色**:hover 深红用 `--pi-theme-strong`,错误 `--pi-danger`,
   警告 `--pi-warn`,黑按钮 hover `--pi-text-strong`,placeholder
   `--pi-text-placeholder`。
3. **零圆角、无 blur** 是硬约束;唯一的历史例外(web-chrome bar 的 blur)已移除。
4. 可折叠 UI 一律:行首 ChevronRight + 展开 rotate 90°。
5. 面板类 UI 优先复用 `PanelBody / PanelListRow / PanelActions / PanelButton /
   PanelSurface`;新写行样式前先看 `components/common/panel/`。
