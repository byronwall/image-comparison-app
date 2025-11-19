#!/bin/bash
# Usage: bash generate-cleanup-plan.sh [base-branch]

BASE=${1:-main}
CURRENT=$(git rev-parse --abbrev-ref HEAD)
GHOST_LIST="ghost_files.tmp"

# Ensure the ghost list exists (run the auditor if needed)
if [ ! -f "$GHOST_LIST" ]; then
    echo "❌ Ghost list not found. Running auditor first..."
    bash audit-ghosts.sh "$BASE"
fi

printf "\n📋 GENERATING REBASE PLAN...\n"
printf "------------------------------------------------------------\n"

# Arrays to store instructions
declare -a DROP_INSTRUCTIONS
declare -a EDIT_INSTRUCTIONS

# 1. Loop through every commit in the branch
#    Read hash and subject
git log --no-merges --format="%h %s" "$BASE..$CURRENT" | while read -r line; do
    hash=$(echo "$line" | awk '{print $1}')
    msg=$(echo "$line" | cut -d ' ' -f 2-)
    
    # Get files changed in this specific commit
    commit_files=$(git show --name-only --pretty=format: "$hash")
    
    total_files=0
    ghost_files_count=0
    
    # Check every file in this commit
    while read -r f; do
        if [ -z "$f" ]; then continue; fi
        total_files=$((total_files+1))
        
        # Check if this file is in our Ghost List
        if grep -Fqx "$f" "$GHOST_LIST"; then
            ghost_files_count=$((ghost_files_count+1))
        fi
    done <<< "$commit_files"

    # 2. Analyze Commit Type
    if [ "$total_files" -eq 0 ]; then
        # Empty commit?
        continue
    elif [ "$total_files" -eq "$ghost_files_count" ]; then
        # ALL files in this commit are ghosts. Safe to DROP.
        echo "DROP|$hash|$msg"
    elif [ "$ghost_files_count" -gt 0 ]; then
        # Some files are ghosts, some are valid. Must EDIT.
        echo "EDIT|$hash|$msg"
    fi
done > cleanup_analysis.tmp

# 3. Output the Strategy
printf "\n👉 ACTION 1: Run this command:\n"
printf "   git rebase -i %s\n\n" "$BASE"

printf "👉 ACTION 2: When the editor opens, apply these changes:\n"
printf "   (I have analyzed which commits are safe to drop vs edit)\n\n"

# Print Drops
grep "^DROP" cleanup_analysis.tmp | while IFS='|' read -r type hash msg; do
    printf "   \033[0;31mdrop\033[0m %s %s \033[0;90m(All files were reverted)\033[0m\n" "$hash" "$msg"
done

# Print Edits
grep "^EDIT" cleanup_analysis.tmp | while IFS='|' read -r type hash msg; do
    printf "   \033[0;33medit\033[0m %s %s \033[0;90m(Mixed content - requires manual fix)\033[0m\n" "$hash" "$msg"
done

printf "\n"
printf "👉 ACTION 3: Handling 'edit' commits (if any):\n"
if grep -q "^EDIT" cleanup_analysis.tmp; then
    printf "   When the rebase stops at an 'edit' step:\n"
    printf "   1. Run: \033[0;32mgit checkout %s -- <ghost_file_path>\033[0m\n" "$BASE"
    printf "      (Use the list below to know which files to reset)\n"
    printf "   2. git commit --amend --no-edit\n"
    printf "   3. git rebase --continue\n"
else
    printf "   No mixed commits found! You can likely just Drop the lines above and be done.\n"
fi

rm cleanup_analysis.tmp