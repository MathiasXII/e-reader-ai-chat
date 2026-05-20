param(
    [int]$Port = 8000,
    [string]$Host_ = "0.0.0.0"
)

# Kill any existing server on this port
$existing = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue } |
    Where-Object { $_.ProcessName -eq "python" }

if ($existing) {
    Write-Host "Stopping existing server (PID $($existing.Id)) on port $Port ..." -ForegroundColor Red
    Stop-Process -Id $existing.Id -Force
    Start-Sleep -Seconds 2
}

Write-Host "Starting Kindle LLM server on http://${Host_}:${Port}/" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop." -ForegroundColor Yellow
python -m uvicorn server:app --host $Host_ --port $Port