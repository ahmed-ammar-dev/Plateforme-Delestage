$pgBin = "C:\Program Files\PostgreSQL\17\bin"
$current = [Environment]::GetEnvironmentVariable("Path", "Machine")
if ($current -notlike "*PostgreSQL\17\bin*") {
    [Environment]::SetEnvironmentVariable("Path", "$current;$pgBin", "Machine")
    Write-Host "PostgreSQL added to system PATH"
} else {
    Write-Host "PostgreSQL already in PATH"
}
$env:Path += ";$pgBin"
psql --version
