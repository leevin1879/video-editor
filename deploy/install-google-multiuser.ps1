$ErrorActionPreference = 'Stop'
$root = 'C:\Users\ceo\Downloads\claude-code'
$repo = Join-Path $root 'video-editor'
$configPath = Join-Path $root 'vedit-auth.json'
$py = 'C:\Users\ceo\AppData\Local\Programs\Python\Python312\python.exe'
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if (-not $config.google_client_id -or -not $config.google_client_secret -or -not $config.session_secret) {
    throw 'Google OAuth configuration is incomplete.'
}
$allowed = @($config.allowed_emails | Where-Object { $_ -ne '*' })
if (-not $config.legacy_owner_hash -and $allowed.Count -ne 1) {
    throw 'Cannot identify a unique legacy owner. Do not expose old data.'
}
if ((git -C $repo status --porcelain)) { throw 'Repository contains local changes; preserve them before deployment.' }
if (Get-CimInstance Win32_Process -Filter "Name='ffmpeg.exe'" | Where-Object { $_.ParentProcessId -eq 11488 }) {
    throw 'A video job is active; retry after completion.'
}
$backup = Join-Path $root ('vedit-multiuser-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backup | Out-Null
Copy-Item -LiteralPath $configPath -Destination (Join-Path $backup 'vedit-auth.json')
Copy-Item -LiteralPath (Join-Path $root 'vedit-authproxy.py') -Destination (Join-Path $backup 'vedit-authproxy.py')
foreach ($file in @('server.py','static/app.js','static/index.html')) {
    $dest = Join-Path $backup $file
    New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $repo $file) -Destination $dest
}
git -C $repo fetch origin main
if ($LASTEXITCODE) { throw 'Fetch failed.' }
git -C $repo merge --ff-only origin/main
if ($LASTEXITCODE) { throw 'Fast-forward failed.' }
& $py -m py_compile "$repo\server.py" "$repo\tenant_storage.py" "$repo\deploy\vedit-authproxy.py"
if ($LASTEXITCODE) { throw 'Python syntax check failed.' }
if (-not $config.legacy_owner_hash) {
    $sha = [Security.Cryptography.SHA256]::Create()
    $owner = -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($allowed[0].Trim().ToLowerInvariant())) | ForEach-Object {$_.ToString('x2')})
    $config | Add-Member -NotePropertyName legacy_owner_hash -NotePropertyValue $owner
}
$config.allowed_emails = @('*')
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding($false)))
Copy-Item -LiteralPath "$repo\deploy\vedit-authproxy.py" -Destination "$root\vedit-authproxy.py"
Copy-Item -LiteralPath "$root\vedit-start-all.ps1" -Destination "$backup\vedit-start-all.ps1"
Copy-Item -LiteralPath "$repo\deploy\vedit-start-all.ps1" -Destination "$root\vedit-start-all.ps1"
function Stop-VeditPorts {
    foreach ($port in @(8765,8766)) {
        $lines = netstat -ano | Select-String "127\.0\.0\.1:$port\s+.*LISTENING"
        foreach ($line in $lines) {
            $targetPid = [int](($line.Line.Trim() -split '\s+')[-1])
            $process = Get-CimInstance Win32_Process -Filter "ProcessId=$targetPid"
            $expected = if ($port -eq 8765) { '*server.py*' } else { '*vedit-authproxy.py*' }
            if ($process.Name -ne 'python.exe' -or $process.CommandLine -notlike $expected) {
                throw "Unexpected process on port $port; not stopping it."
            }
            Stop-Process -Id $targetPid
        }
    }
}
function Start-Vedit {
    $env:VEDIT_MULTIUSER = '1'
    $env:VEDIT_AUTH_CFG = $configPath
    $env:VEDIT_PORT = '8765'
    $env:VEDIT_PROXY_PORT = '8766'
    Start-ScheduledTask -TaskName 'VEdit-StartAll'
}
try {
    Stop-VeditPorts
    Start-Vedit
    Start-Sleep -Seconds 3
    & $py "$repo\deploy\smoke_google_multiuser.py"
    if ($LASTEXITCODE) { throw 'End-to-end isolation check failed.' }
    Write-Output "DEPLOYED: Google accounts enabled; private storage checked. Backup: $backup"
} catch {
    Stop-VeditPorts
    Copy-Item -LiteralPath "$backup\vedit-auth.json" -Destination $configPath
    Copy-Item -LiteralPath "$backup\vedit-authproxy.py" -Destination "$root\vedit-authproxy.py"
    foreach ($file in @('server.py','static/app.js','static/index.html')) {
        Copy-Item -LiteralPath (Join-Path $backup $file) -Destination (Join-Path $repo $file)
    }
    Start-Vedit
    throw
}
