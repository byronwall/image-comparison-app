#!/bin/bash

BASE=${1:-main}
CURRENT=$(git rev-parse --abbrev-ref HEAD)

printf "\n🔍 Deep Scanning branch '%s' against base '%s'...\n" "$CURRENT" "$BASE"
printf "   Strategy: Scanning commit log for ALL touched files, then checking status.\n"
printf "============================================================\n"

# 1. Build the candidate list from the LOG, not the DIFF.
#    This finds files that were touched even if they look identical now.
#    -r: recursive (scans trees)
#    --name-only: just filenames
#    --no-merges: ignore merge commits
#    --format="": suppress commit info, just want file list
printf "[DEBUG] Generating file list from git log...\n"
files=$(git log --name-only --pretty=format: --no-merges "$BASE..$CURRENT" | sort -u | grep -v '^$')

count_ghost=0
count_messy=0
count_active=0

IFS=$'\n'
for file in $files; do
    # Skip if file no longer exists (e.g. was added then deleted)
    # (Optional: remove this check if you want to clean up 'deleted' files history too)
    if [ ! -f "$file" ]; then 
        # Check if it exists in BASE. If it does, it was deleted.
        # If it doesn't, it was a temporary file created and deleted in this branch.
        if git show "$BASE:$file" > /dev/null 2>&1; then
             : # File exists in base, was deleted here.
        else
             # File was temporary (Added then Deleted). 
             # This IS a Net-Zero change (Nothing -> Nothing), so we treat it as a Ghost.
             printf "👻 \033[1;35mTEMP FILE\033[0m: %s (Created then Deleted)\n" "$file"
             # List commits so you can drop them
             git log --oneline --no-merges "$BASE..$CURRENT" -- "$file" | sed 's/^/      /'
             count_ghost=$((count_ghost+1))
             continue
        fi
    fi

    # 2. Check if the file matches BASE exactly (Net Zero)
    git diff --quiet "$BASE" "$CURRENT" -- "$file"
    diff_exit_code=$?

    # 3. Check if "Revert" appears in the history for this file
    has_revert=$(git log --oneline --no-merges "$BASE..$CURRENT" -- "$file" | grep -i "Revert ")

    if [ $diff_exit_code -eq 0 ]; then
        # Matches Base perfectly
        printf "👻 \033[1;34mGHOST CHANGE\033[0m: %s\n" "$file"
        printf "      (File matches main, but has history in this branch. Safe to DROP commits.)\n"
        
        # Print the commits involved so you know what to drop
        git log --oneline --no-merges "$BASE..$CURRENT" -- "$file" | sed 's/^/      /'
        count_ghost=$((count_ghost+1))

    elif [ -n "$has_revert" ]; then
        # Does NOT match base, but has Revert history
        printf "⚠️  \033[1;33mMESSY REVERT\033[0m: %s\n" "$file"
        printf "      (Matches your issue: Has 'Revert' commit, but file still differs from main)\n"
        count_messy=$((count_messy+1))
    else
        # Normal file
        # printf "📝 ACTIVE: %s\n" "$file"
        count_active=$((count_active+1))
    fi
done
unset IFS

printf "============================================================\n"
printf "Summary:\n"
printf "  %d Ghost Files (Net Zero - Safe to drop history)\n" "$count_ghost"
printf "  %d Messy Files (Reverted but dirty - Needs Edit/Squash)\n" "$count_messy"
printf "  %d Active Files (Normal changes)\n" "$count_active"
printf "============================================================\n"