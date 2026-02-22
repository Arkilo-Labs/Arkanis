# Runtime Sandbox Policy

当前 sandbox 环境的访问策略，所有操作必须在此范围内执行。

| 字段 | 值 |
|------|----|
| sandbox_mode | {{sandbox_mode}} |
| workspace_access | {{workspace_access}} |
| network_policy | {{network_policy}} |
| exec_approvals | {{exec_approvals}} |

## sandbox_mode 说明

- `strict`：只允许读取 workspace_root 内的文件；禁止外部网络访问；禁止 sandbox.exec
- `research`：允许 file.read + httpFetch（白名单域名）；禁止 sandbox.exec 和 file.write
- `execute`：允许完整 sandbox.exec；写入范围限于 workspace_root；网络策略遵从 network_policy

## workspace_access 说明

- `readonly`：所有写入操作（file.write / file.patch / artifact.write_text）将被 ToolGateway 拒绝
- `readwrite`：可在 workspace_root 内读写文件

## network_policy 说明

- `none`：禁止所有出站网络请求
- `allowlist`：只允许 exec_approvals 中列出的域名
- `open`：允许所有出站请求（仅限 research sandbox_mode）

## 违规处理

任何违反上述策略的工具调用将由 ToolGateway 返回 ERR_POLICY_DENIED，必须按照 tooling.md 中的错误处理规则处理，不得重试或绕过。
