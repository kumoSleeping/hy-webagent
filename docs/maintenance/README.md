# 运维与加固文档（maintenance）

本目录记录 **已实际落地到代码里** 的改动：每一项都写清「问题本质 → 利用/故障方式 →
改动位置 → 为什么这样修 → 如何验证 → 怎么排查」，供日后排障和二次开发使用。

> 与 `docs/security-remediation.md` 的区别：那份是**方案稿**（描述方向，不含代码改动）；
> 本目录是**实施记录**（对应真实 commit）。两者互补，不要混用。

## 索引

| 文档 | 内容 |
|------|------|
| [01-security-fixes.md](./01-security-fixes.md) | 三路并行安全审计的结果与修复：跨用户会话泄露、会话劫持、登录 DoS、沙箱逃逸、软链接越权等 |
| [02-keepalive.md](./02-keepalive.md) | 保活能力：优雅退出、致命错误处理、systemd 看门狗、存活/就绪探针、加固后的 unit |
| [03-self-update.md](./03-self-update.md) | 自我更新：构建门控 + 健康门控 + 自动回滚，以及 `/api/ops/*` 控制接口 |
| [04-session-share.md](./04-session-share.md) | 会话分享令牌：所有者签发、可撤销、会过期的只读链接（补回 S1 收紧后失去的分享能力） |

## 本次改动涉及的文件

**新增**

```
server/src/ops/lifecycle.ts      进程信号与致命错误的唯一归口、优雅排空
server/src/ops/health.ts         事件循环延迟监控、liveness / readiness
server/src/ops/sd-notify.ts      systemd sd_notify 与看门狗心跳
server/src/ops/updater.ts        自更新编排（detached 启动、状态读取、远端比对）
server/src/routes/ops.ts         /api/ops/* 管理员接口
server/src/db/session-share-repository.ts  分享令牌存储（哈希存储、过期、撤销、审计）
server/src/routes/session-share.ts  /api/sessions/:id/share 签发 / 查询 / 撤销
scripts/self-update.sh           自更新脚本（构建门控、健康门控、自动回滚）
scripts/systemd/hy-webagent.service
scripts/systemd/hy-webagent-update.service
scripts/systemd/hy-webagent-update.timer
server/src/test/ops-lifecycle.test.ts
server/src/test/session-share.test.ts
```

**修改（安全）**

```
server/src/pi/session-files.ts   精确匹配 + UUID 校验（原为子串匹配）
server/src/ws/chat.ts            在唯一访问器上收口会话归属校验
server/src/index.ts              访客白名单、两处 IDOR、登录限流、upgrade 异常兜底
server/src/auth.ts               消除 O(用户数) 的 bcrypt 扫描
server/src/routes/auth.ts        接入登录锁定、logout 需鉴权且只登出自己
server/src/middleware/rate-limit.ts  限流键改用 req.ip；新增登录专用限流器
server/src/login-guard.ts        IP 表加上限
server/src/pi/agent-sandbox.ts   修复恒假的跨 workspace 守卫；封堵 data 目录
server/src/pi/isolation.ts       路径校验加入 realpath（防软链接逃逸）
server/src/bot/uploads.ts        不再信任落盘元数据里的 storedPath
server/src/usage/recorder.ts     移除会吞掉 SIGTERM 的信号监听器
```

**修改（分享令牌配套）**

```
server/src/ws/chat.ts            访客历史改为按所有者 workspace 定向查找
client/src/hooks/useChatWebSocket.ts  访客 WS 连接透传 ?share= 令牌
client/src/stores/authStore.ts   logout 改为携带 Authorization 头
```

**修改（支撑）**

```
server/src/config.ts             登录限流配置项
server/src/bot/repository.ts     rawDb（供就绪探针做 SELECT 1）
server/src/pi/session-manager.ts activeSessionCount()
server/src/test/session-files.test.ts  部分 id / 路径穿越的回归用例
```

## 快速验证

```bash
cd server && npx tsc --noEmit && npm test
```

预期：**165 passed / 1 failed**（client 侧另有 142 passed）。
唯一失败项 `platform-system.test.ts` 是**本次改动前就存在**的失败
（断言 `SYSTEM.md` 不含 `projects/`，而该文档确实包含），
已在干净工作树上复现确认无关。

## 新增运行时配置

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `LOGIN_RATE_LIMIT_WINDOW_MS` | `60000` | 登录限流窗口 |
| `LOGIN_RATE_LIMIT_MAX_REQUESTS` | `10` | 窗口内最大登录尝试次数 |
| `UPDATE_BRANCH` | `main` | 自更新跟踪的分支 |
| `SERVICE_NAME` | `hy-webagent` | 自更新重启的 systemd 服务名 |
| `GIT_COMMIT` | `unknown` | 构建时注入，health 接口回显，便于确认部署版本 |

## 新增接口

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/health` | 公开 | 存活探针（事件循环）；不健康返回 503 |
| GET | `/health/ready` | 公开 | 就绪探针（DB / 会话 / 内存）；不就绪返回 503 |
| GET | `/api/ops/update/status` | admin | 当前 commit、是否更新中、上次结果 |
| GET | `/api/ops/update/check` | admin | 远端是否有新 commit（只读） |
| POST | `/api/ops/update/apply` | admin | 触发更新，返回 202；`{"dryRun":true}` 仅检测 |
| POST | `/api/sessions/:id/share` | 会话所有者 | 签发只读分享链接（默认 7 天，上限 90 天） |
| GET | `/api/sessions/:id/share` | 会话所有者 | 查询分享状态与访问次数（不返回令牌） |
| DELETE | `/api/sessions/:id/share` | 会话所有者 | 撤销该会话的全部分享链接 |

## 仍待处理

按风险排序，详见各文档末尾：

1. **服务以 root 运行** — agent 执行用户 bash，等于用户代码以 root 运行。
   加固版 unit 已备好 `User=` 的写法，但切换需 chown `data/` 与 `workspaces/`，
   属带停机风险的独立迁移。
2. **SSRF：DNS rebinding 与 IPv6 判定缺口** — 需改为「解析一次 → 校验全部地址 → 连接已固定 IP」。
3. **`stored_api_keys` 明文存储 API key** — 使 bcrypt 哈希形同虚设。
4. **会话默认永不过期** — `SESSION_TIMEOUT_HOURS` / `SESSION_MAX_HOURS` 默认为 0。
5. **`/api/files/read` 无大小上限**；**`/api/remote/fetch` 信任 `Content-Length`**。
