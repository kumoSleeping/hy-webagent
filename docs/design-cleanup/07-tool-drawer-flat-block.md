# 07 · 工具调用抽屉:无边框平面块 + 5 行窥视窗

## 问题(用户反馈,附截图)

展开一个工具调用后:

1. 内容太长——input 的 JSON 全量铺开,output 也一大段,占满整屏;
2. input 用 `JSON.stringify(input, null, 2)` 渲染,满屏 `{ } " ,` 噪声;
3. 展开区没有"板块感",和思考文本混在一起,不易扫读;
4. `INPUT` / `OUTPUT` 两个大写标题多余——上面是输入、下面是输出,位置本身已经说明了一切;
5. 同轮反馈:工具名此前改成了主题红(`--pi-theme`),太扎眼,改成**加粗**。

## 设计

### 板块感 = 换一块色面,不是画一个框

约束:不要边框、不要分割线、不要最终回复那种"白卡 + 左上角红角标"。
页面底色是 `--pi-bg`(#f2f2f2),所以**一块纯 `--pi-panel` 白色平面 + 内边距**
就能靠色面对比自然读成板块——这正是设计语言"flat white surfaces"的本义,
零新增视觉元素:

```css
.pi-process-step-body--tool {
  background: var(--pi-panel);   /* 白平面浮出灰底 */
  padding: 0.65rem 0.8rem;
  gap: 0.7rem;                   /* input/output 之间唯一的分隔:留白 */
  /* 无 border、无 shadow、无 radius、无角标 */
}
```

### 5 行窥视窗

input 和 output 各自是一个 `.pi-process-step-output`,上限正好 5 行文字,
超出内部滚动:

```css
max-height: calc(1.5em * 5);   /* line-height 1.5 → 恰好 5 行 */
```

### 去结构化的 input(formatToolInput)

`lib/toolDisplay.ts` 新增 `formatToolInput()`:JSON → 纯文本,
无大括号、无引号,层级只靠两空格缩进和 `-` 列表符(和 output 常见的
YAML 风格天然一致):

```
searches:
  - query: 超时空辉夜姬 剧情
    num: 10
```

### 无标题

`Input` / `Output` 两个 `.pi-process-step-meta` 标题删除;
`Running…` / `No output returned` 两个状态行保留(它们是信息,不是标签)。

### 工具名:加粗,不是红

`.pi-process-step-label`:`color: var(--pi-theme)` 撤销,
改 `font-weight: 700`(mono、继承 trace 的灰色,hover 随整行变深)。

## 代码变更

| 文件 | 变更 |
|---|---|
| `lib/toolDisplay.ts` | 新增 `formatToolInput` + `plainLines`(递归扁平化) |
| `ProcessTrace.tsx` | 抽屉去掉两个 meta 标题层,input 改 `formatToolInput` |
| `design.css` | `--tool` 加白底/内边距;output 上限 5 行;label 去红改粗 |
| `ProcessTrace.test.tsx` | 断言从 "Input"/"Output" 标题改为纯文本内容 |

## 验证

- tsc + vitest 142 用例 + build 通过。
- Playwright 注入真实 class 结构截图:白平面块清晰浮出灰底、
  input/output 各 5 行内滚动、无任何线条;label 像素级确认为灰色加粗
  (整页缩略图上加粗灰 mono 会有暖色错觉,以像素裁剪为准)。

## 二次开发注意

- 想给抽屉加边框/标题/角标都是回归,先读本文件的"设计"一节。
- `formatToolInput` 是展示用的有损渲染(丢掉了类型信息),
  永远不要拿它反解析;需要原始 JSON 时直接用 `toolCall.input`。
