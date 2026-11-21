#!/usr/bin/env bash
# test_publish.sh — prove scripts/publish-data.sh publishes without merging, and that it
# does not revert a concurrent commit.
#
# The real workflows cannot be exercised from a sandbox that cannot reach the demo API or
# the Actions log host, but the publishing logic is pure git and CAN be tested here against
# a scratch bare repository. This script does exactly that, and it is what lets the claim
# "the publish step cannot merge and cannot revert" be a tested statement rather than an
# assertion.
#
#   bash tools/test_publish.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER="$ROOT/scripts/publish-data.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "TEST FAILED: $*" >&2; exit 1; }
ok()   { echo "  ok: $*"; }

REMOTE="$TMP/remote.git"
git init --quiet --bare "$REMOTE"

# a first commit on the branch the helper will publish to
git init --quiet "$TMP/seed"
cd "$TMP/seed"
git config user.name seed
git config user.email seed@example.com
git checkout --quiet -b main
echo '{"v":1}' > data.json
mkdir -p site && echo '<html>seed</html>' > site/page.html
git add -A && git commit --quiet -m "seed"
git remote add origin "$REMOTE"
git push --quiet origin main
# Point the bare repository's HEAD at the branch we publish to, so a clone checks it out.
git --git-dir="$REMOTE" symbolic-ref HEAD refs/heads/main

echo "test 1: a normal publish is a fast-forward and creates no merge commit"
git clone --quiet "$REMOTE" "$TMP/writer"
cd "$TMP/writer"
git config user.name writer
git config user.email writer@example.com
echo '{"v":2}' > data.json                       # pretend the generator produced this
bash "$HELPER" main "test: publish" ':(top)data.json' > "$TMP/log1" 2>&1 || { cat "$TMP/log1"; fail "publish exited non-zero"; }
grep -q "published to origin/main" "$TMP/log1" || { cat "$TMP/log1"; fail "helper did not report a successful publish"; }
PARENT_COUNT=$(git rev-list --parents -n 1 HEAD | wc -w)
[ "$PARENT_COUNT" -eq 2 ] || fail "the published commit has $((PARENT_COUNT-1)) parents — a merge was created"
git rev-parse HEAD > "$TMP/head1"

echo "test 2: a second publish with no changes is a no-op"
BEFORE="$(git rev-parse HEAD)"
bash "$HELPER" main "test: publish again" ':(top)data.json' > "$TMP/log2" 2>&1 || { cat "$TMP/log2"; fail "second publish exited non-zero"; }
grep -q "nothing to publish" "$TMP/log2" || { cat "$TMP/log2"; fail "the second publish did not report a no-op"; }
[ "$(git rev-parse HEAD)" = "$BEFORE" ] || fail "a no-op publish moved HEAD"
ok "no-op publish left the branch untouched"

echo "test 3: a concurrent commit is neither reverted nor merged over"
git clone --quiet "$REMOTE" "$TMP/other"
cd "$TMP/other"
git config user.name other
git config user.email other@example.com
echo "other author's work" > theirs.txt
git add -A && git commit --quiet -m "other: unrelated change"
git push --quiet origin main
cd "$TMP/writer"
echo '{"v":3}' > data.json                       # our generated file, made before the other push
bash "$HELPER" main "test: publish over a moved branch" ':(top)data.json' > "$TMP/log3" 2>&1 || { cat "$TMP/log3"; fail "publish over a moved branch exited non-zero"; }
git fetch --quiet origin main
git show origin/main:theirs.txt | grep -q "other author's work" \
  || fail "the concurrent commit was reverted by the publish"
PARENT_COUNT=$(git rev-list --parents -n 1 HEAD | wc -w)
[ "$PARENT_COUNT" -eq 2 ] || fail "the published commit has $((PARENT_COUNT-1)) parents — a merge was created"
git merge-base --is-ancestor "$(git rev-parse origin/main~1)" HEAD \
  || fail "the published commit is not a descendant of the remote tip"
ok "the other author's commit survived and the publish stayed a fast-forward"

echo "test 4: only the given pathspecs are published"
cd "$TMP/writer"
echo "not ours" > not-ours.txt
bash "$HELPER" main "test: scoped publish" ':(top)data.json' > "$TMP/log4" 2>&1 || { cat "$TMP/log4"; fail "scoped publish exited non-zero"; }
git fetch --quiet origin main
git show origin/main:not-ours.txt >/dev/null 2>&1 \
  && fail "a file outside the pathspec was published"
ok "files outside the pathspec were left alone"

echo "test 5: the helper refuses a missing pathspec with a clear annotation"
if bash "$HELPER" main "test: no paths" > "$TMP/log5" 2>&1; then
  fail "the helper accepted a call with no pathspec"
fi
grep -q "::error::" "$TMP/log5" || { cat "$TMP/log5"; fail "the helper did not emit a ::error:: annotation"; }
ok "missing pathspec is rejected with an annotation"

echo
echo "ALL PUBLISH TESTS PASSED"
