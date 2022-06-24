#!/usr/bin/python3
from pathlib import Path
import fileinput
import shutil
import os

INFURA_PROJECT_ID = os.environ.get("INFURA_PROJECT_ID")
ETHERSCAN_API_KEY = os.environ.get("ETHERSCAN_API_KEY")

ACCOUNTS_TMPL = Path("./accounts.sample.json")
ACCOUNTS = Path("./accounts.json")


def main():
    shutil.copyfile(ACCOUNTS_TMPL, ACCOUNTS)
    with fileinput.FileInput(ACCOUNTS, inplace=True) as file:
        for line in file:
            updated_line = line.replace("INFURA_PROJECT_ID", INFURA_PROJECT_ID)
            updated_line = updated_line.replace("ETHERSCAN_API_KEY", ETHERSCAN_API_KEY)
            print(updated_line, end="")


if __name__ == "__main__":
    main()
