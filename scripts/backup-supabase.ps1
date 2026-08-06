# ORBII — Supabase database backup.
#
# Dumps the ENTIRE Postgres database to a timestamped, compressed file and keeps
# the most recent 8. Run it weekly. This is your safety net until you're on
# Supabase Pro (which does daily backups automatically).
#
# ── ONE-TIME SETUP ────────────────────────────────────────────────────────────
# 1) Get your connection string:
#    Supabase dashboard -> Project Settings -> Database -> "Connection string"
#    -> choose the **Session pooler** tab (it ends in ":5432/postgres").
#    IMPORTANT: use the Session pooler (port 5432), NOT the Transaction pooler
#    (port 6543) -- pg_dump does not work through the transaction pooler.
#    Paste your database password where it says [YOUR-PASSWORD].
#
# 2) Save it so this script can read it WITHOUT it ever touching git:
#      setx ORBII_DB_URL "postgresql://postgres.henbkyjefhzmxqozlczd:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres"
#    Then CLOSE and re-open the terminal (setx only applies to new terminals).
#
# 3) Install the pg_dump tool (once):
#      winget install PostgreSQL.PostgreSQL.17
#
# ── RUN ───────────────────────────────────────────────────────────────────────
#   powershell -ExecutionPolicy Bypass -File scripts\backup-supabase.ps1
#
# ── RESTORE (if you ever need it) ─────────────────────────────────────────────
#   pg_restore --clean --if-exists --no-owner --dbname="$env:ORBII_DB_URL" backups\<file>.dump

$ErrorActionPreference = 'Stop'

$dbUrl = $env:ORBII_DB_URL
if (-not $dbUrl) {
  Write-Host "ORBII_DB_URL is not set. See the setup steps at the top of this script." -ForegroundColor Red
  exit 1
}

# Locate pg_dump (PATH first, then the default PostgreSQL install folder).
$pgDump = (Get-Command pg_dump -ErrorAction SilentlyContinue).Source
if (-not $pgDump) {
  $guess = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\pg_dump.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName | Select-Object -Last 1
  if ($guess) { $pgDump = $guess.FullName }
}
if (-not $pgDump) {
  Write-Host "pg_dump not found. Install it once with:  winget install PostgreSQL.PostgreSQL.17" -ForegroundColor Red
  exit 1
}

$backupDir = Join-Path $PSScriptRoot "..\backups"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp = Get-Date -Format "yyyy-MM-dd_HHmm"
$outFile = Join-Path $backupDir "orbii_$stamp.dump"

Write-Host "Backing up the ORBII database..." -ForegroundColor Cyan
& $pgDump --dbname="$dbUrl" --format=custom --no-owner --no-privileges --file="$outFile"
if ($LASTEXITCODE -ne 0) {
  Write-Host "pg_dump failed. Double-check ORBII_DB_URL (session pooler, port 5432) and your password." -ForegroundColor Red
  exit 1
}

$sizeMB = [math]::Round((Get-Item $outFile).Length / 1MB, 2)
Write-Host "Backup saved: $outFile ($sizeMB MB)" -ForegroundColor Green

# Retention: keep the 8 most recent backups, delete anything older.
Get-ChildItem $backupDir -Filter "orbii_*.dump" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -Skip 8 |
  ForEach-Object { Remove-Item $_.FullName -Force; Write-Host "Pruned old backup: $($_.Name)" -ForegroundColor DarkGray }

Write-Host "Done." -ForegroundColor Green
