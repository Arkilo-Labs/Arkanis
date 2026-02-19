<#
.SYNOPSIS
  Arkanis 一键安装脚本（Windows PowerShell / PowerShell Core）
.DESCRIPTION
  功能与 install.sh 完全一致：
  1. 前置检查（docker、docker compose、git）
  2. 获取代码（git clone 或本地复制）
  3. 生成 .env + SECRETS_ENC_KEY
  4. 搜索栈选择（0-2 交互菜单）
  5. docker compose up -d --build
  6. 健康检查轮询（180s 超时）
  7. 从 compose logs 提取 setup token
  8. 输出访问地址和 setup URL
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install.ps1
  powershell -ExecutionPolicy Bypass -File install.ps1 -Dir C:\arkanis -Yes
  powershell -ExecutionPolicy Bypass -File install.ps1 -Local .\arkanis-dev -Dir C:\arkanis
#>

Param(
  [string]$Local = "",
  [string]$Dir   = "",
  [switch]$Yes,
  [switch]$Help
)

$ErrorActionPreference = "Stop"

# ── 常量 ─────────────────────────────────────────────────────────────────────

$REPO_URL         = "https://github.com/your-org/arkanis.git"
$DEFAULT_INSTALL_DIR = ".\arkanis"
$DEFAULT_PORT     = 8082
$HEALTH_TIMEOUT   = 180
$HEALTH_INTERVAL  = 5

# ── 工具函数 ──────────────────────────────────────────────────────────────────

function Info([string]$Msg)    { Write-Host "[INFO] " -ForegroundColor Cyan -NoNewline; Write-Host $Msg }
function Success([string]$Msg) { Write-Host "[OK]   " -ForegroundColor Green -NoNewline; Write-Host $Msg }
function Warn([string]$Msg)    { Write-Host "[WARN] " -ForegroundColor Yellow -NoNewline; Write-Host $Msg }
function Fail([string]$Msg)    { Write-Host "[ERR]  $Msg" -ForegroundColor Red; exit 1 }

function NeedCmd([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Fail "未找到命令: $Name"
  }
}

function RandomHex([int]$Bytes = 32) {
  $data = New-Object byte[] $Bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($data)
  return ($data | ForEach-Object { $_.ToString("x2") }) -join ""
}

function SetEnvKv([string]$File, [string]$Key, [string]$Value) {
  $lines = Get-Content -LiteralPath $File
  $prefix = "$Key="
  $found = $false
  $out = foreach ($line in $lines) {
    if ($line.StartsWith($prefix)) {
      $found = $true
      "$Key=$Value"
    } else {
      $line
    }
  }
  if (-not $found) {
    $out += ""
    $out += "$Key=$Value"
  }
  $text = ($out -join "`n") + "`n"
  [System.IO.File]::WriteAllText(
    (Resolve-Path $File).Path,
    $text,
    [System.Text.UTF8Encoding]::new($false)   # UTF-8 no BOM
  )
}

function Compose([string[]]$ComposeArgs) {
  docker compose version *> $null
  if ($LASTEXITCODE -eq 0) {
    docker compose @ComposeArgs
    return
  }
  $dc = Get-Command docker-compose -ErrorAction SilentlyContinue
  if (-not $dc) { Fail "未找到 docker compose（需要 Docker Compose v2 或 docker-compose v1）" }
  docker-compose @ComposeArgs
}

# ── 帮助 ──────────────────────────────────────────────────────────────────────

if ($Help) {
  @"
用法：
  powershell -ExecutionPolicy Bypass -File install.ps1 [选项]

选项：
  -Local <path>   从本地目录复制项目（测试用，跳过 git clone）
  -Dir   <path>   安装目录（默认：$DEFAULT_INSTALL_DIR）
  -Yes             非交互模式，全部使用默认值
  -Help            显示此帮助

示例：
  powershell -ExecutionPolicy Bypass -File install.ps1
  powershell -ExecutionPolicy Bypass -File install.ps1 -Dir C:\arkanis -Yes
  powershell -ExecutionPolicy Bypass -File install.ps1 -Local .\arkanis-dev -Dir C:\arkanis
"@ | Write-Host
  exit 0
}

# ── 参数默认值 ────────────────────────────────────────────────────────────────

if ([string]::IsNullOrWhiteSpace($Dir)) { $Dir = $DEFAULT_INSTALL_DIR }

# ── 前置检查 ──────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "Arkanis 安装向导" -ForegroundColor White
Write-Host ("─" * 40)
Write-Host ""

NeedCmd "docker"

docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Fail "Docker daemon 未运行，请先启动 Docker"
}

$hasComposeV2 = $false
docker compose version *> $null
if ($LASTEXITCODE -eq 0) { $hasComposeV2 = $true }
if (-not $hasComposeV2 -and -not (Get-Command docker-compose -ErrorAction SilentlyContinue)) {
  Fail "未找到 docker compose，请安装 Docker Compose v2"
}

if ([string]::IsNullOrWhiteSpace($Local)) {
  NeedCmd "git"
}

Success "前置检查通过"

# ── 获取代码 ──────────────────────────────────────────────────────────────────

Write-Host ""
Info "目标安装目录: $Dir"

if (Test-Path -LiteralPath $Dir) {
  Warn "目录已存在: $Dir"
  if (-not $Yes) {
    $confirm = Read-Host "是否继续并覆盖？[y/N]"
    if ($confirm -notmatch '^[yY]$') {
      Info "已取消"
      exit 0
    }
  }
}

if (-not [string]::IsNullOrWhiteSpace($Local)) {
  Info "从本地路径复制: $Local"
  if (-not (Test-Path -LiteralPath $Local -PathType Container)) {
    Fail "本地路径不存在: $Local"
  }

  if (-not (Test-Path -LiteralPath $Dir)) {
    New-Item -ItemType Directory -Path $Dir -Force | Out-Null
  }

  # 复制全部内容，再删除不需要的目录/文件
  Get-ChildItem -Path $Local -Force | Copy-Item -Destination $Dir -Recurse -Force
  $excludes = @(".git", "node_modules", "data", ".env", "outputs")
  foreach ($name in $excludes) {
    $target = Join-Path $Dir $name
    if (Test-Path -LiteralPath $target) {
      Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  Success "本地复制完成"
} else {
  Info "从远端克隆: $REPO_URL"
  git clone --depth 1 $REPO_URL $Dir
  Success "克隆完成"
}

# ── 准备 .env ─────────────────────────────────────────────────────────────────

Set-Location -LiteralPath $Dir

$EnvFile    = ".env"
$EnvExample = ".env.example"

if (-not (Test-Path -LiteralPath $EnvFile)) {
  if (-not (Test-Path -LiteralPath $EnvExample)) {
    Fail "缺少 .env.example，仓库可能不完整"
  }
  Copy-Item -LiteralPath $EnvExample -Destination $EnvFile
  Info "已从 .env.example 生成 .env"
} else {
  Info ".env 已存在，跳过生成"
}

# 自动填入随机加密 key（若为空）
$currentEncKey = ""
$envLines = Get-Content -LiteralPath $EnvFile
foreach ($line in $envLines) {
  if ($line -match "^SECRETS_ENC_KEY=(.*)$") {
    $currentEncKey = $Matches[1].Trim()
    break
  }
}
if ([string]::IsNullOrWhiteSpace($currentEncKey)) {
  $newEncKey = RandomHex 32
  SetEnvKv $EnvFile "SECRETS_ENC_KEY" $newEncKey
  Info "已生成 SECRETS_ENC_KEY"
}

# ── 选择搜索栈 ────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "搜索栈配置" -ForegroundColor White
Write-Host ("─" * 40)
Write-Host "  圆桌新闻管线依赖本地搜索服务，或外置的 Tavily / Jina API Key。"
Write-Host "  Lens 分析不依赖任何搜索服务。"
Write-Host ""
Write-Host "  0) 跳过（稍后手动配置外置 Tavily / Jina）"
Write-Host "  1) 部署 SearXNG + Firecrawl（推荐，功能完整）"
Write-Host "  2) 仅部署 SearXNG（轻量，仅搜索，抓取需另配 Jina）"
Write-Host ""

$searchChoice = ""
if ($Yes) {
  $searchChoice = "0"
  Info "非交互模式：跳过搜索栈部署（选 0）"
} else {
  while ($true) {
    $searchChoice = Read-Host "请选择 [0-2]（默认 0）"
    if ([string]::IsNullOrWhiteSpace($searchChoice)) { $searchChoice = "0" }
    if ($searchChoice -match '^[0-2]$') { break }
    Warn "请输入 0、1 或 2"
  }
}

$searchStackInstalled = $false
$searxngUrl   = "http://localhost:8080"
$firecrawlUrl = "http://localhost:3002"
$agentsJson   = "src/agents/agents-round/config/agents.json"

function DeploySearchStack() {
  $stackScript = Join-Path (Join-Path "deploy" "searxng-firecrawl") "stack.ps1"
  if (-not (Test-Path -LiteralPath $stackScript)) {
    Fail "未找到搜索栈脚本: $stackScript"
  }
  powershell -ExecutionPolicy Bypass -File $stackScript up
}

# 更新 agents.json 中的 search/fetch provider 设置
function UpdateAgentsProvider([string]$SearchProvider, [string]$FetchProvider) {
  if (-not (Test-Path -LiteralPath $agentsJson)) {
    Warn "未找到 $agentsJson，跳过 provider 写入"
    return
  }
  $data = Get-Content -LiteralPath $agentsJson -Raw | ConvertFrom-Json
  if (-not (Get-Member -InputObject $data -Name "news_pipeline_settings" -MemberType NoteProperty)) {
    $data | Add-Member -NotePropertyName "news_pipeline_settings" -NotePropertyValue ([PSCustomObject]@{}) -Force
  }
  $settings = $data.news_pipeline_settings
  $settings | Add-Member -NotePropertyName "search_provider" -NotePropertyValue $SearchProvider -Force
  $settings | Add-Member -NotePropertyName "fetch_provider" -NotePropertyValue $FetchProvider -Force
  $json = $data | ConvertTo-Json -Depth 10
  [System.IO.File]::WriteAllText(
    (Resolve-Path $agentsJson).Path,
    $json + "`n",
    [System.Text.UTF8Encoding]::new($false)
  )
  Info "已将 agents.json provider 设为：search=$SearchProvider, fetch=$FetchProvider"
}

switch ($searchChoice) {
  "1" {
    Info "部署 SearXNG + Firecrawl..."
    DeploySearchStack
    $searchStackInstalled = $true
    UpdateAgentsProvider "searxng" "firecrawl"
    Success "搜索栈部署完成"
  }
  "2" {
    Info "仅部署 SearXNG..."
    $localComposeFile = Join-Path (Join-Path "deploy" "searxng-firecrawl") "compose.yml"
    if (-not (Test-Path -LiteralPath $localComposeFile)) {
      Fail "未找到: $localComposeFile"
    }

    # 确保 searxng 子栈的 .env 就绪（复用 stack.ps1 的 ensure_env 逻辑）
    $localStackScript = Join-Path (Join-Path "deploy" "searxng-firecrawl") "stack.ps1"
    # 只初始化环境，不启动全量服务
    powershell -ExecutionPolicy Bypass -File $localStackScript up *>$null
    Compose @("-f", $localComposeFile, "stop", "firecrawl-api", "playwright-service", "rabbitmq", "nuq-postgres") *>$null
    Compose @("-f", $localComposeFile, "up", "-d", "redis", "searxng")
    $searchStackInstalled = $true
    $firecrawlUrl = ""
    UpdateAgentsProvider "searxng" "jina"
    Success "SearXNG 部署完成"
  }
  default {
    Info "跳过搜索栈部署"
  }
}

# 将搜索服务地址写入 .env（仅在已部署时）
if ($searchStackInstalled) {
  SetEnvKv $EnvFile "SEARXNG_URL" $searxngUrl
  if (-not [string]::IsNullOrWhiteSpace($firecrawlUrl)) {
    SetEnvKv $EnvFile "FIRECRAWL_URL" $firecrawlUrl
  }
}

# ── 构建并启动主栈 ────────────────────────────────────────────────────────────

Write-Host ""
Info "构建并启动 Arkanis..."
Compose @("up", "-d", "--build")

# ── 等待 server 健康 ──────────────────────────────────────────────────────────

Write-Host ""
Info "等待 server 就绪（最多 ${HEALTH_TIMEOUT}s）..."

# 读取 .env 中可能自定义的端口
$portForCheck = $DEFAULT_PORT
foreach ($line in (Get-Content -LiteralPath $EnvFile)) {
  if ($line -match "^ARKANIS_PORT=(\d+)") {
    $portForCheck = [int]$Matches[1]
    break
  }
}

$elapsed = 0
$healthy = $false
while ($elapsed -lt $HEALTH_TIMEOUT) {
  try {
    $resp = Invoke-WebRequest -Uri "http://localhost:${portForCheck}/api/auth/me" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
      $healthy = $true
      break
    }
  } catch {
    # not ready yet
  }
  Write-Host "." -NoNewline
  Start-Sleep -Seconds $HEALTH_INTERVAL
  $elapsed += $HEALTH_INTERVAL
}
Write-Host ""

if (-not $healthy -and $elapsed -ge $HEALTH_TIMEOUT) {
  Warn "server 启动超时，请手动检查："
  Warn "  docker compose logs arkanis"
}

# ── 读取 setup token ──────────────────────────────────────────────────────────

$setupToken = ""
try {
  $logs = Compose @("logs", "arkanis") 2>&1 | Out-String
  $matches_ = [regex]::Matches($logs, '_setup/([^\s]+)')
  if ($matches_.Count -gt 0) {
    $setupToken = $matches_[$matches_.Count - 1].Groups[1].Value
  }
} catch {
  # best-effort token extraction — non-critical if docker/compose unavailable
}

$hostIp = "localhost"

# ── 输出安装结果 ──────────────────────────────────────────────────────────────

Write-Host ""
Write-Host ("─" * 40) -ForegroundColor White
Write-Host "安装完成！" -ForegroundColor Green
Write-Host ("─" * 40) -ForegroundColor White
Write-Host ""
Write-Host "  访问地址: " -NoNewline
Write-Host "http://${hostIp}:${portForCheck}" -ForegroundColor Cyan
Write-Host ""

if (-not [string]::IsNullOrWhiteSpace($setupToken)) {
  Write-Host "  管理员初始化 URL（仅首次有效）：" -ForegroundColor White
  Write-Host "  http://${hostIp}:${portForCheck}/_setup/${setupToken}" -ForegroundColor Cyan
} else {
  Write-Host "  未能自动获取 setup token，请运行以下命令查看：" -ForegroundColor Yellow
  Write-Host "    docker compose logs arkanis | Select-String _setup"
}

Write-Host ""

if (-not $searchStackInstalled) {
  Write-Host "注意：您未部署本地搜索栈。" -ForegroundColor Yellow
  Write-Host "  圆桌新闻管线目前不可用。"
  Write-Host "  完成管理员配置后，请在「系统设置」中填入以下 API Key 之一："
  Write-Host "    - Tavily（https://app.tavily.com）→ TAVILY_API_KEY"
  Write-Host "    - Jina  （https://jina.ai）        → JINA_API_KEY"
  Write-Host "  Lens 分析功能不受影响，可正常使用。"
  Write-Host ""
}

Write-Host ("─" * 40) -ForegroundColor White
Write-Host ""
