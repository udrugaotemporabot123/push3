#!/bin/bash
# Usage: tools/release.sh 0.2.0 "Short summary"
# Bumps the version, records it in CHANGELOG.md, commits, pushes main and release/vX.Y.Z.
set -euo pipefail
cd "$(dirname "$0")/.."
V="$1"; MSG="$2"
npm test --silent >/dev/null
node -e "const f='package.json',p=require('./'+f);p.version='$V';require('fs').writeFileSync(f,JSON.stringify(p,null,2)+'\n')"
sed -i "s/^const VERSION = '[^']*';/const VERSION = '$V';/" engine/src/app.js
[ -f CHANGELOG.md ] || printf '# Changelog\n\nSvaka verzija ima svoju granu `release/vX.Y.Z` na GitHubu (Code -> Download ZIP).\n' > CHANGELOG.md
python3 - "$V" "$MSG" <<'PY'
import sys, datetime
v, msg = sys.argv[1], sys.argv[2]
p = 'CHANGELOG.md'
s = open(p).read()
head, _, rest = s.partition('\n\n')
entry = f"## v{v} – {datetime.date.today().isoformat()}\n{msg}\n"
lines = s.split('\n')
# insert after the intro paragraph (first blank line after the header block)
idx = s.find('\n## ')
s = (s.rstrip('\n') + '\n\n' + entry) if idx < 0 else s[:idx] + '\n' + entry + s[idx:]
open(p, 'w').write(s)
PY
git add -A
git commit -q -m "Release v$V: $MSG

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FFu5h3Kf1vsbUv8EU6fa9j"
for i in 1 2 3; do git push -q origin main && break || sleep $((i*3)); done
for i in 1 2 3; do git push -q origin "main:refs/heads/release/v$V" && break || sleep $((i*3)); done
echo "released v$V"
