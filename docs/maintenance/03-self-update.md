# 03 — 自我更新能力（Self-update）设计与实现

> 目标：服务能自己拉取新代码、构建、重启、验证；
> **任何一步失败都必须自动回滚，且不能让服务停在坏版本上。**

---

## 改动前的问题

`scripts/update-server.sh` 与 `scripts/remote-update.sh` 都是同一个模式：

```bash
git reset --hard origin/main
npm run install:all
cd server && npm run build      # ← 失败时 set -e 中止，但 dist/ 已被写坏
systemctl restart hy-webagent
curl -sf .../health || exit 1   # ← 健康检查失败就直接退出，服务停在坏版本上
```

三个具体缺陷：

1. **构建失败会留下损坏的产物**。`tsc` 是**就地**写 `dist/` 的，
   中途失败会留下新旧混杂的输出。此时源码已经被 `reset --hard` 换成新版了，
   下一次崩溃重启就会启动到这堆残缺产物上。
2. **健康检查失败无回滚**。脚本 `exit 1` 走人，生产环境就停在一个
   *刚刚被观测到不健康* 的 commit 上。
3. **`sleep 2` 是竞态**。启动慢一点就误判失败。

另外 `remote-update.sh` 还依赖 `sshpass` + root 密码明文存在 `deploy.env` 里，
密码会出现在本地 `ps` 输出中。

---

## 设计原则

| 原则 | 具体做法 |
|------|---------|
| 构建失败**绝不能**影响在跑的服务 | 先完整构建，**成功后**才碰服务 |
| 健康检查失败**必须**回到已知good版本 | 保留上一个 commit + dist 备份，失败即还原 |
| 两次更新**绝不能**交叠 | flock（Linux）/ 原子 mkdir（回退方案） |
| 更新进程**必须**活过它触发的重启 | `setsid` + `detached` + `unref` |
| 崩溃的更新**必须**可从外部诊断 | 每个阶段写 `data/update-status.json` |

---

## 组件一：`scripts/self-update.sh`

### 执行流程

```
加锁 (flock / mkdir)
  ↓
检查工作区是否干净 ── 脏 → 退出码 2（拒绝覆盖他人未提交的改动）
  ↓
git fetch + 比对 commit ── 无更新 → 退出码 0
  ↓
备份 server/dist、client/dist → data/update-backup/
  ↓
git checkout 目标 commit
  ↓
构建（install:all → server build → client build）
  │
  ├─ 失败 → 还原源码 + 还原 dist → 退出码 1
  │         【服务全程未被触碰，零停机】
  ↓
systemctl restart
  ↓
轮询 /health，最多 HEALTH_TIMEOUT 秒（默认 90，逐秒重试而非 sleep 2）
  │
  ├─ 不健康 → 还原源码 + 还原 dist → 再次 restart → 再次验证
  │            ├─ 恢复成功 → 退出码 1（明确告知「已回滚，服务健康」）
  │            └─ 仍不健康 → 退出码 2（明确告知「服务 DOWN」，不谎称已修复）
  ↓
清理备份 → 退出码 0
```

### 退出码约定

| 码 | 含义 |
|----|------|
| 0 | 更新成功，或本来就是最新 |
| 1 | 失败，**已回滚**，服务健康 |
| 2 | 失败且**服务处于异常状态**（工作区脏 / 回滚后仍不健康）→ 需要人工介入 |

区分 1 和 2 很重要：1 可以静默重试，2 必须告警。

### 几个实现细节

**锁**：`flock(1)` 属于 util-linux，macOS/BSD 上没有。
最初的写法 `if ! flock -n 9` 在 flock 缺失时会因 "command not found" 返回非零，
被当成「锁已被占用」而**静默跳过所有更新**——这是 fail-open 成 no-op，很危险。
现在改为：显式探测 flock 是否存在，不存在则退回到原子 `mkdir` 锁，
并带 pid 存活检测以回收被强杀留下的死锁。

**构建命令用 `npm run build` 而非 `npx vite build`**：
`npx` 在本地没有 vite 时会**联网下载**，让构建既不确定又依赖 registry 可达性——
偏偏是在最不该出问题的时刻。（此问题是在实测中暴露的。）

**状态文件原子写入**：先写 `.tmp` 再 `mv`，读者不会看到半个文件。

### 实测验证

在临时 git 仓库中构造场景验证：

| 场景 | 结果 |
|------|------|
| 无更新可用 | ✅ 正确识别，状态写 `idle`，未做任何改动 |
| **构建失败** | ✅ 源码回滚到原 commit、`dist/` 恢复为备份内容、**服务未被重启** |
| 锁不可用（macOS 无 flock） | ✅ 自动退回 mkdir 锁（修复前会静默跳过更新） |

---

## 组件二：`server/src/ops/updater.ts`

Node 侧只做两件事，其余全部留在脚本里——**这是刻意的**：
更新脚本必须活过它自己触发的那次重启，所以不能实现成进程内逻辑。

### `triggerUpdate()`：为什么必须 detached

```ts
const useSetsid = process.platform === "linux";
spawn(useSetsid ? "setsid" : "bash", args, { detached: true, stdio: "ignore" });
child.unref();
```

调用链是「Node 进程 → 更新脚本 → `systemctl restart` → 杀掉 Node 进程」。
如果子进程还在原进程组里，它会在自己触发的重启中被一起干掉，
更新就停在半路（源码已换、构建到一半、服务已停）。
`setsid` 让它成为新会话的首进程，从而幸存。

stdio 全部丢弃不影响可观测性：脚本自己写 `data/logs/self-update.log`，
状态走 `data/update-status.json`。

### `isInFlight()`：避免永久卡死

只看状态文件里的 phase 是不够的——被 OOM 杀掉的更新会把文件永远停在 `building`，
从此再也无法更新。因此双重判定：

1. 状态里有 pid → `process.kill(pid, 0)` 探测进程是否还活着；
2. 没有 pid → 用 1 小时的时效上限兜底。

### `checkForUpdate()`：只读

用 `git ls-remote` 而不是 `git fetch`，保证「查询是否有更新」这个只读操作
永远不会修改本地 ref。

---

## 组件三：`/api/ops/*` 路由

全部 **admin only**（`authMiddleware` + `requireAdminRole`）。
只读接口也要鉴权：commit hash 和更新历史属于部署情报，
`/health` 已经覆盖了未认证调用方（负载均衡器）合理需要的信息。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/ops/update/status` | 当前 commit + 是否在更新中 + 上次结果 |
| GET | `/api/ops/update/check` | 远端是否更新（只读，不 fetch） |
| POST | `/api/ops/update/apply` | 触发更新，返回 **202**；传 `{"dryRun":true}` 只检测不执行 |

`apply` 返回 202 而非 200：更新会活过当前进程，这里没有「完成」可等，
客户端应轮询 `status`。

用法：

```bash
TOKEN=<admin session or API key>
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3001/api/ops/update/check
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{"dryRun":true}' http://127.0.0.1:3001/api/ops/update/apply
```

实测：未认证访问 `/api/ops/update/status` 返回 **401**。

---

## 组件四：定时更新（可选）

`scripts/systemd/hy-webagent-update.{service,timer}`

- **独立于 `hy-webagent.service`**：更新会重启主服务，
  若跑在它的 cgroup 里就会被自己触发的重启杀掉。
- 默认每天 04:00 + 最多 30 分钟随机延迟（`RandomizedDelaySec`），
  避免多机同时更新，也让重启时刻不可外部预测。
- `Persistent=true`：错过的时间点在下次开机补跑。
- `Restart=no`：失败由脚本自己处理（已回滚），重试只会重复同一个失败的构建。

**默认不自动安装。** 自动更新一个跑用户 agent 的服务是有取舍的：
它能快速关闭漏洞窗口，但也意味着 main 上一个未经审查的 commit 能重启生产。
好在更新是健康门控 + 自动回滚的，最坏情况是「短暂重启后回到上一版本」，
而不是长时间不可用。

---

## 排查指引

**看当前状态**
```bash
cat /opt/hy-webagent/data/update-status.json
tail -50 /opt/hy-webagent/data/logs/self-update.log
```

**更新卡住不动**
```bash
# 确认脚本是否真在跑
ps aux | grep self-update
# 状态文件里的 pid 若已不存在，isInFlight() 会自动放行下一次更新
```

**手动预演（不改动任何东西）**
```bash
DRY_RUN=1 bash /opt/hy-webagent/scripts/self-update.sh
```

**手动回滚到指定 commit**
```bash
cd /opt/hy-webagent
git reset --hard <commit>
npm run install:all && (cd server && npm run build) && (cd client && npm run build)
systemctl restart hy-webagent
curl -sf http://127.0.0.1:3001/health
```

**更新被拒绝：工作区脏**
退出码 2 且日志为 `working tree is dirty`。这是有意的保护——
生产机上有人直接改了文件。先 `git status` 看清楚再决定保留还是丢弃。
