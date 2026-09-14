param(
    [ValidateSet('A', 'B', 'C')] [string]$Expert = 'A',
    [ValidateSet('r1', 'r2', 'r3')] [string]$Round = 'r3'
)

# Delphi 专家团调用封装。
# 关键坑（见 docs/delphi-panel.md）：PowerShell 默认按 GBK 解码子进程 UTF-8 stdout，
# 中文报告会落成不可逆乱码（含 '?' 替换）。必须在捕获前改 console 编码。
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$agents = @{
    'A' = 'delphi-reviewer-architecture'   # g-deepseek-flash  (DeepSeek)
    'B' = 'delphi-reviewer-technical'      # g-glm-5.3-flash   (智谱)
    'C' = 'delphi-reviewer-feasibility'    # g-qwen3.8-flash   (阿里)
}

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$qfile = Join-Path $root ".sprint-state/review/$Round-questionnaire.md"
$outfile = Join-Path $root ".sprint-state/review/$Round-expert-$Expert.md"

if (-not (Test-Path $qfile)) { throw "questionnaire not found: $qfile" }

$preamble = @"
在工作目录 $root 下执行任务。

第一步：用文件读取工具完整读取 $qfile，这是本轮评审卷，其中的输出格式与判据是硬约束。
第二步：按评审卷「你必须阅读的文件」清单逐个读取待评审文档。
第三步：严格按评审卷第六节要求的结构输出你的独立评审意见。

不要向用户提问，不要请求确认，一次性输出完整结论。
"@

$prompt = $preamble + "`n`n---`n`n" + (Get-Content -Raw $qfile)

Write-Host "[$Expert -> $($agents[$Expert])] running..." -NoNewline
$start = Get-Date

# --agent 必须为 mode:all，否则 opencode 静默回落到 default agent（评审人格与模型双双失真）
$output = $prompt | opencode run --agent $agents[$Expert] --format default 2>&1 | Out-String
$exit = $LASTEXITCODE

$elapsed = [int]((Get-Date) - $start).TotalSeconds
[System.IO.File]::WriteAllText($outfile, $output.TrimStart([char]0xFEFF), (New-Object System.Text.UTF8Encoding($false)))

$bytes = (Get-Item $outfile).Length
$fallback = if ($output -match 'Falling back to default agent') { 'FALLBACK-DETECTED' } else { 'no-fallback' }
$verdict = if ($output -match '"verdict"\s*:\s*"([A-Z_]+)"') { $Matches[1] } else { 'NOT-FOUND' }

Write-Host " done ${elapsed}s, exit=$exit, $bytes bytes -> $outfile"
Write-Host "   agent-fallback: $fallback | verdict: $verdict"

if ($bytes -lt 2000) { Write-Warning "输出过小（$bytes 字节），疑为失败或空答，请检查文件内容" }
if ($fallback -eq 'FALLBACK-DETECTED') { Write-Error "agent 回落！本轮结果不可信，须修正 opencode.json 后重跑" }
