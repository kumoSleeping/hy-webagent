# 01 — 安全漏洞扫描与修复记录

> 本文记录 **已实际落地** 的代码改动（与 `docs/security-remediation.md` 的「方案稿」不同，那份只描述方向）。
> 每一项都包含：问题本质 → 利用方式 → 改动位置 → 为什么这样修 → 回归验证方式。

扫描方式：三路并行审计（认证/会话/越权、路径/SSRF/注入、运维/依赖/可靠性），
逐条回到真实代码路径复核，剔除「看起来危险但实际已被别处兜住」的误报后保留下列条目。

---

## 严重（Critical）

### S1 — 未认证访客可拉取任意用户的完整会话记录

**问题本质**：两个缺陷叠加。

1. `server/src/pi/session-files.ts` 用 **子串匹配** 定位会话文件：

   ```ts
   const match = files.find((f) => f.endsWith(".jsonl") && f.includes(bare));
   ```

   真实文件名形如 `2026-07-08T12-30-36-242Z_019f41b5-....jsonl`。
   由于 ISO 时间戳里必然含有 `-`，传入 `piSessionId="-"` 就能匹配到**第一个**会话文件。

2. `server/src/index.ts` 的 WebSocket 升级里，`view=1` 访客模式**完全不校验身份**，
   只要求 `piSessionId` 非空；随后 `ws/chat.ts` 的 `findSessionHistoryOnDisk()`
   会 **遍历所有用户的 workspace** 去找这个 id。

**利用方式**（无需任何凭证）：

```
wscat -c 'ws://target/ws/chat?view=1&piSessionId=-'
```

服务端返回 `chat:history`，内含另一个用户会话的全部内容：用户提问、模型输出、
以及每一次工具调用的入参与出参。换前缀（`019f`、`2026-07` …）即可横向遍历其他会话。
由于管理员的 agent 会话里常出现平台管理凭证，这条可直接升级为管理员接管。

**改动**：

- `server/src/pi/session-files.ts` — 改为精确匹配文件名主干，并新增 `isValidSessionId()`
  （UUID 格式校验），非法 id 直接返回 `null`：

  ```ts
  const match = files.find((f) => f === exact || f.endsWith(suffixed));
  ```

- `server/src/index.ts` — `view=1` 分支新增 `isPubliclyViewableSession()` 前置校验：
  只有登记在 `bot_sessions` 且所属 bot 账号 `enabled` 的会话才允许访客查看。
  访客连接不携带任何凭证，因此「是否已通过 bot 频道发布」就是全部授权依据。

**为什么这样修**：访客模式本身是产品需要（bot 频道公开预览），不能直接删掉。
所以把授权判断收敛成一次数据库查询——它是一个**白名单**，而不是对调用方声称的 id 做过滤。

> **行为变化与后续补齐**：该收紧会让「非 bot 的普通会话预览链接」失效。
> 普通会话的分享能力已通过**显式分享令牌**补回，见
> [`04-session-share.md`](./04-session-share.md)：所有者签发、可撤销、默认 7 天过期。
> 授权依据由此变为两条——bot 频道发布，或持有该会话的有效分享令牌。
> 同时，访客的历史查找已改为**只在所有者的 workspace 内定向查找**，
> 彻底移除了「遍历所有用户目录」这一放大器。

**回归**：`server/src/test/session-files.test.ts` 新增 4 条用例，覆盖部分 id
（`-`、`019f`、`1cf9`、`Z_019f1104`）不得命中、路径穿越（`../../etc/passwd`）不得命中、
以及 `isValidSessionId` 本身。

---

### S2 — 已登录用户可劫持他人的活跃 agent 会话

**问题本质**：`server/src/ws/chat.ts` 的 `getActiveSession()` 直接用客户端
query string 里的 `piSessionId` 去查全局 Map，**没有对比 `session.userId`**：

```ts
return sessionManager.getSession(activePiSessionId);   // 无归属校验
```

对比同仓库的 `/api/sessions/:id/status`（`index.ts`）——那里是有 `session.userId !== userId` 检查的，
说明这是遗漏而非设计。

**利用方式**：攻击者正常登录拿到自己的 `sessionId`，再带上受害者的 `piSessionId` 连接：

```
wss://host/ws/chat?sessionId=<自己的>&piSessionId=<受害者的>
```

- `subscribeToSession()` 会 **替换** `session.onEvent`，受害者自己的 WS 从此收不到事件（静默劫持）；
- 发 `ui:request_snapshot` 可读取对方完整对话；
- 发 `chat:prompt` 可在**对方的 workspace、用对方的凭证**执行 agent 指令，
  而 token 费用记在攻击者名下，受害者的用量统计里看不到痕迹。

**改动**：`server/src/ws/chat.ts` — 把归属校验放进 `getActiveSession()` 这个**唯一访问器**里，
而不是散落到每个调用点。历史快照、事件订阅、prompt 派发全部经由它，一处收口即全覆盖。
访客（`isViewOnly`）豁免，因为升级阶段已由 S1 的白名单证明该会话是公开发布的，且访客无写入路径。

---

### S3 — 登录接口可被单请求打挂（bcrypt CPU 放大）

**问题本质**：三件事叠加。

1. `server/src/index.ts` 显式把 `/auth/login` **排除在限流之外**；
2. `server/src/auth.ts` 的 `findUserByApiKey()`，HMAC 索引只在 key **正确** 时短路；
   一旦 key 错误就 fallback 到「遍历所有用户逐个 bcrypt.compare」；
3. `bcryptjs` 是纯 JS 实现，cost=12，跑在 Node 唯一的主线程上。

**利用方式**：循环 POST 一个错误 key 到 `/api/auth/login`。
N 个用户时，**每个请求**消耗 N × ~0.5s 的阻塞式 CPU。几个并发请求就能让整个服务
（HTTP 与 WebSocket 一起）失去响应。无需认证、无限流、无锁定。

同时发现 `server/src/login-guard.ts` 里实现好的「5 次失败锁定 15 分钟」
**是一段死代码**——`checkLoginAllowed` / `recordLoginFailure` / `recordLoginSuccess`
在 `login-guard.test.ts` 之外没有任何引用。

**改动**（三层，缺一不可）：

- `server/src/auth.ts` — fallback 扫描只针对 `!user.apiKeyLookup` 的历史遗留行。
  构造函数里的 `backfillApiKeyLookups()` 会补齐这些字段，因此该集合通常为空，
  成本不再随用户数增长。
- `server/src/index.ts` + `server/src/middleware/rate-limit.ts` — 新增 `loginRateLimiter`
  （默认 60s / 10 次，比通用限流更紧），`/auth/login` 从「豁免」改为走它。
  `/auth/me`、`/auth/logout` 保持豁免：前端每次路由切换都会打，且不做重活。
- `server/src/routes/auth.ts` — 把 `login-guard` 真正接进登录流程（失败计数 + 成功清零）。

**为什么三层都要**：限流器管的是**速率**，锁定管的是**总猜测次数**，
修 fallback 管的是**单请求成本**。三者正交。

---

## 高危（High）

### S4 — Agent bash 沙箱的跨 workspace 防线是死代码

**问题本质**：`server/src/pi/agent-sandbox.ts` 里的守卫有一个恒假的前置条件：

```ts
const siblingWorkspace = path.relative(ctx.userWorkspacePath, ctx.workspacesRoot);
if (siblingWorkspace && !siblingWorkspace.startsWith("..")) {  // 永远为 false
```

`workspacesRoot` 按构造就是 `userWorkspacePath` 的父目录，
所以 `path.relative()` 恒等于 `".."`，**整个 if 体从未执行过**。已实测确认。

**利用方式**（对非管理员会话，以下命令全部通过校验）：

- `cat /opt/hy-webagent/workspaces/*/.pi/agent/auth.json` → 所有用户的模型厂商 key
- `sqlite3 /opt/hy-webagent/data/plat*.db .dump` → 用 glob 绕开字面量 `platform.db` 黑名单
- `cat /opt/hy-webagent/data/bot-upload-tokens.json` → 无任何规则覆盖

**改动**：`server/src/pi/agent-sandbox.ts`

- 删除恒假前置条件，跨 workspace 检查改为无条件执行，并用 `matchAll` 检查**所有**匹配项
  （原先只看第一个）。
- 新增「裸引用 workspaces 根目录」检查——`ls .../workspaces` 或
  `workspaces/*/...` 这类没有具体子目录名的写法原先不匹配任何模式，却能跨租户枚举。
- 新增**整个 data 目录**的拒绝规则。只点名单个文件不够：`plat*.db` 能绕开
  字面量匹配，而同目录下还有 api-key 查找密钥和 bot 上传令牌。

> **注意**：这仍然是「字符串黑名单」，属于纵深防御的一层，**不是**信任边界。
> 真正的边界应当是 OS 级隔离（独立 uid / bwrap / 容器），见 `docs/security-remediation.md` F1。
> 本次改动的意义是：把一条完全洞开的路收窄回「原本设计意图」的水平。

### S5 — 路径校验只做字符串前缀比较，软链接可逃逸

**问题本质**：`server/src/pi/isolation.ts` 的 `validatePath()` 只做词法解析：

```ts
const resolved = path.resolve(root, targetPath);
if (!resolved.startsWith(root + path.sep) && resolved !== root) throw ...
```

全仓库 `grep realpath` 无任何命中。而下游 `fs.readFile` / `fs.writeFile` / `res.download`
**都会跟随软链接**。

**利用方式**：用户自己的 agent 执行 `ln -s /root/.ssh/authorized_keys ~/projects/notes.txt`
（`ln` 不在任何黑名单里），随后 `POST /api/files/write {"filePath":"notes.txt", ...}`。
字符串检查看到的是合法的 `notes.txt`，实际写入的是宿主的 SSH 授权文件。
服务当前以 root 运行 → 直接拿下主机。

**改动**：`server/src/pi/isolation.ts` — `validatePath()` 在词法检查之后追加真实路径校验：

- 用 `fs.realpathSync.native` 解析软链接后重新比对（root 自身也解析，
  以兼容 macOS 上 `/var → /private/var` 之类的情况）；
- 目标可能尚不存在（新建/写入/重命名的目的地），因此向上回溯到最近的**已存在**祖先做解析，
  再把剩余路径段拼回去——足以识别「父目录是软链接」这种情形；
- 保持函数签名同步（约 20 处调用点），故使用 `realpathSync` 而非异步版本。

### S6 — 限流键取自可伪造的 `X-Forwarded-For`

**问题本质**：`server/src/middleware/rate-limit.ts` 绕开了 Express 的 trust-proxy 机制，
直接取请求头**最左侧**的值——那一段完全由客户端提供：

```ts
return forwarded.split(",")[0]!.trim();
```

`index.ts` 已设置 `app.set("trust proxy", 1)`，`req.ip` 本来就是算好的可信值。

**利用方式**：每个请求带一个随机 `X-Forwarded-For`，即可获得独立计数桶——
限流形同虚设。受影响的包括未认证的 `/api/public/render`（每次请求驱动一次
Playwright/Chromium 截图）。

**改动**：`clientIp()` 改为直接返回 `req.ip`，由 Express 按 trust proxy 深度正确推导。

### S7 — 两处越权（IDOR）

- **`GET /api/sessions/:id/tree`**：`getSession()` 是无过滤的全局查表，
  且 `getSessionTree()` 内部也不校验归属。任意登录用户传入他人 `piSessionId`
  即可拿到对方会话树（含每条消息的 160 字预览、工具调用参数、bash 命令）。
- **`DELETE /api/sessions/:id`**：文件删除部分正确地限定在调用者自己的 workspace，
  但紧随其后的 `sessionManager.removeSession(piSessionId)` **没有归属过滤**，
  任意用户可中断他人正在运行的 agent（可用性攻击）。

**改动**：`server/src/index.ts` — 两处均补 `live.userId !== userId → 404`，
并在入口用 `isValidSessionId()` 校验参数格式；`removeSession` 补上 `await`
（它是 async，此前未 await，其内部 reject 会变成 unhandledRejection 直接打崩进程）。

### S8 — bot 上传接口信任落盘元数据里的路径

**问题本质**：`server/src/bot/uploads.ts` 的 `loadBotUpload()` 直接读取
`meta.storedPath` 并回传文件内容，**不做任何归属校验**。
而 `GET /api/public/uploads/:id/:filename` 是**完全未认证**的公开接口。

**利用方式**：与 S4/S5 组合——任何能写文件的原语，只要伪造一个
`data/bot-uploads/<32位hex>/meta.json`，把 `storedPath` 指向 `/root/.ssh/id_rsa`，
即可从公网直接下载该文件。

**改动**：不再回读 `meta.storedPath`，改为由 `id` + `safeFilename(meta.filename)`
重新推导路径（与写入侧使用同一个 `safeFilename`，保证一致），
并校验解析结果仍位于 `uploadsRoot()` 之下。

---

## 中危（Medium）

### S9 — 未认证即可注销他人会话

`POST /api/auth/logout` 此前无 `authMiddleware`，且从 **请求体** 取 `sessionId`。
任何得知某个 session id 的人都能将其踢下线。

**改动**：加上 `authMiddleware`，并只注销 `req.userSession.sessionId`（调用者自己的会话）。

### S10 — login-guard 的 IP 表无上限

`byIp` Map 以攻击者可变化的值为键，且从不清理，属于慢速内存泄漏。

**改动**：`server/src/login-guard.ts` 加 `MAX_TRACKED_IPS = 10_000` 上限。
清理策略：先删除锁定已过期的条目，仍超限时按插入顺序淘汰最旧的
（Map 保持插入序，首个键即最早插入）。

---

## 已核查但**不修**的项（避免后来者重复排查）

| 项 | 结论 |
|----|------|
| `/api/render/b64` 的 loopback 信任旁路 | 实现是正确的（只认真实 TCP 对端，拒绝 `X-Forwarded-For` / `cf-connecting-ip`，校验 Host）。但更关键的是它**不构成权限边界**——旁边的 `/api/public/render/b64` 是同一个 handler 且完全无认证。 |
| 管理员主密钥比较 | `admin-key.ts` 正确使用 `crypto.timingSafeEqual`，并在启动时拒绝占位符与过短的值。 |
| `POST /api/sessions/:id/activate` | 安全。会话文件在**调用者自己的** `sessionDir` 内解析，且复用活跃会话前要求 `inMemory.userId === userId`。 |
| bot 角色越权到管理接口 | 未发现路径。`verifyAdminApiKey` 校验角色；`/api/auth/login` 明确拒绝 bot；`POST /users` 对 role 做了 `admin`/`user` 二选一收敛。 |
| SQL 注入 | `bot/repository.ts` 全程使用 better-sqlite3 参数化语句。 |
| 渲染页 XSS | `MarkdownContent.tsx` 使用 react-markdown，未启用 `rehype-raw` 或 `dangerouslySetInnerHTML`，原始 HTML 会被转义。 |
| 依赖漏洞 | `npm audit` 在 server 与 client 均为 0 vulnerabilities。 |
| WebSocket 心跳 | `ws/chat.ts` 已有 ping/30s + 2 次未响应即断开，实现正确，无需改动。 |
| 仓库内密钥 | `git ls-files` + 历史检查均干净，`.gitignore` 覆盖完整。 |

---

## 遗留项（本轮未处理，建议后续排期）

按风险排序：

1. **服务以 root 运行且无 systemd 加固** — 这是把上述若干条从「读到别人聊天记录」
   放大成「拿下宿主」的根因。已在 `docs/maintenance/03-keepalive.md` 的 systemd unit 中
   提供加固版本（非 root、`ProtectSystem=strict` 等），但**切换 `User=` 需要迁移文件属主**，
   属于有停机风险的操作，未在本轮自动执行。
2. **SSRF：DNS rebinding 与 IPv6 判定缺口** — `ssrf.ts` 先校验后 fetch，
   两次解析之间存在 TOCTOU；且 `::`、`64:ff9b::/96`（NAT64）、
   未压缩的 v4-mapped 形式均未被拦截。修法是「解析一次 → 校验全部地址 → 连接到已固定的 IP」
   （undici Agent 的 connect hook），每个重定向跳转重新固定。
3. **`stored_api_keys` 明文存储用户 API key** — 使得 `users.api_key_hash` 的 bcrypt 形同虚设。
4. **会话默认永不过期** — `SESSION_TIMEOUT_HOURS` / `SESSION_MAX_HOURS` 默认都是 0。
5. **`/api/files/read` 无大小上限** — 单个大文件即可 OOM 掉共享进程。
6. **`/api/remote/fetch` 信任 `Content-Length`** — chunked 响应下 `0 < 500_000` 恒成立，
   可被无限流响应拖爆内存。

---

## 验证

```bash
cd server && npx tsc --noEmit && npm test
```

当前状态：**146 passed / 1 failed**。
唯一失败项 `platform-system.test.ts` 是**改动前就已存在**的失败
（断言 `SYSTEM.md` 不含 `projects/`，而该文档确实包含），
已通过在干净工作树上复现确认与本次改动无关。
