param([Parameter(Mandatory=$true)][string]$PackageDirectory)
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$results = [IO.Path]::GetFullPath((Join-Path $repo 'analysis\results'))
$suite = Join-Path $results ('install-suite-' + [guid]::NewGuid().ToString())
$target = Join-Path $suite 'program'
$shortcuts = Join-Path $suite 'shortcuts'
$blocked = Join-Path $suite 'unrelated'
New-Item -ItemType Directory -Path $suite -Force | Out-Null
try {
  & (Join-Path $PackageDirectory 'install.ps1') -InstallDirectory $target -ShortcutDirectory $shortcuts
  if (!(Test-Path -LiteralPath (Join-Path $target 'DogSC.exe')) -or !(Test-Path -LiteralPath (Join-Path $shortcuts 'DogSC Windows.lnk'))) { throw 'Install failed.' }
  Set-Content -LiteralPath (Join-Path $target 'user-note.txt') -Value 'retain this file'
  Set-Content -LiteralPath (Join-Path $suite 'project-sentinel.json') -Value 'retain project'
  # A link inside a marked install must never redirect upgrade/uninstall writes.
  $linked = Join-Path $target 'linked-data'
  New-Item -ItemType Junction -Path $linked -Target $shortcuts | Out-Null
  try {
    $upgradeRejected = $false; $uninstallRejected = $false
    try { & (Join-Path $PackageDirectory 'install.ps1') -InstallDirectory $target -ShortcutDirectory $shortcuts } catch { $upgradeRejected = $true }
    try { & (Join-Path $target 'uninstall.ps1') -InstallDirectory $target -ShortcutDirectory $shortcuts } catch { $uninstallRejected = $true }
    if (!$upgradeRejected -or !$uninstallRejected -or !(Test-Path -LiteralPath (Join-Path $target 'DogSC.exe'))) { throw 'Nested junction was not protected.' }
  } finally {
    $linkResolved = [IO.Path]::GetFullPath($linked)
    if (!$linkResolved.StartsWith($suite + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Junction cleanup escaped suite.' }
    # Remove only the link, never its target tree.
    [IO.Directory]::Delete($linkResolved)
  }
  & (Join-Path $PackageDirectory 'install.ps1') -InstallDirectory $target -ShortcutDirectory $shortcuts
  New-Item -ItemType Directory -Path $blocked | Out-Null
  Set-Content -LiteralPath (Join-Path $blocked 'unrelated.txt') -Value 'untouched'
  $rejected = $false
  try { & (Join-Path $PackageDirectory 'install.ps1') -InstallDirectory $blocked -ShortcutDirectory $shortcuts } catch { $rejected = $true }
  if (!$rejected -or (Get-Content -LiteralPath (Join-Path $blocked 'unrelated.txt') -Raw).Trim() -ne 'untouched') { throw 'Unknown folder was not protected.' }
  & (Join-Path $target 'uninstall.ps1') -InstallDirectory $target -ShortcutDirectory $shortcuts
  if ((Test-Path -LiteralPath (Join-Path $target 'DogSC.exe')) -or (Test-Path -LiteralPath (Join-Path $shortcuts 'DogSC Windows.lnk'))) { throw 'Uninstall failed.' }
  if ((Get-Content -LiteralPath (Join-Path $target 'user-note.txt') -Raw).Trim() -ne 'retain this file' -or !(Test-Path -LiteralPath (Join-Path $suite 'project-sentinel.json'))) { throw 'User data was removed.' }
  @{ passed=$true; workspaceOnly=$true; installed=$true; shortcutCreated=$true; upgrade=$true; nestedJunctionProtected=$true; unknownFolderProtected=$true; uninstalled=$true; extraUserFilePreserved=$true; projectSentinelPreserved=$true } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $results 'install-report.json') -Encoding UTF8
  Get-Content -LiteralPath (Join-Path $results 'install-report.json')
} finally {
  $resolved = (Resolve-Path -LiteralPath $suite).ProviderPath
  if (!$resolved.StartsWith($results + '\', [StringComparison]::OrdinalIgnoreCase) -or !(Split-Path $resolved -Leaf).StartsWith('install-suite-')) { throw 'Cleanup target escaped the workspace suite.' }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
