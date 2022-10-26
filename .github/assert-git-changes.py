#!/usr/bin/python3
import subprocess
import os

target_dir = os.environ.get("TARGET_DIR")

git_changes = subprocess.getoutput("git status --porcelain")
print(f"Changes:\n{git_changes}")

if not target_dir and git_changes:
    print(f"Changes detected! Failing")
    exit(1)

if git_changes.find(target_dir) > 0:
    print(f"Changes in {target_dir} detected! Failing")
    exit(1)
