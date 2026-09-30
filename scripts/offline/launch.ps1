$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'launch.mjs'
$node = Join-Path $PSScriptRoot '..\tools\node\node.exe'
& $node $launcher @args
exit $LASTEXITCODE
