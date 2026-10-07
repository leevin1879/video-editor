# Run after extracting this plugin on a different computer. Requires local VEdit.
$ErrorActionPreference = 'Stop'
$pluginPath = $PSScriptRoot
$pluginPython = Join-Path $pluginPath '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pluginPython)) { & python -m venv (Join-Path $pluginPath '.venv') }
& $pluginPython -m pip install -r (Join-Path $pluginPath 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'MCP dependency installation failed' }
$config = @{
  '$schema' = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json'
  mcpServers = @{ vedit = @{ type = 'stdio'; command = $pluginPython; args = @((Join-Path $pluginPath 'server.py')) } }
}
[System.IO.File]::WriteAllText((Join-Path $pluginPath 'mcp.json'), ($config | ConvertTo-Json -Depth 6), [System.Text.UTF8Encoding]::new($false))
Write-Host 'Plugin configured. Keep local VEdit open and pair with its ChatGPT button.'
Write-Host "For HTTP: & '$pluginPython' '$pluginPath\server.py' --http"
