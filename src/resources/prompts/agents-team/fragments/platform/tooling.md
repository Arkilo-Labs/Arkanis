# Platform Tooling Protocol

## ToolGateway 调用协议

所有工具调用必须通过 ToolGateway，格式如下：

```json
{
  "type": "tool_use",
  "id": "<tool_use_id>",
  "name": "<tool_name>",
  "input": { "<param>": "<value>" }
}
```

规则：
- tool_name 必须与 allowedTools 清单中的条目完全匹配（大小写敏感）
- input 字段必须符合该工具的参数 schema，不得传入未定义字段
- 每次调用必须等待工具返回结果后再决定下一步，禁止推测或假设工具的返回值

## 并发规则

- 同一 task_id 在同一时刻只能由一个 agent 持有 lease_token 并操作
- 禁止在未收到前一个工具调用响应时发起另一个写入类工具调用（file.write / artifact.write_text / taskBoard.completeTask 等）
- 只读类工具（file.read / artifact.hash）可在等待写入响应期间并行调用

## 错误处理规则

- 工具返回错误时，必须读取 error.code 字段后再决策，禁止忽略错误直接继续
- ERR_LOCK_CONFLICT：等待后重试（最多 2 次），仍失败则投递 type=conflict 消息说明锁冲突
- ERR_LEASE_EXPIRED：停止操作，投递 type=update 消息说明 lease 已失效，等待 Lead 重新分配
- ERR_POLICY_DENIED：记录拒绝原因到 Mailbox（type=update），不得绕过或降级处理
- 网络/超时错误：最多重试 2 次，仍失败则 failTask（failure_class=retryable）

## 证据引用强制要求

- 任何声明某事为真（assertion）时，必须在消息的 claims 字段中附带至少一条 evidence（artifact_id 或文件路径）
- 格式：`{ "claim": "...", "evidence": ["artifact_id#L10-L20", "path/to/file.json"] }`
- 没有 evidence 的强断言（assertion_strength=high）会被 Auditor 标记为 conflict
