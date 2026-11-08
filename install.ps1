<#
.SYNOPSIS
  一键把「能力中心」装进 DSH 的某个 profile。

.EXAMPLE
  irm https://raw.githubusercontent.com/niueigang/dsh-capability-center/main/install.ps1 | iex

.EXAMPLE
  .\install.ps1 -Profile web -Ref v0.1.0

.NOTES
  只做三件事，都能手工还原：
    1. %USERPROFILE%\.dsh\plugins\dsh-capability-center   <- 从 GitHub 下载的源码
    2. profile/node_modules/dsh-capability-center          -> 上面那个目录（junction）
    3. profile 的 package.json：dependencies + dsh.profile.bundles 各加一行
  不碰 app.asar，不写注册表，不建计划任务。
#>
param(
  [string]$Profile = "desktop",
  [string]$Repo = "niueigang/dsh-capability-center",
  [string]$Ref = "main",
  [switch]$Force
)

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
try { $OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Say($msg, $color = "Gray") { Write-Host $msg -ForegroundColor $color }

# ── 1. DSH_HOME ────────────────────────────────────────────────
$dshHome = $env:DSH_HOME
if ([string]::IsNullOrWhiteSpace($dshHome)) { $dshHome = Join-Path $env:USERPROFILE ".dsh" }
$dshHome = [System.IO.Path]::GetFullPath($dshHome)
if (-not (Test-Path $dshHome)) {
  Say "找不到 DSH_HOME：$dshHome" "Red"
  Say "先装好并运行过一次 DeepSeek Harness，再回来跑这个脚本。" "Yellow"
  exit 1
}
Say "DSH_HOME   : $dshHome"

$profileDir = Join-Path $dshHome "profiles\$Profile"
if (-not (Test-Path (Join-Path $profileDir "package.json"))) {
  Say "找不到 profile '$Profile'：$profileDir" "Red"
  $have = Get-ChildItem (Join-Path $dshHome "profiles") -Directory -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty Name
  if ($have) { Say ("现有 profile：" + ($have -join ", ")) "Yellow" }
  exit 1
}
Say "目标 profile: $profileDir"

# ── 2. 下载 ────────────────────────────────────────────────────
$dest = Join-Path $dshHome "plugins\dsh-capability-center"
if ((Test-Path $dest) -and -not $Force) {
  Say "插件目录已存在，更新它：$dest" "Yellow"
}
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("cc-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null

$zip = Join-Path $tmp "src.zip"
if ($Ref -match '^v?\d') { $url = "https://codeload.github.com/$Repo/zip/refs/tags/$Ref" }
else { $url = "https://codeload.github.com/$Repo/zip/refs/heads/$Ref" }

Say "下载       : $url"
try {
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -TimeoutSec 120
} catch {
  Say "下载失败：$($_.Exception.Message)" "Red"
  Say "内网可试试先把仓库 clone 下来，再跑 node tools/install.mjs $Profile" "Yellow"
  exit 1
}

Expand-Archive -Path $zip -DestinationPath $tmp -Force
$root = Get-ChildItem $tmp -Directory | Where-Object { Test-Path (Join-Path $_.FullName "package.json") } | Select-Object -First 1
if (-not $root) { Say "压缩包里没找到 package.json" "Red"; exit 1 }

# ── 3. 落到插件目录 ────────────────────────────────────────────
New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null
if (Test-Path $dest) {
  # 保留用户自己改过的 README？不保留，整体覆盖更不容易出错
  Remove-Item $dest -Recurse -Force
}
Copy-Item $root.FullName $dest -Recurse -Force
Say "已展开到  : $dest" "Green"

# ── 4. 找 node，跑真正的安装逻辑 ───────────────────────────────
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  $candidate = Join-Path $env:USERPROFILE ".dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
  if (Test-Path $candidate) { $node = $candidate }
}
if (-not $node) {
  Say "没找到 node.exe：装过 Node.js，或先运行一次 DSH 客户端（会自带一个）。" "Red"
  exit 1
}

$env:DSH_HOME = $dshHome
& $node (Join-Path $dest "tools\install.mjs") $Profile
if ($LASTEXITCODE -ne 0) { Say "安装脚本返回 $LASTEXITCODE" "Red"; exit $LASTEXITCODE }

Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

Say ""
Say "装好了。" "Green"
Say "下一步：重启 DeepSeek Harness，侧栏「插件」下面会出现「能力中心」。" "Cyan"
Say "卸载   ：node `"$dest\tools\uninstall.mjs`" $Profile" "Gray"
