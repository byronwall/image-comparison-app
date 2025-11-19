#!/bin/sh

# Usage: sh git-generate-rebase.sh [directory-path] [base-branch]
# Example: sh git-generate-rebase.sh ./client main

DIR=${1:-.}
BASE=${2:-main}

# 1. Navigate to directory safely
if [ -d "$DIR" ]; then
    cd "$DIR" || exit 1
else
    echo "❌ Directory '$DIR' does not exist."
    exit 1
fi

# Verify git repo
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo "❌ '$DIR' is not a valid git repository."
    exit 1
fi

CURRENT=$(git rev-parse --abbrev-ref HEAD)

# Use %s with printf to avoid errors if strings contain dashes
printf "\n🔍 Analyzing branch '\033[1;36m%s\033[0m' against base '\033[1;36m%s\033[0m' in %s\n" "$CURRENT" "$BASE" "$DIR"
printf "   (Identifying ghost files and building rebase plan...)\n"

# ---------------------------------------------------------
# PHASE 1: Identify Ghost Files
# ---------------------------------------------------------
# We use command substitution to capture the list without temp files.
# This loop runs in a subshell and echos valid ghosts to stdout, which GHOST_FILES captures.

GHOST_FILES=$(
    git log --name-only --pretty=format: --no-merges "$BASE..$CURRENT" | sort -u | grep -v '^$' | while IFS= read -r file; do
        is_ghost=0
        
        if [ -f "$file" ]; then
            # File exists: Check if it matches BASE exactly (Net Zero)
            if git diff --quiet "$BASE" "$CURRENT" -- "$file"; then
                is_ghost=1
            fi
        else
            # File is missing: Check if it exists in BASE
            # If missing in Branch AND missing in Base, it was Created then Deleted (Temp)
            if ! git show "$BASE:$file" > /dev/null 2>&1; then
                is_ghost=1
            fi
        fi

        if [ "$is_ghost" -eq 1 ]; then
            echo "$file"
        fi
    done
)

if [ -z "$GHOST_FILES" ]; then
    echo "✅ No ghost files found. Your branch is clean relative to $BASE!"
    exit 0
fi

# Count lines in GHOST_FILES (POSIX compatible way)
ghost_count=$(echo "$GHOST_FILES" | grep -c -v '^$')
printf "👻 Identified \033[1;33m%d\033[0m ghost files.\n" "$ghost_count"
printf "%s\n" "------------------------------------------------------------"

# ---------------------------------------------------------
# PHASE 2: Generate Rebase Plan & Print Immediately
# ---------------------------------------------------------

printf "\n👇 COPY AND PASTE THE BLOCK BELOW INTO YOUR EDITOR 👇\n"
printf "   (Run: git rebase -i %s)\n" "$BASE"
printf "%s\n" "============================================================"

# Read commits Oldest -> Newest.
# We use a pipe | which is standard sh, instead of process substitution <()
# IFS='|' splits the hash and message.
git log --reverse --no-merges --format="%h|%s" "$BASE..$CURRENT" | while IFS='|' read -r hash msg; do
    
    # Get files changed in this specific commit
    commit_files=$(git show --name-only --pretty=format: "$hash")
    
    files_to_reset=""
    files_to_remove=""
    
    total_files_in_commit=0
    ghosts_in_commit=0
    
    # Process files in this commit.
    # We must use a 'here-string' workaround or just echo into a loop to be POSIX-ish
    # simpler to just iterate over the variable content with a loop
    for f in $commit_files; do
        if [ -z "$f" ]; then continue; fi
        total_files_in_commit=$((total_files_in_commit + 1))
        
        # Check if f is in GHOST_FILES
        # grep -F (fixed string) -x (whole line match) -q (quiet)
        if echo "$GHOST_FILES" | grep -Fxq "$f"; then
            ghosts_in_commit=$((ghosts_in_commit + 1))
            
            # Determine action
            if git show "$BASE:$f" > /dev/null 2>&1; then
                files_to_reset="$files_to_reset $f"
            else
                files_to_remove="$files_to_remove $f"
            fi
        fi
    done

    # --- OUTPUT LOGIC ---
    
    if [ "$total_files_in_commit" -eq 0 ]; then
        # Empty commit (or merge artifact)
        echo "pick $hash $msg"
        
    elif [ "$total_files_in_commit" -eq "$ghosts_in_commit" ]; then
        # ALL files are ghosts -> DROP
        echo "drop $hash $msg"
        
    elif [ "$ghosts_in_commit" -gt 0 ]; then
        # Mixed content -> PICK + EXEC
        echo "pick $hash $msg"
        
        cmd=""
        
        # 1. Handle Resets
        if [ -n "$files_to_reset" ]; then
            # Normalize spaces
            clean_reset=$(echo "$files_to_reset" | xargs)
            cmd="git checkout $BASE -- $clean_reset"
        fi
        
        # 2. Handle Removes
        if [ -n "$files_to_remove" ]; then
            clean_remove=$(echo "$files_to_remove" | xargs)
            if [ -n "$cmd" ]; then cmd="$cmd && "; fi
            cmd="${cmd}git rm -f $clean_remove"
        fi
        
        # 3. Amend
        cmd="${cmd} && git commit --amend --no-edit"
        
        echo "exec $cmd"
        
    else
        # Normal commit
        echo "pick $hash $msg"
    fi

done

printf "%s\n" "============================================================"