#!/bin/zsh
# /front deploy in one command (Victor says "deploy" / "deploy rapid"), from 2-cod-sursa:
#   zsh tools/front-deploy.sh [--no-tests] [--dry]
#   1. the changes gathered in .front-log.md (stops if there is nothing to deploy)
#   2. stops if a file of the full gate is touched (money/orders, persistence, server logic): that goes through npm run deploy
#   3. the area tests (tools/front-tests.mjs picks them from the diff), unless --no-tests; a failure stops here
#   4. npm run deploy:ui, the new build id in ../CITESTE-MA.md
#   5. one commit with the log lines as its body, the log emptied. No push, no version change.
# --dry: prints what it would do and changes nothing.
set -e
cd "$(dirname "$0")/.."
DRY=0; TESTS=1
for a in "$@"; do case $a in --dry) DRY=1;; --no-tests) TESTS=0;; *) echo "unknown option $a" >&2; exit 2;; esac; done
LOG=.front-log.md
HEAD_LINE='# /front — modificări adunate până la următorul deploy'

ENTRIES=$(grep '^- ' $LOG 2>/dev/null || true)
# only tracked app files: other work in the tree (.mace/, .claude/, new untracked files) is shown, never committed
FILES=(${(f)"$(git diff --name-only HEAD -- . ':(exclude).mace' ':(exclude).claude' || true)"})
NEW=$(git ls-files --others --exclude-standard -- . ':(exclude).mace' ':(exclude).claude' || true)
[[ -n "$ENTRIES" || ${#FILES} -gt 0 ]] || { echo "nothing to deploy: .front-log.md is empty and the tree is clean"; exit 1; }
[[ ${#FILES} -gt 0 ]] || { echo "the log has entries but no file changed (already committed?)"; exit 1; }

# the full gate (CLAUDE.md); a CSS/text edit in a functions/ page template is allowed (deploy:ui copies functions/)
GATE=$(printf '%s\n' $FILES | grep -E '^(trade\.js|engine\.js|tradelink\.js|persist\.js|core/|host/|server/|migrations/|functions/api/)' || true)
if [[ -n "$GATE" ]]; then echo "full-gate files changed — use npm run deploy with the full suite:"; echo "$GATE"; exit 1; fi

echo "files:"; printf '  %s\n' $FILES
[[ -n "$NEW" ]] && { echo "new untracked files, NOT committed (git add them first if they belong to this deploy):"; echo "$NEW" | sed 's/^/  /'; }
[[ -n "$ENTRIES" ]] && { echo "log:"; echo "$ENTRIES"; } || echo "log: (empty — the commit gets a generic message)"

if (( TESTS )); then
  IDS=$(node tools/front-tests.mjs --why 2> >(sed 's/^/  /' >&2))
  if [[ -z "$IDS" ]]; then echo "area tests: none mention what changed (pure styling or an untested area)";
  else
    echo "area tests: $IDS"
    if (( ! DRY )); then
      # streamed, not captured: a progress bar while it runs, a failure shown the moment it happens, the full log in .front-tests.log
      TLOG=.front-tests.log
      node tests/run.mjs "$IDS" 2>&1 | node tools/test-progress.mjs $TLOG; RC=${pipestatus[1]}
      (( RC == 0 )) || { echo "DEPLOY STOPPED: area tests failed (full log: $TLOG)"; exit 1; }
    fi
  fi
else echo "area tests: skipped (--no-tests)"; fi

(( DRY )) && { echo "--dry: no deploy, no commit"; exit 0; }

echo "deploying (npm run deploy:ui, ~1 min)…"
OUT=$(npm run deploy:ui 2>&1) && RC=0 || RC=$?
print -r -- "$OUT" | tail -n 2
(( RC == 0 )) || { echo "DEPLOY FAILED (npm run deploy:ui exit $RC); nothing committed"; print -r -- "$OUT" | tail -n 20; exit 1; }
BUILD=$(grep -o "MFX_BUILD *= *'[^']*'" dist/index.html | head -1 | sed "s/.*'\(.*\)'/\1/")
[[ -n "$BUILD" ]] || { echo "no MFX_BUILD in dist/index.html"; exit 1; }
# the current build is the first "build **xxxxxxxx**" (the line "Versiune: … · build **…**"); older builds named later stay
OLD=$(grep -oE 'build \*\*[0-9a-f]{8}\*\*' ../CITESTE-MA.md | head -1 | grep -oE '[0-9a-f]{8}')
if [[ -n "$OLD" && "$OLD" != "$BUILD" ]]; then sed -i '' "s/build \*\*$OLD\*\*/build **$BUILD**/" ../CITESTE-MA.md; fi

SUBJ=$(echo "$ENTRIES" | head -1 | sed -E 's/^- [0-9.]+ · //'); SUBJ=${SUBJ[1,72]}   # zsh: characters, not bytes (cut -c splits ă/ș)
[[ -n "$SUBJ" ]] || SUBJ="UI changes"
git add -- $FILES
git commit -q -F - <<EOF
ui: $SUBJ

${ENTRIES:-}

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
print -r -- "$HEAD_LINE" > $LOG
echo "live: build $BUILD, commit $(git log --oneline -1)"
