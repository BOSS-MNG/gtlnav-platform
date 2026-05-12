Get-Process -Name node -ErrorAction SilentlyContinue | ForEach-Object {
    try {
        Stop-Process -Id $_.Id -Force -ErrorAction Stop
        Write-Host ("killed " + $_.Id)
    } catch {
        Write-Host ("skip " + $_.Id)
    }
}
Remove-Item -LiteralPath '.next' -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "cleared"
