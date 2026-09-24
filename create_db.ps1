$env:Path += ";C:\Program Files\PostgreSQL\17\bin"
$env:PGPASSWORD = "postgres123"

Write-Host "=== psql version ==="
psql --version

Write-Host "=== Creating user steg_app ==="
psql -U postgres -c "CREATE USER steg_app WITH PASSWORD 'steg_secure_2026';"

Write-Host "=== Creating database ==="
psql -U postgres -c "CREATE DATABASE steg_delestage OWNER steg_app ENCODING 'UTF8';"

Write-Host "=== Granting privileges ==="
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE steg_delestage TO steg_app;"
psql -U postgres -d steg_delestage -c "GRANT ALL ON SCHEMA public TO steg_app;"

Write-Host "=== Verifying ==="
psql -U postgres -c "SELECT datname FROM pg_database WHERE datname = 'steg_delestage';"

Write-Host "=== All done ==="
