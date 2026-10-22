# API 与事件协议草案

目标 API，除 GET /api/status 外均未实现。真实 MCP 请求字段须通过实际 tools/list 获取，不在本文猜测。

## REST

| 方法/路径 | 作用 | 权限/版本 |
| --- | --- | --- |
| POST /api/rooms | 创建房间和 host 会话 | 创建限制，服务端生成 ID |
| POST /api/rooms/:id/join | 通过有效邀请加入 | 邀请有效、未满员、未关闭 |
| GET /api/rooms/:id | 返回按当前成员权限裁剪的快照 | 成员 |
| PATCH /api/rooms/:id/me/preferences | 修改本人偏好 | 本人，expectedRevision |
| PATCH /api/rooms/:id/settings | 人数上限/付款策略 | host，expectedRevision；付款承诺仍需本人确认 |
| POST /api/rooms/:id/votes | 开启候选投票 | host，候选未过期，expectedRevision |
| PUT /api/rooms/:id/votes/:round/me | 投票或改票 | 本人会话，轮次有效且未揭晓；禁止传入他人身份 |
| GET /api/rooms/:id/votes/:round | 本人票/公开计数 | 未揭晓只返回本人票和参与数，揭晓只公开汇总 |
| POST /api/rooms/:id/votes/:round/adopt | 采用最高票方案 | host，平票显式选定，不自动确认 |
| POST /api/rooms/:id/plans | 生成候选 | host，expectedRevision，任务去重 |
| POST /api/rooms/:id/proposals | 提出候选 | host，expectedRevision，quote 未过期 |
| POST /api/rooms/:id/confirmations | 确认当前方案 | 本人，proposalVersion，expectedRevision |
| DELETE /api/rooms/:id/me/confirmation | 撤销本人确认 | 本人，expectedRevision |
| POST /api/rooms/:id/reprice | 最终核价 | host，全员已确认 |
| POST /api/rooms/:id/checkout | 建单并获取官方交接信息 | host，明确确认，幂等键，最新版本 |
| GET /api/rooms/:id/events | SSE 变更通知 | 成员；支持 Last-Event-ID |
| GET /api/rooms/:id/receipt | 已确认餐单/分账 | 成员；不含凭证与个人账户信息 |
| GET /api/status | 当前应用能力声明 | 本轮已实现，不暴露凭证配置 |

## 命令示例（应用自身契约，不是麦当劳 MCP 参数）

```json
{
  "expectedRevision": 12,
  "preferences": {
    "budgetCents": 3000,
    "main": "chicken",
    "drink": "coffee",
    "fries": "nice",
    "acceptsSharing": true
  }
}
```

成功返回新 revision 和当前成员可见快照。请求中不信任 memberId 指定身份，由会话推导。服务端验证整数金额范围、枚举、数量、文本长度、room 归属和状态；不能只依赖前端校验。

## 错误语义

400 INVALID_INPUT；401 SESSION_REQUIRED；403 FORBIDDEN；404 ROOM_NOT_FOUND；409 REVISION_CONFLICT / ROOM_FULL / PROPOSAL_STALE；410 ROOM_EXPIRED；422 NO_FEASIBLE_PLAN；429 RATE_LIMITED；502 PROVIDER_ERROR；503 LIVE_NOT_CONFIGURED；504 PROVIDER_TIMEOUT。

统一错误体包含 code、message、requestId 和可安全展示的 details。不得附带 Authorization、个人地址或原始供应商错误正文。核价失败和无解是不同错误。

## 事件

member.joined、member.left、preference.updated、payment.updated、vote.started、vote.progress、vote.closed、vote.adopted、planning.started、planning.completed、proposal.changed、confirmation.changed、quote.expired、checkout.updated、room.closed。投票事件不包含成员与选项的对应关系，也不在揭晓前包含中间票数。

```json
{
  "sequence": 41,
  "type": "proposal.changed",
  "roomRevision": 14,
  "payload": { "proposalVersion": 3 }
}
```

事件是更新提示；接收方按权限拉取最新快照。SSE 只读；客户端通过 HTTP 命令写入。首版先采用快照通知，后续确有需要再实现增量 patch。

## 下单幂等

应用 idempotencyKey 唯一约束绑定 room + proposal + attempt。先持久化 pending，再调用供应商。只有官方支持幂等字段并已验证时才传入。没有供应商幂等保证时，应用不能承诺网络故障下 exactly-once；超时标为 unknown，查询/人工确认后再处理，禁止自动重放。
