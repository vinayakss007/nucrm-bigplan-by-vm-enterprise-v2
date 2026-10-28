#!/usr/bin/env bash
# fixture (#3280): the shell idiom — the context is on the session, not in the SQL.
PGOPTIONS='-c app.is_super_admin=true' psql "$DATABASE_URL" -Atq -c "SELECT count(*) FROM users"
