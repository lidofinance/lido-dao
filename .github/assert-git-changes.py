#!/usr/bin/python3
import subprocess
import os

target_dir = os.environ.get("TARGET_DIR")

if not target_dir:
    print("No TARGET_DIR env variable provided. Exiting")
    exit(1)

git_changes = subprocess.getoutput("git status --porcelain")
print(f"Changes:\n{git_changes}")

if git_changes.find(target_dir) > 0:
    print(f"Changes in {target_dir} detected! Failing")
    exit(1)
