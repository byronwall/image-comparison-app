#!/bin/bash
# Usage: bash audit-ghosts.sh [base-branch]

BASE=${1:-main}
CURRENT=$(git rev-parse --abbrev-ref HEAD)

# Temp file to store the list of ghost files for the next script to use
GHOST_FILE_LIST="ghost_files.tmp"
> "$GHOST_FILE_LIST"

printf "\n🔍 Scanning branch '%s' for Net-Zero (Ghost) files...\n" "$CURRENT"
printf "============================================================\n"

# 1. Find files that have history but currently match main (or are deleted)
#    We look at the log to find candidate files, then diff them.
files=$(git log --name-only --pretty=format: --no-merges "$BASE..$CURRENT" | sort -u | grep -v '^$')

count=0

IFS=$'\n'
for file in $files; do
    # Check if file exists in current branch
    if [ ! -f "$file" ]; then
        # It's missing. Check if it exists in Main.
        if ! git show "$BASE:$file" > /dev/null 2>&1; then
            # Missing in Branch, Missing in Main = Created then Deleted (Temp)
            printf "👻 TEMP FILE: %s\n" "$file"
            echo "$file" >> "$GHOST_FILE_LIST"
            count=$((count+1))
        fi
        continue
    fi

    # Check if file matches Main exactly
    if git diff --quiet "$BASE" "$CURRENT" -- "$file"; then
        printf "👻 GHOST CHANGE: %s\n" "$file"
        echo "$file" >> "$GHOST_FILE_LIST"
        count=$((count+1))
    fi
done
unset IFS

printf "============================================================\n"
printf "Found %d Ghost/Temp files. Saved list to %s\n" "$count" "$GHOST_FILE_LIST"