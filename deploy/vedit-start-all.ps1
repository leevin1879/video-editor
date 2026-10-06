$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ";" + [Environment]::GetEnvironmentVariable('Path','User')
$root = "C:\Users\ceo\Downloads\claude-code"
$repo = "$root\video-editor"
$cf = "C:\Program Files (x86)\cloudflared\cloudflared.exe"

function Running($pattern) {
    [bool](Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like $pattern -and $_.ProcessId -ne $PID })
}

function PortOpen($port) {
    [bool](netstat -ano | Select-String "127\.0\.0\.1:$port\s+.*LISTENING")
}

if (-not (PortOpen 8765)) {
    Start-Process python -ArgumentList "-u","server.py","--no-browser" -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput "$root\vedit-server.out.log" -RedirectStandardError "$root\vedit-server.err.log"
}
if (-not (PortOpen 8766)) {
    $env:VEDIT_AUTH_CFG = "$root\vedit-auth.json"
    $env:VEDIT_PORT = '8765'
    $env:VEDIT_PROXY_PORT = '8766'
    Start-Process python -ArgumentList "-u","vedit-authproxy.py" -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput "$root\vedit-proxy.out.log" -RedirectStandardError "$root\vedit-proxy.err.log"
}
if (-not (Running '*vedit-1879.yml*')) {
    Start-Process $cf -ArgumentList "tunnel","--config","C:\Users\ceo\.cloudflared\vedit-1879.yml","run","vedit-1879" -WindowStyle Hidden
}
