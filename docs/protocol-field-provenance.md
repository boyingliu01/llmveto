# 受管字段来源可追溯表（v2b-A）

> 本表是 REQ-V2bA-12 的交付物。每一个受管字段都必须能回答三件事：
> **哪个客户端**、**读哪份官方文档的哪一句**、**哪天核对的**。
> 本机三个客户端都未安装（见 KNOWN-ISSUES），所以字段来源只能是文档——
> 那正是它必须逐条留痕的原因。

核对日期：**2026-11-24**（全部在同一天拉取官方文档原文核对）。

## Claude Code

| 受管字段 | 文档 | 原文（摘录） | 说明 |
|---|---|---|---|
| `settings.json` → `env.ANTHROPIC_BASE_URL` | https://code.claude.com/docs/en/settings-reference | `### env` 一节的示例：`{ "env": { "DISABLE_AUTO_COMPACT": "1", "ANTHROPIC_BASE_URL": "https://proxy.example.com" } }` | settings 的 `env` 覆盖 shell 同名变量 |
| 凭据变量 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` | https://code.claude.com/docs/en/llm-gateway-connect | `Auth token or API key: a line naming ANTHROPIC_AUTH_TOKEN, ANTHROPIC_API_KEY, or an apiKeyHelper confirms a gateway credential is active` | **不纳管**：由用户自备，适配器不写不读 |
| 协议端点 `POST {base}/v1/messages` | https://code.claude.com/docs/en/llm-gateway-protocol | `Anthropic Messages — ANTHROPIC_BASE_URL — /v1/messages, /v1/messages/count_tokens (optional)`；另有 `Inference requests post to /v1/messages?beta=true` | 路由透传须保留 `?beta=true` |

## Codex

| 受管字段 | 文档 | 原文（摘录） | 说明 |
|---|---|---|---|
| `config.toml` → `model_providers.<id>.base_url` | https://developers.openai.com/codex/config-reference | `"API base URL for the model provider."` | base_url 按 Responses 语义已含 `/v1` |
| `config.toml` → `model_providers.<id>.wire_api` | 同上 | `"Protocol used by the provider. responses is the only supported value, and it is the default when omitted."` | 把它一并纳管，是为了发现用户改成别的格式 |
| 配置文件位置 `~/.codex/config.toml` | https://developers.openai.com/codex/config-basic | `Codex stores user-level configuration at ~/.codex/config.toml` | |

## promptfoo

| 受管字段 | 文档 | 原文（摘录） | 说明 |
|---|---|---|---|
| 项目配置 `providers[].config.apiBaseUrl` | https://www.promptfoo.dev/docs/providers/openai/ | `Set apiBaseUrl for an OpenAI-compatible gateway ... apiBaseUrl includes the API prefix, such as /v1, but not /chat/completions or /responses` | 必须用 `apiBaseUrl`：`apiHost` 只拼 `https://<host>/v1` |
| 覆盖优先级 | 同上 | `Promptfoo checks config.apiHost, then config.apiBaseUrl, then the endpoint environment variables listed below` | `apiHost` 优先于 `apiBaseUrl` → 出现 `apiHost` 即报 unmanaged |
| 默认配置文件 | https://www.promptfoo.dev/docs/usage/command-line/ | `By default the eval command will read the promptfooconfig.yaml configuration file in your current directory` | 项目级，故默认只报告、写入需 opt-in |

## 依赖元数据

| 依赖 | 版本 | 许可 | 运行时依赖数 | 用途 |
|---|---|---|---|---|
| `smol-toml` | `1.9.1`（精确版本，非区间） | BSD-3-Clause | 0 | 仅用于**定位** Codex TOML 里的目标键；写回是定点编辑，不做 stringify |

## 已知局限

- 以上全部来自**文档**，没有来自"在本机观察到的真实客户端配置"。三个客户端都未安装。
- 客户端版本演进可能改变字段形态；本表据此过期。`doctor` 会报漂移，不会静默通过。
