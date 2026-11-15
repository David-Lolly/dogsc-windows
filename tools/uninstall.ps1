param(
  [string]$InstallDirectory = $PSScriptRoot,
  [string]$ShortcutDirectory = [Environment]::GetFolderPath('Programs')
)
$ErrorActionPreference = 'Stop'
$target = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\')
$root = [IO.Path]::GetPathRoot($target).TrimEnd('\')
if ($target -eq $root -or !(Test-Path -LiteralPath $target)) { throw 'Unsafe or missing uninstall target.' }
if ((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Uninstall target must not be a junction or symbolic link.' }
$marker = Join-Path $target '.dogsc-install.json'
if (!(Test-Path -LiteralPath $marker)) { throw 'Refusing to remove a folder without a DogSC installation marker.' }
$installation = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
if ($installation.productId -ne 'DogSC-Windows-Local-Install-v1' -or $installation.directory -ne $target) { throw 'Installation marker does not match the uninstall target.' }
$exe = Join-Path $target 'DogSC.exe'
$running = @(Get-Process DogSC -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -eq $exe } catch { $false } })
if ($running.Count) { throw 'Close this installed DogSC version before uninstalling.' }
$link = Join-Path ([IO.Path]::GetFullPath($ShortcutDirectory)) 'DogSC Windows.lnk'
if (Test-Path -LiteralPath $link) {
  $shell = New-Object -ComObject WScript.Shell
  if ($shell.CreateShortcut($link).TargetPath -eq $exe) { Remove-Item -LiteralPath $link -Force }
}
# Validate every managed path before deleting any file. Unknown user-added
# files in the program folder are retained, as are Videos/DogSC and settings.
$resolved = (Resolve-Path -LiteralPath $target).ProviderPath.TrimEnd('\')
if ($resolved -ne $target) { throw 'Resolved target changed; uninstall aborted.' }
$ancestor = $target
while ($ancestor) {
  if ((Test-Path -LiteralPath $ancestor) -and ((Get-Item -LiteralPath $ancestor).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Uninstall path must not traverse junctions or symbolic links.' }
  $ancestor = Split-Path $ancestor -Parent
}
if (@(Get-ChildItem -LiteralPath $target -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) { throw 'Installation contains a junction or symbolic link; uninstall aborted.' }
$ownedFiles = @($installation.files | ForEach-Object {
  $file = [IO.Path]::GetFullPath((Join-Path $target $_))
  if (!$file.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Managed file escaped installation directory.' }
  $file
})
$ownedDirectories = @($installation.directories | ForEach-Object {
  $directory = [IO.Path]::GetFullPath((Join-Path $target $_))
  if (!$directory.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Managed folder escaped installation directory.' }
  $directory
})
foreach ($file in $ownedFiles) { if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force } }
Remove-Item -LiteralPath $marker -Force
foreach ($directory in ($ownedDirectories | Sort-Object Length -Descending)) {
  if ((Test-Path -LiteralPath $directory) -and !(@(Get-ChildItem -LiteralPath $directory -Force).Count)) { Remove-Item -LiteralPath $directory -Force }
}
if (!(@(Get-ChildItem -LiteralPath $target -Force).Count)) { Remove-Item -LiteralPath $target -Force }
Write-Output 'DogSC program removed. Projects and user settings were retained.'
