#!/usr/bin/env bash
# publish-data.sh — publish generated data to a branch without ever merging.
#
# WHY THIS EXISTS
# ---------------
# Three workflows write generated files to `main` (keepalive.yml, live-alerts.yml,
# refresh-data.yml). All three used to publish with
#
#     git fetch origin <branch> ; git rebase FETCH_HEAD ; git push origin HEAD:<branch>
#
# and every scheduled run of two of them failed at that step. The raw Actions log host
# (productionresultssa32.blob.core.windows.net) is not reachable from the repository's
# tooling, so the exact failing command could never be read; the only machine-readable
# evidence was the job annotation "Process completed with exit code 2".
#
# What is verifiable without the logs, and is enough to explain a permanent failure:
#
#   1. The three workflows used THREE DIFFERENT `concurrency` groups
#      (`writer-${{ github.ref }}`, `live-alerts`, `refresh-data-${{ github.ref }}`), even
#      though keepalive.yml's own header comment claims the other two "queue behind this
#      one instead of racing it (see the shared group name in live-alerts.yml and
#      refresh-data.yml)". They were never actually sharing a group, so all three ran
#      concurrently against the same branch.
#   2. They publish OVERLAPPING FILES. keepalive stages `data/` (which contains
#      data/live/feed.json and data/live/state.json) and live-alerts stages `data/live/`
#      (the same two files); refresh-data stages `'*.html'`, which in git pathspec terms
#      matches all 90 HTML files in the tree, including the hand-written `archive/` copy.
#      `git rebase` between two commits that touch the same generated JSON conflicts by
#      construction, and the old scripts treated a failed rebase as fatal.
#   3. `git rebase FETCH_HEAD` also silently replays a commit onto a tip it was never
#      tested against, so a losing writer could publish a stale sample over a newer one.
#
# THE FIX — publish by moving, never by merging
# ---------------------------------------------
# This helper never creates a merge and never rebase. It:
#
#   1. fetches the remote tip into FETCH_HEAD;
#   2. moves HEAD and the index onto that tip with `git reset --mixed FETCH_HEAD`,
#      which leaves the working tree — and therefore the files this run just generated —
#      completely untouched;
#   3. stages ONLY the pathspecs it was given;
#   4. commits on top of the fetched tip, so the commit's parent IS the remote tip;
#   5. pushes, which is then a plain fast-forward.
#
# There is no merge, so there is nothing to conflict. If the branch moved while the run was
# in flight, the push is rejected, the helper re-fetches and starts again from the new tip.
# Files the remote changed that this run did not regenerate are never staged, so a writer
# can no longer revert someone else's work.
#
# Usage:
#   scripts/publish-data.sh <branch> <commit message> <pathspec>...
#
# Every failure path emits a `::error::` workflow annotation. That matters: the raw log
# host is unreachable from some environments, but annotations are always readable through
# the GitHub API, so a future failure is diagnosable without the log.
set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "::error::publish-data.sh: usage: publish-data.sh <branch> <message> <pathspec>..."
  exit 2
fi

BRANCH="$1"
MESSAGE="$2"
shift 2
PATHS=("$@")

if [ "${#PATHS[@]}" -eq 0 ]; then
  echo "::error::publish-data.sh: no pathspec given"
  exit 2
fi

git config user.name  'kalshidash1-engine'
git config user.email 'engine@users.noreply.github.com'

for attempt in 1 2 3 4 5; do
  echo "publish attempt ${attempt}/5 -> origin/${BRANCH} (paths: ${PATHS[*]})"

  if ! git fetch origin "$BRANCH"; then
    echo "::error::could not fetch origin/${BRANCH}"
    exit 1
  fi

  # Move HEAD and the index onto the fetched tip. The working tree is deliberately left
  # alone: it holds the files this run generated.
  if ! git reset --mixed FETCH_HEAD; then
    echo "::error::could not reset the working tree onto origin/${BRANCH}"
    exit 1
  fi

  if ! git add -- "${PATHS[@]}"; then
    echo "::error::could not stage ${PATHS[*]}"
    exit 1
  fi

  if git diff --cached --quiet; then
    echo "Nothing changed in ${PATHS[*]} — nothing to publish."
    exit 0
  fi

  if ! git commit -m "$MESSAGE"; then
    echo "::error::git commit failed"
    exit 1
  fi

  if git push origin "HEAD:${BRANCH}"; then
    echo "published to origin/${BRANCH} on attempt ${attempt}"
    exit 0
  fi

  echo "::warning::push attempt ${attempt} was rejected (the branch moved) — retrying from the new tip"
  sleep $((attempt * 5))
done

echo "::error::could not publish to origin/${BRANCH} after 5 attempts"
exit 1
