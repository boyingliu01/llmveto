# 将 Delphi 评审专家团固定到 example-provider 的三个 flash 模型，并补齐缺失的模型声明。
# 幂等：重复执行结果一致。执行前已由调用方备份 opencode.json.bak.delphi-<date>
$ErrorActionPreference = 'Stop'
$path = "C:\Users\admin\.config\opencode\opencode.json"
$c = Get-Content $path -Raw

# 1) 上游存在但本地未声明的模型：g-qwen3.8-flash（/v1/models 已确认提供）
$anchor = '"local-qwen3.5-122b-a10b": {'
if ($c -notmatch [regex]::Escape('"g-qwen3.8-flash": {')) {
  $block = @'
"g-qwen3.8-flash": {
				"name": "g-qwen3.8-flash",
				"modalities": {
					"input": ["text"],
					"output": ["text"]
				},
				"options": {
					"thinking": {
						"type": "enabled",
						"budgetTokens": 8192
					}
				},
				"limit": {
					"context": 131072,
					"output": 32768
				}
			},
			"local-qwen3.5-122b-a10b": {
'@
  $c = $c.Replace($anchor, $block)
}

# 2) 专家 → 模型映射（按 agent 块定位，避免误改全局 default model）
$panel = @{
  'delphi-reviewer-architecture' = 'g-deepseek-flash'
  'delphi-reviewer-technical'    = 'g-glm-5.3-flash'
  'delphi-reviewer-feasibility'  = 'g-qwen3.8-flash'
}
foreach ($agent in $panel.Keys) {
  $model = $panel[$agent]
  $c = [regex]::Replace(
    $c,
    "(""$agent""[\s\S]*?""model"": ""example-provider/)[a-z0-9.\-]+("")",
    ('${1}' + $model + '${2}')
  )
}

# 3) subagent 无法被 `opencode run --agent` 直接调用（会回落到 default agent），
#    改为 all：既能 CLI 直调，也仍可被主 agent 当 subagent 派发。
$c = $c.Replace('"mode": "subagent",', '"mode": "all",')

# 4) 校验 JSON 合法性后才落盘（写坏会让用户整个 OpenCode 不可用）
$parsed = $c | ConvertFrom-Json
if (-not $parsed.agent.'delphi-reviewer-feasibility') { throw "agent 块在校验后丢失，放弃写入" }
[System.IO.File]::WriteAllText($path, $c, (New-Object System.Text.UTF8Encoding($false)))

Write-Output "OK — panel:"
foreach ($agent in $panel.Keys) { Write-Output ("  {0} -> example-provider/{1} (mode={2})" -f $agent, $panel[$agent], $parsed.agent.$agent.mode) }
