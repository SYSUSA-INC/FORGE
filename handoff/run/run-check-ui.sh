#!/bin/bash
S=/tmp/claude-0/-home-user-FORGE/93c56b42-7444-51af-9cc9-86f7aaa545d4/scratchpad
cd /home/user/forge-ui
export AUTH_SECRET=local-screenshot-secret-0123456789abcdef AUTH_TRUST_HOST=true NEXT_TELEMETRY_DISABLED=1
setsid npx next dev -p 3000 > $S/run/next-dev.log 2>&1 &
NP=$!
for i in $(seq 1 150); do curl -s -o /dev/null http://localhost:3000/sign-in && break; sleep 2; done
node $S/run/$1 $2 $3; code=$?
kill -- -$NP 2>/dev/null; sleep 2; kill -9 -- -$NP 2>/dev/null
exit $code
