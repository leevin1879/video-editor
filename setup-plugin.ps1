$ErrorActionPreference = 'Stop'
$repoPath = $PSScriptRoot
$pluginPython = Join-Path $repoPath 'plugin-env\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pluginPython)) { & python -m venv (Join-Path $repoPath 'plugin-env') }
& $pluginPython -m pip install -r (Join-Path $repoPath 'plugins\vedit\requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Plugin dependencies could not be installed' }
$config = @{
  '$schema' = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json'
  mcpServers = @{ vedit = @{ type = 'stdio'; command = $pluginPython; args = @((Join-Path $repoPath 'plugins\vedit\server.py')) } }
}
$jsonConfig = $config | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText((Join-Path $repoPath 'plugins\vedit\mcp.json'), $jsonConfig, [System.Text.UTF8Encoding]::new($false))
Write-Host 'VEdit plugin is ready. Open VEdit, click ChatGPT, and pair through connect_editor.'
