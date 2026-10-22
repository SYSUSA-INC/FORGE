#!/bin/bash
# Start FORGE (next dev) against the test DB, take screenshots, stop it.
S=/tmp/claude-0/-home-user-FORGE/93c56b42-7444-51af-9cc9-86f7aaa545d4/scratchpad
LABEL=$1
cd /home/user/FORGE
export AUTH_SECRET=local-screenshot-secret-0123456789abcdef AUTH_TRUST_HOST=true NEXT_TELEMETRY_DISABLED=1
setsid npx next dev -p 3000 > $S/run/next-dev.log 2>&1 &
NP=$!
for i in $(seq 1 150); do curl -s -o /dev/null http://localhost:3000/sign-in && break; sleep 2; done
node $S/run/forge-shots.cjs $S/fshots $LABEL; code=$?
kill -- -$NP 2>/dev/null; sleep 2; kill -9 -- -$NP 2>/dev/null
exit $code
