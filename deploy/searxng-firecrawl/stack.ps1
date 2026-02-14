Param(
  [Parameter(Position = 0)]
  [string]$Command = ""
)

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
  Write-Error $Message
  exit 1
}

function RandomHex([int]$Bytes = 32) {
  $data = New-Object byte[] $Bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($data)
  return ($data | ForEach-Object { $_.ToString("x2") }) -join ""
}

function EnsureEnvFile([string]$EnvFile, [string]$EnvExampleFile) {
  if (-not (Test-Path -LiteralPath $EnvFile)) {
    if (-not (Test-Path -LiteralPath $EnvExampleFile)) { Fail "缺少文件：$EnvExampleFile" }
    Copy-Item -LiteralPath $EnvExampleFile -Destination $EnvFile
  }
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
  Set-Content -LiteralPath $File -Value $out -NoNewline
  Add-Content -LiteralPath $File -Value "`n"
}

function UpdateSearxngSettings([string]$File, [int]$Port, [string]$SecretKey) {
  $lines = Get-Content -LiteralPath $File
  $out = foreach ($line in $lines) {
    if ($line -match "^\s*secret_key:\s*") {
      if ($line -match "ultrasecretkey") {
        "  secret_key: `"$SecretKey`""
      } else {
        $line
      }
    } elseif ($line -match "^\s*base_url:\s*") {
      "  base_url: `"http://localhost:$Port/`""
    } else {
      $line
    }
  }
  Set-Content -LiteralPath $File -Value $out -NoNewline
  Add-Content -LiteralPath $File -Value "`n"
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile = Join-Path $ScriptDir ".env"
$EnvExampleFile = Join-Path $ScriptDir ".env.example"
$SettingsFile = Join-Path $ScriptDir "searxng/settings.yml"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail "未找到命令：docker" }

function Compose([string[]]$Args) {
  try {
    docker compose version *> $null
    docker compose @Args
    return
  } catch {
    # ignore
  }
  $dc = Get-Command docker-compose -ErrorAction SilentlyContinue
  if (-not $dc) { Fail "未找到 docker compose（需要 Docker Compose v2 或 docker-compose v1）" }
  docker-compose @Args
}

function GhcrAuthHelp() {
  @"
提示：镜像拉取被拒绝（denied）时，常见原因是本机 GHCR 凭据异常或网络/镜像源受限。
说明：本栈默认使用的 Firecrawl 官方镜像是 Public（正常不需要登录）。

优先尝试：
  docker logout ghcr.io
  # 再重试 stack.ps1 up

如果你确实需要登录（例如公司策略要求），建议用 GitHub classic token 并勾选 read:packages：
  docker login ghcr.io

如果你无法访问 GHCR，可以在 deploy/searxng-firecrawl/.env 里覆盖镜像地址（公司镜像仓库/自建 registry 均可），例如：
  FIRECRAWL_IMAGE=你的镜像仓库/firecrawl:tag
  PLAYWRIGHT_IMAGE=你的镜像仓库/playwright-service:tag
  NUQ_POSTGRES_IMAGE=你的镜像仓库/nuq-postgres:tag
"@ | Write-Host
}

switch ($Command) {
  "up" {
    EnsureEnvFile $EnvFile $EnvExampleFile

    $envMap = @{}
    Get-Content -LiteralPath $EnvFile | ForEach-Object {
      if ($_ -match "^\s*#" -or $_ -match "^\s*$") { return }
      $parts = $_.Split("=", 2)
      if ($parts.Length -eq 2) { $envMap[$parts[0]] = $parts[1] }
    }

    $bull = $envMap["BULL_AUTH_KEY"]
    if ([string]::IsNullOrWhiteSpace($bull) -or $bull -eq "CHANGEME") {
      $bull = RandomHex 32
      SetEnvKv $EnvFile "BULL_AUTH_KEY" $bull
    }

    $portStr = $envMap["SEARXNG_PORT"]
    if ([string]::IsNullOrWhiteSpace($portStr)) { $portStr = "8080" }
    $port = 0
    if (-not [int]::TryParse($portStr, [ref]$port)) { Fail "SEARXNG_PORT 不是合法端口：$portStr" }

    UpdateSearxngSettings $SettingsFile $port (RandomHex 32)

    Push-Location $ScriptDir
    try {
      Compose @("-f", "compose.yml", "pull")
    } catch {
      GhcrAuthHelp
      throw
    }
    Compose @("-f", "compose.yml", "up", "-d")
    Pop-Location
  }
  "down" {
    Push-Location $ScriptDir
    Compose @("-f", "compose.yml", "down")
    Pop-Location
  }
  "restart" {
    Push-Location $ScriptDir
    Compose @("-f", "compose.yml", "restart")
    Pop-Location
  }
  "ps" {
    Push-Location $ScriptDir
    Compose @("-f", "compose.yml", "ps")
    Pop-Location
  }
  "logs" {
    Push-Location $ScriptDir
    Compose @("-f", "compose.yml", "logs", "-f", "--tail=200")
    Pop-Location
  }
  "pull" {
    Push-Location $ScriptDir
    try {
      Compose @("-f", "compose.yml", "pull")
    } catch {
      GhcrAuthHelp
      throw
    }
    Pop-Location
  }
  Default {
    @"
用法：
  powershell -ExecutionPolicy Bypass -File .\deploy\searxng-firecrawl\stack.ps1 up
  powershell -ExecutionPolicy Bypass -File .\deploy\searxng-firecrawl\stack.ps1 down
  powershell -ExecutionPolicy Bypass -File .\deploy\searxng-firecrawl\stack.ps1 logs
  powershell -ExecutionPolicy Bypass -File .\deploy\searxng-firecrawl\stack.ps1 ps
  powershell -ExecutionPolicy Bypass -File .\deploy\searxng-firecrawl\stack.ps1 pull
"@ | Write-Host
    exit 2
  }
}
