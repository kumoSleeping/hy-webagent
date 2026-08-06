# 04 — 会话分享令牌（Session Share Token）

> 当前行为：登录用户必须在 Command 中执行 `Enable public access`，普通会话的
> 完整页面 URL（`/chat/<piSessionId>`）才会成为公开的只读链接。未登录访客
> 打开已开启的链接时会进入预览模式，无法发送消息或执行写入操作。
> 本文档同时保留早期显式令牌接口的说明，供旧的 `/preview/:id?share=…`
> 链接继续使用。

---

## 普通页面 URL 分享

在当前会话的 Command 中执行 `Enable public access` 后，把地址栏中的
`/chat/<piSessionId>` 发给别人，对方无需登录即可阅读完整会话（包括后续流式
更新）。每个开启状态由会话所有者持久化记录；没有该记录的普通会话 URL 会被
未登录访客拒绝。服务端只接受完整 UUID，拒绝部分 ID、路径穿越和无效格式；访客
WebSocket 一律标记为 `view=1`，服务端会拒绝 prompt、steer、follow-up、终止、
Slash 命令和扩展 UI 回应等所有写入消息。开启后 Command 会改为
`Disable public access`；再次执行即可关闭普通 URL 的访客访问。

所有新会话默认关闭此访问权限。未登录访客打开未开启会话的普通 URL 时，客户端
会直接保留在登录页，而不会建立或重试访客 WebSocket 连接。

这是一项有意的公开分享策略：**任何获得完整 URL 的人都能阅读该会话**。不要
把包含敏感内容的会话 URL 发送给不应查看的人。

## 旧版显式令牌

令牌仍是旧版 `/preview/:id?share=…` 链接的凭证，并且可撤销和过期。
它不再是普通 `/chat/:id` URL 的访问门槛；普通 URL 则由 `Enable public access`
命令创建的会话访问记录控制。除已开启的普通页面 URL 外，访客也仍可通过下列
两种方式打开旧链接：

1. 会话通过**已启用的 bot 频道**发布（原有能力，不变）；
2. 调用方持有所有者为**该会话**签发的、未撤销未过期的**分享令牌**。

---

## 数据模型

`server/src/db/session-share-repository.ts`，表 `session_shares`
（`CREATE TABLE IF NOT EXISTS`，随服务启动自动建表，无需手动迁移）。

| 字段 | 说明 |
|------|------|
| `token_hash` | **主键**，令牌的 SHA-256，明文不落库 |
| `pi_session_id` | 该令牌绑定的会话 |
| `owner_user_id` | 签发者，撤销时据此鉴权 |
| `created_at` / `expires_at` / `revoked_at` | 生命周期 |
| `last_viewed_at` / `view_count` | 访问审计 |

### 两个设计决定

**令牌 256 位（`randomBytes(32)`，base64url）**
访客链接是未认证的，**令牌本身就是凭证**，必须不可枚举。

**只存 SHA-256，不加盐**
和口令不同：输入是 256 位 CSPRNG 输出，没有字典可枚举、没有彩虹表可查，
加盐没有收益。哈希存储的意义在于——**能读到数据库的人，拿不到可用的分享链接**。
明文只在创建响应里返回一次，此后不可找回。

---

## 接口

均需登录，且**只能操作自己的会话**（`assertOwnership`：先查活跃会话表，
再回落到调用者自己 workspace 下的会话文件——后者天然是按所有者隔离的）。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/sessions/:id/share` | 签发链接，返回 201。可传 `{"ttlMs": …}`，默认 7 天，上限 90 天 |
| GET | `/api/sessions/:id/share` | 查询是否已分享、过期时间、访问次数（**不返回令牌**） |
| DELETE | `/api/sessions/:id/share` | 撤销该会话的全部链接 |

创建响应：

```json
{
  "token": "…",
  "expiresAt": 1785653343000,
  "path": "/preview/<piSessionId>?share=<token>",
  "note": "Copy this link now — the token is not retrievable later."
}
```

几点说明：

- **一个会话同时只有一个有效链接**：再次签发会先撤销旧的。
  这样「链接传得比预期更远」时可以**替换**而不只是叠加。
- 返回**相对路径**：调用方知道自己的 origin，服务端不该把可能不对的公网域名写死进链接。
- `ttlMs` 有 90 天上限：无限期的公开链接是长期负债。

---

## 访客侧流程

```
浏览器打开  /preview/<piSessionId>?share=<token>
   ↓
客户端进入访客模式，WS 连接带上 share 参数：
   /ws/chat?view=1&piSessionId=<id>&share=<token>
   ↓
服务端 authorizeGuestView(piSessionId, share)
  ├─ 是已启用 bot 频道发布的会话？ → 放行，owner = bot 账号
  ├─ 令牌有效 且 share.piSessionId === piSessionId？ → 放行，owner = 签发者
  ├─ 所有者已启用该会话的普通聊天页访问？ → 放行，只读
  └─ 否则 → socket.destroy()
```

**令牌与会话强绑定**：`share.piSessionId === piSessionId` 这个比较是必须的，
否则一个合法令牌就能拿去解锁另一个会话。

### 顺带修掉的跨 workspace 扫描

授权通过后我们**知道所有者是谁**，因此历史记录改为只在该所有者的 workspace 里查：

```ts
ownerSessionsDir = join(isolator.getUserWorkspace(guestOwnerUserId), ".pi", "sessions");
const history = await findSessionHistoryOnDisk(piSessionId, ownerSessionsDir);
```

原先的 `findSessionHistoryOnDisk` 会遍历**所有**用户目录——正是它把「猜到一个 id」
放大成「读到任意租户的记录」。多目录扫描现在只作为所有者未知时的兜底路径保留。

---

## 使用示例

```bash
TOKEN=<你的登录 sessionId>
SID=019f1104-1cf9-7d93-a733-eb4e4f5be525

# 签发（默认 7 天）
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{"ttlMs": 86400000}' \
     https://chat.kumo.ltd/api/sessions/$SID/share

# 查看状态（不含令牌）
curl -H "Authorization: Bearer $TOKEN" https://chat.kumo.ltd/api/sessions/$SID/share

# 撤销
curl -X DELETE -H "Authorization: Bearer $TOKEN" https://chat.kumo.ltd/api/sessions/$SID/share
```

---

## 验证

`server/src/test/session-share.test.ts`，11 条全部通过：

- 新签发的令牌可解析到正确的会话与所有者
- 令牌唯一且长度足够
- **明文不落库**（库里是 64 位十六进制哈希，且不等于明文）
- 未知令牌 / 空令牌被拒
- 已撤销令牌被拒
- **非所有者撤销无效**（`revokeAllForSession` 返回 0，令牌仍有效）
- 过期令牌被拒
- 令牌与单一会话绑定
- 列表只返回有效授权
- 访问计数与最后访问时间
- 撤销/过期记录可被 `prune()` 清理

运行时验证：三个分享接口未认证均返回 **401**；
`session_shares` 表随服务启动自动创建，与既有表共存。

---

## 排查指引

**分享链接打不开**

按顺序排查：

1. URL 里是否带了 `?share=`？（只有 `/preview/:id` 而没有令牌 → 除非是 bot 会话，否则会被拒）
2. 令牌是否已过期或被撤销？用所有者身份 `GET /api/sessions/:id/share` 看 `shared` 字段。
3. 服务端日志：`ws upgrade rejected: session is not publicly viewable`。

**想确认某个会话被看了多少次**

```bash
curl -H "Authorization: Bearer $TOKEN" .../api/sessions/$SID/share
# 返回里的 viewCount / lastViewedAt
```

**清理历史记录**

`SessionShareRepository.prune()` 会删除撤销/过期超过 30 天的记录。
目前**没有**定时调用它——记录量很小，如需自动清理可挂到会话清理定时器上。

---

## 已知限制

- 令牌通过 URL query 传递，会出现在浏览器历史和（若有）反向代理访问日志中。
  这是分享链接的固有性质；缓解手段是默认 7 天过期 + 可随时撤销。
- 目前**没有前端 UI**，只有 API。前端加「分享」按钮时直接调上述三个接口即可。
- 分享是**整个会话**的粒度，不支持只分享部分消息。
