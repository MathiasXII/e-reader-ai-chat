param(
    [int]$Port = 8000
)

$proc = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue } |
    Where-Object { $_.ProcessName -eq "python" }

if (-not $proc) {
    Write-Host "No server found on port $Port." -ForegroundColor Yellow
    exit 0
}

Write-Host "Stopping server (PID $($proc.Id)) on port $Port ..." -ForegroundColor Red
Stop-Process -Id $proc.Id -Force
Write-Host "Server stopped." -ForegroundColor Green