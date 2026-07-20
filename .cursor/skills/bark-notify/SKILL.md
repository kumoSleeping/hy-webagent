---
name: bark-notify
description: >-
  Send a Bark push to the user's iPhone when a long-running task finishes.
  Use after deploy, lengthy debugging, multi-step refactors, or any work that
  took more than a few minutes — so the user can put the chat aside and get
  notified when results are ready.
---

# Bark 长任务推送

长任务（部署、大改、长时间排查等）结束后，用 Bark 推一条短通知，不要等用户回来翻聊天。

```bash
# https://api.day.app/<device_key>/<title>/<body>  （URL 编码中文）
KEY=m6P3MRAmkUw5qUDVBez5y6
TITLE=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "任务标题")
BODY=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "一两句结果摘要")
curl -sS "https://api.day.app/${KEY}/${TITLE}/${BODY}"
```

标题写清项目/事项，正文写结论或下一步（一两句即可）。
