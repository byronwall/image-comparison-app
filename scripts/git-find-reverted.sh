#!/bin/bash

# Usage: bash git-find-reverted.sh [base-branch]
BASE=${1:-main}
CURRENT=$(git rev-parse --abbrev-ref HEAD)

printf "Checking for net-zero changes between '%s' and '%s'...\n" "$BASE" "$CURRENT"
echo "---------------------------------------------------------"

# 1. Find files that look changed in history but are identical at the end
files=$(git diff --name-only "$BASE...$CURRENT")

found_any=false
IFS=$'\n' # Handle filenames with spaces

for file in $files; do
    # Check if file matches base (Net Zero)
    printf "Checking file: %s\n" "$file"
    if git diff --quiet "$BASE" "$CURRENT" -- "$file"; then
        found_any=true
        printf "\n📂 File: \033[1;34m%s\033[0m ended up with NO changes.\n" "$file"
        
        # --- THE FIX IS HERE: --full-history ---
        commits=$(git log --oneline --no-merges --full-history "$BASE..$CURRENT" -- "$file")
        
        if [ -z "$commits" ]; then
             echo "   (Still no commits? Check if file was renamed)"
        else
             echo "$commits" | sed 's/^/   - /'
        fi
    fi
done
unset IFS

if [ "$found_any" = false ]; then
    echo "No files with net-zero changes found."
fi
echo ""
echo "---------------------------------------------------------"