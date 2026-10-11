<#
  科技线对比实验 · 6 路并行运行器

  techcompare.mjs 的接口（由该脚本自己提供）：
      node scripts/techcompare.mjs [HOURS=40] [STRATEGY] [before|after]
    · STRATEGY 省略 → 三条策略；指定 → 只跑那条
    · MODE 省略 → 改前改后都跑；before / after → 只跑其一
  且它**逐行打印**：进程被掐掉也留下已有结果（这正是原来 7 小时那次最缺的）。
  before 与 after 两种模式各自单独跑都不会崩（已实测）。

  本脚本把 3 策略 × 2 组别 = 6 组拆成 6 个独立进程，每个只算自己那一组。
  · 无重复劳动，墙钟 ≈ 单组耗时（长局下收益最大）
  · 输出走 -RedirectStandardOutput 直接落文件，绕开会卡死的管道缓冲
  · 不使用 Out-File -Encoding utf8（会造成中文双编码乱码）

  用法（本机执行策略禁止 & .\x.ps1，必须带 Bypass）：
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\techcompare-parallel.ps1 -Hours 20
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\techcompare-parallel.ps1 -Hours 20 -Wait

  产物：docs\_a-<策略>.txt（改前）/ docs\_b-<策略>.txt（改后），错误看同名 .err.txt

  注：本文件必须存为 UTF-8 **带 BOM**。PS 5.1 按 ANSI 读无 BOM 的 UTF-8 会拆坏中文。
#>
param(
  [int]$Hours = 20,
  [string[]]$Strategies = @('greedy', 'trade', 'farm'),
  [int]$StaggerSeconds = 2,
  [switch]$Wait
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $root 'scripts\techcompare.mjs'
if (-not (Test-Path $script)) { throw "找不到 $script（PSScriptRoot=$PSScriptRoot）" }
Set-Location $root

$node = 'D:\nodejs\node.exe'
if (-not (Test-Path $node)) { $node = (Get-Command node).Source }

$logDir = Join-Path $root 'docs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

# techcompare 的 MODE 参数直接就是 before / after；用 _a- / _b- 前缀区分产物
$modes = @(
  @{ mode = 'before'; tag = 'a'; label = '改前(只凡18)' },
  @{ mode = 'after';  tag = 'b'; label = '改后(凡18+仙23)' }
)

$total = $Strategies.Count * $modes.Count
Write-Host "科技线对比 · HOURS=$Hours · $($Strategies -join ',') · $total 进程并行" -ForegroundColor Cyan
Write-Host "输出目录：$logDir"
Write-Host ""

$procs = @()
$n = 0
foreach ($st in $Strategies) {
  foreach ($m in $modes) {
    $outFile = Join-Path $logDir ("_{0}-{1}.txt" -f $m.tag, $st)
    $errFile = Join-Path $logDir ("_{0}-{1}.err.txt" -f $m.tag, $st)
    Remove-Item $outFile, $errFile -ErrorAction SilentlyContinue

    # 位置参数：HOURS STRATEGY MODE
    $p = Start-Process -FilePath $node `
      -ArgumentList 'scripts/techcompare.mjs', "$Hours", $st, $m.mode `
      -WorkingDirectory $root `
      -RedirectStandardOutput $outFile `
      -RedirectStandardError $errFile `
      -PassThru -NoNewWindow

    $procs += [pscustomobject]@{
      Strategy = $st; Mode = $m.label; Pid = $p.Id
      Out = $outFile; Err = $errFile; Proc = $p
    }
    Write-Host ("  启动 PID {0,-7} {1,-7} {2}" -f $p.Id, $st, $m.label)

    $n++
    if ($n -lt $total -and $StaggerSeconds -gt 0) { Start-Sleep -Seconds $StaggerSeconds }
  }
}

Write-Host ""
Write-Host "已启动 $total 个进程（6 路并行，各自只算一组）。" -ForegroundColor Green
Write-Host ""

if ($Wait) {
  Write-Host "前台等待中..." -ForegroundColor Cyan
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  foreach ($row in $procs) { $row.Proc.WaitForExit() }
  $sw.Stop()
  Write-Host ("全部结束，墙钟用时 {0:N0} 秒" -f $sw.Elapsed.TotalSeconds) -ForegroundColor Green
  Write-Host ""
  $ok = 0
  foreach ($row in $procs) {
    [void]$row.Proc.WaitForExit()
    $bytes = if (Test-Path $row.Out) { (Get-Item $row.Out).Length } else { 0 }
    if ($bytes -gt 0) { $ok++ }
    Write-Host ("[{0,-18}] {1,-7} PID {2,-7} 产出={3} 字节" -f $row.Mode, $row.Strategy, $row.Pid, $bytes)
  }
  Write-Host ""
  Write-Host "有产出的进程：$ok / $total" -ForegroundColor $(if ($ok -eq $total) { 'Green' } else { 'Yellow' })
  Write-Host ""
  Write-Host "汇总（务必 ReadAllText；PS 5.1 的 Get-Content 会把 UTF-8 读成 ANSI 乱码）：" -ForegroundColor Yellow
  Write-Host '  Get-ChildItem docs\_[ab]-*.txt | ForEach-Object { "`n===== $($_.Name) ====="; [System.IO.File]::ReadAllText($_.FullName) }'
} else {
  Write-Host "（后台运行中）查看进度：" -ForegroundColor Cyan
  Write-Host "  Get-Process node | Select-Object Id,CPU,StartTime"
  Write-Host "  产物：docs\_a-*.txt（改前）/ docs\_b-*.txt（改后）"
  Write-Host ""
  Write-Host "要停的话必须连 node 子进程一起杀，只杀 wrapper 会留下孤儿 node：" -ForegroundColor Yellow
  Write-Host '  Get-CimInstance Win32_Process -Filter "Name=''node.exe''" | Where-Object { $_.CommandLine -match ''techcompare'' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }'
}
