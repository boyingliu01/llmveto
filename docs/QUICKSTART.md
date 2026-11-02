# llmveto 快速上手指南（内部试用版）

> **适用对象**：参与内部试用的同事  
> **版本**：v0.3.0（v2a detection core）  
> **预计耗时**：5-10 分钟完成配置

---

## 1. 前置条件

- ✅ **Node.js ≥ 18**（推荐 Node 20+）
- ✅ **OpenCode v2** 或 **XP-Gate Delphi**（二选一即可）
- ✅ **example-provider API key**（用于访问 LLM 网关）

**检查环境**：
```bash
node --version    # 应 ≥ 18
opencode --version  # 如使用 OpenCode
```

---

## 2. 安装（三选一）

### 方式 A：从 npm 安装（推荐，最简单）

```bash
npm install -g llmveto@latest
```

### 方式 B：从源码构建（开发模式）

```bash
git clone https://github.com/boyingliu01/llmveto.git
cd llmveto
bun install
bun run build
npm link   # 全局链接
```

### 方式 C：直接运行（不安装，仅测试）

```bash
git clone https://github.com/boyingliu01/llmveto.git
cd llmveto
bun install
# 后续所有命令用 bun run src/cli/index.ts 代替 llmveto
```

---

## 3. 配置上游 LLM

设置你的 example-provider API endpoint：

```bash
# 方式 1：环境变量（推荐）
export LLMVETO_UPSTREAM_BASE_URL=https://internal-gateway.invalid/redacted

# 方式 2：多路由表（高级用户）
export LLMVETO_UPSTREAMS='[{"provider":"openai","baseURL":"https://api.openai.com"},{"provider":"anthropic","baseURL":"https://api.anthropic.com"}]'
```

---

## 4. 启动网关

```bash
# 启动后台守护进程
llmveto start

# 查看状态
llmveto status
# 输出示例：
# Gateway running (pid=12345)
# URL: http://127.0.0.1:8787
# Evidence dir: C:\Users\<user>\.llmveto\evidence\
```

**默认监听地址**：`http://127.0.0.1:8787`（仅本机可访问，安全）

---

## 5. 接入你的 AI 客户端

### 5.1 OpenCode 用户

**自动配置**（推荐）：
```bash
llmveto doctor --write-managed-config
```

这会自动修改 `~/.config/opencode/opencode.json`，将 provider baseURL 指向网关。

**手动配置**（如需精细控制）：
编辑 `~/.config/opencode/opencode.json`，在 provider 配置中添加：
```json
{
  "provider": {
    "example-provider": {
      "options": {
        "baseURL": "http://127.0.0.1:8787/opencode/openai"
      }
    }
  }
}
```

### 5.2 XP-Gate Delphi 用户

**自动配置**：
```bash
llmveto doctor --write-managed-config
```

这会修改 `.delphi-config.json` 中的 endpoint 字段。

**手动配置**：
编辑项目根目录的 `.delphi-config.json`：
```json
{
  "profiles": {
    "default": {
      "providers": {
        "example-provider": {
          "base_url": "http://127.0.0.1:8787/gateway"
        }
      }
    }
  }
}
```

---

## 6. 验证配置

```bash
# 检查配置是否正确覆写
llmveto doctor

# 发送测试请求（通过网关）
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "g-deepseek-flash",
    "messages": [{"role": "user", "content": "Hello from llmveto!"}]
  }'
```

预期返回：正常的 LLM 响应 + evidence 文件中新增一条记录。

---

## 7. 查看证据链

```bash
# 查看最近的证据记录
ls ~/.llmveto/evidence/ | tail -5

# 验证证据链完整性
llmveto verify

# 输出示例：
# Chain OK: 15 records verified
# First seq: 1, Last seq: 15
# No tampering detected
```

---

## 8. 停止网关

```bash
llmveto stop
```

---

## 9. 故障排查

### 问题 1：网关启动失败

```bash
# 查看详细错误
llmveto start --verbose

# 常见原因：
# - 端口 8787 已被占用 → 改端口：export LLMVETO_PORT=8788
# - 上游 URL 未设置 → 执行步骤 3
```

### 问题 2：AI 客户端无法连接

```bash
# 检查配置是否生效
llmveto doctor

# 检查网关是否运行
llmveto status

# 手动测试连通性
curl http://127.0.0.1:8787/health
```

### 问题 3：请求被阻断

查看 evidence 文件中的 `action_taken` 字段：
- `blocked_before_forward`：请求侧检测到凭据泄露风险
- `blocked_before_deliver`：响应侧检测到隐形字符
- `terminated_after_delivery`：流式响应中途终止

**这是正常的安全行为**，说明网关在工作。如需调整策略，请联系项目维护者。

---

## 10. 反馈渠道

遇到问题或有改进建议？请：

1. **GitHub Issues**：https://github.com/boyingliu01/llmveto/issues
2. **内部反馈表**：[填写在线表单](TODO: 插入内部反馈表链接)
3. **直接联系**：@boyingliu01（GitHub / 企业微信）

**反馈时请提供**：
- `llmveto doctor` 输出
- `llmveto status` 输出
- 最近 5 条 evidence 记录（脱敏后）
- 问题复现步骤

---

## 附录：核心能力速览

| 能力 | v1 | v2a（本次试用） |
|------|----|----------------|
| 凭据出境拦截 | ✅ | ✅ |
| 隐形字符检测 | ✅ | ✅（跨 chunk + 转义还原） |
| 模型字段一致性告警 | ✅ | ✅ |
| tool-call 结构判定 | ❌ | ✅ **新增** |
| thinking 签名检测 | ❌ | ✅ **新增** |
| usage 对账 | ❌ | ✅ **新增** |
| 金丝雀回流检测 | ❌ | ✅ **新增** |
| evil-relay 模拟检测 | ❌ | ✅ **新增**（13 种对手） |

**完整威胁模型**：见 [docs/issues/1-req-threat-model.md](issues/1-req-threat-model.md)
