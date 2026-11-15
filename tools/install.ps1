param(
  [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'Programs\DogSC-Windows'),
  [string]$ShortcutDirectory = [Environment]::GetFolderPath('Programs')
)
$ErrorActionPreference = 'Stop'
$productId = 'DogSC-Windows-Local-Install-v1'
$source = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
$target = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\')
$root = [IO.Path]::GetPathRoot($target).TrimEnd('\')
if ($target -eq $root -or $target -eq $source -or $source.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase) -or $target.StartsWith($source + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe installation target.' }
if (!(Test-Path -LiteralPath (Join-Path $source 'DogSC.exe')) -or !(Test-Path -LiteralPath (Join-Path $source 'resources\app.asar'))) { throw 'Run this script from the complete portable package.' }
$marker = Join-Path $target '.dogsc-install.json'
if (Test-Path -LiteralPath $target) {
  if ((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Installation target must not be a junction or symbolic link.' }
  if (@(Get-ChildItem -LiteralPath $target -Force).Count -gt 0) {
    if (!(Test-Path -LiteralPath $marker)) { throw 'Refusing to overwrite a nonempty folder without a DogSC installation marker.' }
    $previous = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
    if ($previous.productId -ne $productId -or $previous.directory -ne $target) { throw 'Installation marker does not match the target.' }
  }
}
# Existing nested junctions could redirect Copy-Item outside the target.
$ancestor = $target
while ($ancestor) {
  if ((Test-Path -LiteralPath $ancestor) -and ((Get-Item -LiteralPath $ancestor).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Installation path must not traverse junctions or symbolic links.' }
  $ancestor = Split-Path $ancestor -Parent
}
if ((Test-Path -LiteralPath $target) -and @(Get-ChildItem -LiteralPath $target -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) { throw 'Installation contains a junction or symbolic link; upgrade aborted.' }
foreach ($relative in @($previous.files) + @($previous.directories)) {
  if (!$relative) { continue }
  $managed = [IO.Path]::GetFullPath((Join-Path $target $relative))
  if (!$managed.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Previous manifest path escaped installation directory.' }
}
$exe = Join-Path $target 'DogSC.exe'
$running = @(Get-Process DogSC -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -eq $exe } catch { $false } })
if ($running.Count) { throw 'Close this installed DogSC version before upgrading.' }
New-Item -ItemType Directory -Path $target -Force | Out-Null
foreach ($item in Get-ChildItem -LiteralPath $source -Force) { Copy-Item -LiteralPath $item.FullName -Destination $target -Recurse -Force }
$version = (Get-Content -LiteralPath (Join-Path $target 'VERSION.txt') -Raw).Trim()
$files = @($previous.files) + @(Get-ChildItem -LiteralPath $source -File -Recurse -Force | ForEach-Object { $_.FullName.Substring($source.Length + 1) })
$directories = @($previous.directories) + @(Get-ChildItem -LiteralPath $source -Directory -Recurse -Force | ForEach-Object { $_.FullName.Substring($source.Length + 1) })
$files = @($files | Where-Object { $_ } | Select-Object -Unique)
$directories = @($directories | Where-Object { $_ } | Select-Object -Unique)
@{ productId = $productId; directory = $target; version = $version; files = $files; directories = $directories } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $marker -Encoding UTF8
New-Item -ItemType Directory -Path $ShortcutDirectory -Force | Out-Null
$link = Join-Path ([IO.Path]::GetFullPath($ShortcutDirectory)) 'DogSC Windows.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = $exe
$shortcut.WorkingDirectory = $target
$shortcut.Description = "DogSC Windows $version"
$shortcut.Save()
Write-Output "Installed DogSC Windows $version to $target"
