# Contribution Guide

Welcome to the Lido Contribution Guide! Thank you for your interest in contributing to Lido! Join our community of contributors who are passionate about advancing liquid staking. Whether you're fixing a bug, adding a new feature, or improving the documentation, your contribution is valuable and your effort to make Lido better is appreciated.

## Ways to Contribute

### Opening an Issue

Issues are a great way to contribute to the project by reporting bugs or suggesting enhancements.

- **Bug Reports**. If you encounter a bug, please report it using the GitHub issues feature. Check first to ensure the bug hasn't already been reported. If it has, you can contribute further by adding more detail to the existing report. _Note that this only relates to off-chain code (tests, scripts, etc.), for bugs in contracts and protocol vulnerabilities, please refer to [Bug Bounty](/README.md#bug-bounty)_.

- **Feature Requests**: Have an idea for a new feature or an improvement to an existing one? Submit a feature request through the GitHub issues, detailing your proposed enhancements and how they would benefit the Lido Finance Core.

### Improving Documentation

Good documentation is crucial for any project. If you have suggestions for improving the documentation, or if you've noticed an omission or error, making these corrections is a significant contribution. Whether it's a typo, additional examples, or clearer explanations, your help in making the documentation more accessible and understandable is highly appreciated.

For expansive documentation, visit the [Lido Docs repo](https://github.com/lidofinance/core).

### Contributing to codebase

Contributing by resolving open issues is a valuable way to help improve the project. Look through the existing issues for something that interests you or matches your expertise. Don't hesitate to ask for more information or clarification if needed before starting. If you're interested in improving tooling and CI in this repository, consider opening a feature request issue first to discuss it with the community of contributors.

If you have a bigger idea on how to improve the protocol, consider publishing your proposal to [Lido Forum](https://research.lido.fi/).

## Getting started

### Requirements

- [Node.js v20](https://nodejs.org/en)
- [Pnpm](https://pnpm.io/)
- [Foundry](https://book.getfoundry.sh/)

### Setup

> Installation is local and doesn't require root privileges.

Install dependencies

```bash
pnpm install
```

### Test

Run Hardhat tests

```bash
pnpm test
```

See `package.json` for more commands.
