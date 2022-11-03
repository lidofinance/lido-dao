#!/usr/bin/python3
import subprocess
import os

target = os.environ.get("TARGET")

git_changes = subprocess.getoutput("git status --porcelain")

if git_changes:
    print(f"Changes:\n{git_changes}")
    if not target:
        print(f"Changes detected! Failing")
        exit(1)
    elif git_changes.find(target) > 0:
        print(f"Changes in {target} detected! Failing")
        exit(1)
else:
    print(f"No changes detected")
