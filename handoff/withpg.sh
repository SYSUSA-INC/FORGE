#!/bin/bash
# Start the test Postgres for one command, then stop it.
rm -f /var/lib/postgresql/16/main/postmaster.pid
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/16/main -o '-c config_file=/etc/postgresql/16/main/postgresql.conf' -l /tmp/forge-test-pg.log -w start" >/dev/null
export DATABASE_URL="postgres://forge:forge@localhost:5432/forge_ci?sslmode=disable"
bash -c "$1"; code=$?
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/16/main -m fast stop" >/dev/null
exit $code
