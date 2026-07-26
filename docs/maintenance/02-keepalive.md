# 02 — 保活能力（Keep-alive）设计与实现

> 目标：让服务在「崩溃、被杀、卡死、重启」四种情况下都能自动恢复，
> 且恢复过程中**不丢失正在进行的工作**、**不留下损坏的状态**。

---

## 先说清楚：为什么 `Restart=always` 不够

这是本模块所有设计的出发点。systemd 的 `Restart=` 只能处理**进程退出**这一种情况。
但一个 Node 服务真正的挂法有四类：

| 挂法 | 表现 | `Restart=always` 能救吗 |
|------|------|------------------------|
| A. 进程崩溃退出 | 进程没了 | ✅ 能 |
| B. 未捕获异常/Promise rejection | Node 默认退出 → 同 A | ✅ 能（但**丢数据**） |
| C. 事件循环卡死 | 进程还在，端口还在监听，**但不响应** | ❌ **不能** |
| D. 收到 SIGTERM 但不退出 | 重启命令挂住 90s 后被 SIGKILL | ❌ **不能，反而更糟** |

本次实现的四个组件正好对应堵住这四个洞。

---

## 组件一：`server/src/ops/lifecycle.ts` — 信号与致命错误的唯一归口

### 修复的核心问题（对应上表 D）

改动前，`server/src/usage/recorder.ts` 里有这么一段：

```ts
const flush = () => this.flush();
process.on("beforeExit", flush);
process.on("SIGTERM", flush);   // ← 致命
process.on("SIGINT", flush);
```

**Node 的行为是：一旦你给 SIGTERM 注册了任何监听器，默认的「收到信号即终止」就被取消了。**
而这个 `flush()` 从不调用 `process.exit()`。后果：

- `systemctl restart` 发出 SIGTERM → 进程 flush 完继续运行
- systemd 等满 `TimeoutStopSec`（默认 90 秒）→ 发 SIGKILL 强杀
- **每次重启都变成 90 秒挂起 + 强杀**：正在进行的 agent 回合被中断、
  Chromium 子进程变孤儿、SQLite WAL 没有干净关闭

更隐蔽的是：这段代码在**第一次记录用量之后**才注册钩子，
所以这个 bug 只在服务被用过之后才出现——看起来像「偶发」。

### 改法

- `recorder.ts` 只保留 `beforeExit`，**移除信号监听**，并写明原因防止再被加回去。
- 新增 `ops/lifecycle.ts` 作为全进程唯一的信号所有者。

### 关闭顺序（顺序有意义，不要随意调整）

```
1. server.close()          停止接受新连接，让排空可以收敛
2. WS 广播 code 1012       "Service Restart"，客户端据此走重连逻辑
                           （直接断开会让前端收到一个语义不明的传输错误）
3. usage-recorder-flush    先落盘用量……
4. pi-sessions-dispose     ……再释放会话
5. bot-repository-close    最后关数据库（第 3 步要写它）
6. process.exit(code)
```

### 三层超时保护

| 层级 | 值 | 作用 |
|------|-----|------|
| 单个任务 | 5s | 一个卡住的 flush 不能吃掉整个排空窗口 |
| 整体排空 | 15s | 超时则强制 `process.exit` |
| systemd | 30s（`TimeoutStopSec`）| 必须 > 15s，否则我们还没排空完就被 SIGKILL |

所有内部定时器都 `unref()`，避免「排空已完成但定时器还吊着事件循环」。

### 致命错误处理（对应上表 B）

```ts
process.on("uncaughtException", …)   → 记录 + 排空 + exit(1)
process.on("unhandledRejection", …)  → 记录 + 排空 + exit(1)
server.on("error", …)                → EADDRINUSE 等不再是裸抛
```

选择 **exit(1) 而不是继续运行**：出现未捕获异常后进程状态已不可知，
带着未知状态继续服务比重启危险得多。退出码非 0 让 systemd 重启进入干净状态。

审计中发现的三个具体触发点也一并修了：
- `index.ts` DELETE 路由未 `await removeSession()`（async 函数，其 reject 会打崩进程）
- `server.listen` 的 async 回调没有 try/catch（启动失败 → 崩溃循环且无诊断信息）
- WS upgrade handler 里 `new URL(..., 'http://' + host)` 遇到畸形 Host 头会抛
  （**未认证即可远程触发的进程杀死**）— 已整体包 try/catch

---

## 组件二：`server/src/ops/sd-notify.ts` — systemd 看门狗（对应上表 C）

### 为什么需要

事件循环卡死时，进程还在、端口还开着，TCP 层面的健康检查**会通过**。
只有一个「必须由事件循环主动发出的心跳」才能识别这种状态。

### 实现上的坑：Node 发不出 sd_notify

sd_notify(3) 走的是 AF_UNIX **SOCK_DGRAM**，而 Node 的 `node:dgram`
只支持 udp4/udp6。已实测确认：

```
$ node -e "require('node:dgram').createSocket('unix_dgram')"
Bad socket type specified. Valid types are: udp4, udp6
```

因此改为调用 systemd 自带的 `systemd-notify` helper。
由此带来一个必要的配置项：**datagram 来自子进程而非主进程 pid，
所以 unit 必须写 `NotifyAccess=all`**（否则 systemd 会忽略这些消息）。

用 `execFile`（argv 数组）而非 `exec`，参数不经过 shell。

### 心跳逻辑

- 频率：`WATCHDOG_USEC / 2`（unit 里 `WatchdogSec=30` → 每 15 秒一次），
  这是 sd_notify(3) 推荐的节奏，留出一整个周期的容错余量。
- **关键设计**：心跳带健康判据 `startWatchdog(isAlive)`。
  `isAlive()` 返回 false 时**故意不发心跳**，让 systemd 主动重启。
  这就是「进程活着但已不可恢复地退化」的恢复路径。
- 心跳注册在事件循环上——循环一停，心跳自然就停了，无需额外探测。
- `NOTIFY_SOCKET` 未设置时（开发环境、Docker、测试）全部函数是 no-op，可无条件调用。

---

## 组件三：`server/src/ops/health.ts` — 分离的存活/就绪探针

### 为什么要分成两个

两者回答的是不同问题，混用会让看门狗做出错误决策：

| 探针 | 问题 | 失败时应该做什么 |
|------|------|-----------------|
| `/health`（liveness） | 这个进程还能推进工作吗？ | **重启** |
| `/health/ready`（readiness） | 现在该给它导流量吗？ | **摘出轮转**，不要重启 |

**liveness 必须只依赖「重启能修好」的条件**，否则会造成崩溃循环。
所以它只看事件循环延迟——数据库挂了不该重启进程，重启不会让数据库回来，
只会让故障面扩大。

### 事件循环延迟怎么测

设一个固定 1 秒的 interval，记录它**实际**触发的时间；
`延迟 = now - lastTick - 1000`。同步阻塞会让这个值线性增长。
阈值 30 秒——超过就认定是卡死而非「忙」。

### readiness 做真实探测

```ts
deps.db().prepare("SELECT 1").get();   // 真实往返，而不是缓存的布尔值
```

改动前的 `/health` 只返回静态 `{ok:true}`，它能证明事件循环和 HTTP 栈活着，
但对 SQLite 句柄、会话管理器一无所知——两者都可能在端口仍然可连的情况下永久损坏。

实测输出：

```json
{
  "ok": true, "uptimeSeconds": 2, "eventLoopLagMs": 0, "sessions": 0,
  "memory": { "rssMb": 236, "heapUsedMb": 94.2 },
  "checks": { "eventLoop": {"ok":true}, "database": {"ok":true}, "sessionManager": {"ok":true} }
}
```

---

## 组件四：`scripts/systemd/hy-webagent.service` — 加固的 unit

原先的 unit 是 `deploy-server.sh` 里的一段 heredoc，版本控制里没有正式文件
（`scripts/systemd/` 是空目录）。现已提取成正式文件。

关键改动及原因：

| 配置 | 原值 | 新值 | 原因 |
|------|------|------|------|
| `Restart` | `on-failure` | `always` | 优雅退出的返回码是 **0**，`on-failure` 会把它当作「有意停止」而**永久不再拉起** |
| `Type` | `simple` | `notify` | 启用 sd_notify，systemd 才知道何时真正 ready |
| `NotifyAccess` | — | `all` | 心跳由 `systemd-notify` 子进程发出（见上文） |
| `WatchdogSec` | — | `30` | 卡死检测 |
| `TimeoutStopSec` | 默认 90 | `30` | 必须 > 15s 排空窗口；同时避免真出问题时干等 90 秒 |
| `StartLimitBurst/IntervalSec` | — | `5` / `600` | 10 分钟内失败 5 次就停止重试，避免坏构建无限重启刷爆日志 |
| `MemoryMax` / `TasksMax` | — | `4G` / `2048` | agent 会拉起 Chromium 和用户进程，没有上限时一个失控会话会 OOM 掉整台机器 |
| 加固项 | 无 | `NoNewPrivileges` / `PrivateTmp` / `ProtectSystem=full` 等 | 缩小爆炸半径 |

### ⚠️ 遗留：仍然以 root 运行

unit 里**没有**加 `User=`，与当前生产部署保持一致。
这是本系统最大的单点风险——agent 执行用户提供的 bash，等于用户代码以 root 运行。

未自动切换的原因：改 `User=` 需要同时 `chown` `data/` 和 `workspaces/`，
是一次**带停机风险**的迁移，不适合夹在本次改动里静默执行。
unit 文件里已写明具体做法，建议单独排期执行。

---

## 验证

### 单元/集成测试

`server/src/test/ops-lifecycle.test.ts`，8 条全部通过：

- 关闭任务按序执行并退出
- 某个任务抛异常时，**后续任务仍然执行**且进程仍然退出
- 重复收到信号只排空一次
- 事件循环空闲时判定健康
- 数据库探测抛异常时 readiness 为 false
- 数据库正常时 readiness 为 true
- **回归守卫**：用子进程复现「只 flush 不 exit 的 SIGTERM 监听器导致进程不退出」
- 对照组：handler 里调用 `process.exit` 时进程立即退出

### 真实运行验证

实际构建并启动服务后：

| 项目 | 结果 |
|------|------|
| `/health` | 200，含 `eventLoopLagMs` |
| `/health/ready` | 200，DB / 会话管理器 / 内存全部上报 |
| `/api/ops/update/status` 未认证 | **401**（符合预期） |
| **SIGTERM → 退出** | **退出码 0，耗时 0.23 秒** |

对比改动前：SIGTERM 后进程存活，直到 90 秒 `TimeoutStopSec` 超时被 SIGKILL。

关闭日志：

```
[lifecycle] shutdown started (SIGTERM), grace 15000ms
[lifecycle] http listener closed
[lifecycle] shutdown complete
```

---

## 排查指引

**服务反复重启**
```bash
systemctl status hy-webagent
journalctl -u hy-webagent -n 100 --no-pager
```
若日志里有 `uncaught exception` / `unhandled rejection`，说明是被 lifecycle 主动
退出的（exit 1），堆栈就在紧邻的上一行。

**被看门狗杀掉**
journalctl 会出现 `Watchdog timeout`。检查两种可能：
1. 真的卡死了 → 看最后几条日志定位阻塞点；
2. 有合法的长时间同步操作 → 调大 unit 里的 `WatchdogSec`。

**重启很慢**
先确认没有别的模块又注册了 SIGTERM 监听器：
```bash
grep -rn 'process.on("SIGTERM"\|process.on("SIGINT"' server/src/
```
应当**只有** `ops/lifecycle.ts` 一处。

**关闭时某个任务超时**
日志会出现 `shutdown task "<名字>" timed out after 5000ms — continuing`。
这不致命（排空会继续），但说明那个资源释放有问题，值得单独查。
