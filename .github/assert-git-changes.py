#!/usr/bin/python3
import subprocess

git_changes = subprocess.getoutput("git status --porcelain")

print(git_changes)

if git_changes != "":
    print("Git changes detected! Failing")
    exit(1)
