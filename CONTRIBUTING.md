# Lido Contribution Guide

Welcome to the Lido Contribution Guide! Thank you for your interest in contributing to Lido! Join our community of
contributors who are passionate about advancing liquid staking. Whether you're fixing a bug, adding a new feature, or
improving the documentation, your contribution is valuable and your effort to make Lido better is appreciated.

## Ways to Contribute

### Opening an Issue

> [!IMPORTANT]
> For bugs in contracts and protocol vulnerabilities, please refer to the [Bug Bounty](/README.md#bug-bounty) program!

Issues are a great way to contribute to the project by reporting bugs or suggesting enhancements.

- **Bug Reports**: If you encounter a bug, please report it using the GitHub issues feature. Before submitting, check if
  the bug has already been reported. If it has, you can contribute by adding more details to the existing report. This
  only applies to off-chain code (tests, scripts, etc.). For on-chain code, please refer to
  the [Bug Bounty](/README.md#bug-bounty) program.

- **Feature Requests**: Have an idea for a new feature or an improvement to an existing one? Submit a feature request
  through GitHub issues, detailing your proposed enhancements and how they would benefit the Lido Finance Core.

### Improving Documentation

Good documentation is crucial for any project. If you notice areas where the documentation can be improved, whether it's
fixing typos, adding examples, or clarifying explanations, your contributions are highly valued. These improvements help
make the project more accessible and understandable for everyone.

For more extensive documentation, visit the [Lido Docs repository](https://github.com/lidofinance/docs).

### Contributing to the Codebase

Resolving open issues is a valuable way to contribute to the project. Browse through existing issues to find something
that interests you or matches your expertise. Don't hesitate to ask for more information or clarification before you
start working on an issue.

If you're interested in improving tooling and CI in this repository, consider opening a feature request issue first to
discuss your ideas with the community of contributors.

For larger ideas on how to improve the protocol, consider publishing your proposal in
the [Lido Forum](https://research.lido.fi/).

## Getting Started

### Requirements

- [Node.js](https://nodejs.org/en) version 20 (LTS) with `corepack` enabled
- [Yarn](https://yarnpkg.com/) installed via corepack (see below)
- [Foundry](https://book.getfoundry.sh/) latest available version

> [!NOTE]
> On macOS with Homebrew, it is recommended to install Node.js using [`n`](https://github.com/tj/n)
> or [`nvm`](https://github.com/nvm-sh/nvm) version managers.
> Example setup process using `n` package manager for zsh users:
>
> ```bash
> brew install n
> echo "\n\nexport N_PREFIX=\$HOME/.local\nexport PATH=\$N_PREFIX/bin:\$PATH" >> ~/.zshrc
> source ~/.zshrc
> n lts
> corepack enable
> cd /path/to/core
> yarn
> ```

### Setup

> Installation is local and doesn't require root privileges.

To set up the project:

#### Clone the Repository

```bash
git clone https://github.com/lidofinance/core.git lido-core
cd lido-core
```

#### Install Project Dependencies

```bash
yarn install
```

#### Verify Setup with Tests (Optional)

```bash
yarn test
```

If you encounter any issues during setup, please open an issue on GitHub.

## Repository Structure

### Contracts

Production contracts are located in the `/contracts` directory at the root of the project. Subdirectory names indicate the
Solidity version of the contracts they contain. For example, contracts in `/contracts/0.4.24` are written in Solidity v0.4.24.
Common interfaces and libraries shared by contracts of different versions are located in the `/contracts/common` subdirectory.

### Tests

This repository uses both Hardhat and Foundry for testing:

- Hardhat offers greater flexibility for writing complex tests.
- Foundry's fuzzing capabilities provide better coverage of edge cases.

All tests are all located in `/tests` at the root of the project.
Each subdirectory name corresponds to the version of the contract being tested, mirroring the `/contracts` directory
structure. Integration, regression, and other non-unit tests are placed into corresponding subdirectories,
e.g. `/tests/integration`, `/tests/regression`, etc.

For creating mocks or harness contracts for external dependencies, refer to the [Mocking and Harnessing Contracts](#mocking-and-harnessing-contracts) section for guidance.

#### Unit Tests

Unit tests are crucial for ensuring the functionality of individual contracts and their components. These tests should be written using Hardhat and placed in the `/tests` directory. Each subdirectory should correspond to the version of the contract being tested, mirroring the structure of the `/contracts` directory.

Follow the naming convention `*.test.ts` for unit test files, such as `myContract.test.ts`. This convention aids in the easy identification and organization of tests.

##### Coverage

The project utilizes the `hardhat-coverage` plugin to generate coverage reports. Note that Foundry tests are not included in the coverage.

#### Integration Tests

Integration tests are located in the `/tests/integration` directory at the root of the project. These tests verify the interaction between different contracts and their behavior in real-world scenarios. The naming convention for integration tests follows the `*.integration.ts` postfix, for example, `myScenario.integration.ts`.

To run integration tests, ensure you have a `.env` file in the root of the project. You can use the `.env.example` file as a template.

#### Fuzzing and Invariant Tests

Foundry's Solidity tests are specifically used for fuzzing library contracts or functions that perform complex calculations
or byte manipulation. These Solidity tests are located under `/tests` and organized into appropriate subdirectories. The naming conventions follow Foundry's [documentation](https://book.getfoundry.sh/tutorials/best-practices#general-test-guidance):

- For tests, use the `.t.sol` postfix (e.g., `MyContract.t.sol`).
- For scripts, use the `.s.sol` postfix (e.g., `MyScript.s.sol`).
- For helpers, use the `.h.sol` postfix (e.g., `MyHelper.h.sol`).

It is crucial to follow these naming conventions to distinguish Hardhat test files from Foundry-related files, ensuring the
proper execution of Hardhat tests.

#### Mocking and Harnessing Contracts

The `/tests` directory also contains contract mocks and helpers, which are placed in the `.../contracts` subdirectory,
e.g., `/tests/0.4.24/contracts`. Mocks and helpers do not need to be written using the same version of Solidity as the
contract being tested. For example, it is acceptable to have a mock contract written in Solidity v0.8.9
in `/tests/0.4.24/contracts`.

- Use the `__Harness` postfix for wrappers that expose private functions of a contract and may include test-specific
  actions. For example, `MyContract__Harness.sol` or `MyContract__HarnessForAnotherContract.sol`.
- Use the `__Mock` postfix for contracts that simulate the behavior of the target contract. For example,
  `MyContract__Mock.sol` or `MyContract__MockForAnotherContract.sol`.

### Library

TypeScript utilities and helpers are located in the `/lib` directory at the root of the project. When adding a new file to this directory, ensure you re-export all new modules from the `/lib/index.ts` file to maintain clean and organized import statements.

### Typechain Types

The Typechain types are located in the `/typechain-types` directory at the root of the project.

> [!WARNING]
> Do not manually edit any files in this directory, as they are autogenerated with each compilation.

If you encounter issues with your IDE not properly indexing this directory and causing import errors, try the following solutions:

- Open the `/typechain-types/index.ts` file to prompt the IDE to index it.
- Delete the `/typechain-types` directory and recompile the project using `yarn hardhat compile --force`.

### Configuration Files

All configuration files can be found in the root directory of the project. This includes files for environment variables, build settings, and other project-specific configurations.

## Conventions

All contributions must adhere to the following established conventions.

### Solidity Code

- Must be autoformatted using Solhint
- Generally follows the [Official Solidity Style Guide](https://docs.soliditylang.org/en/latest/style-guide.html), with
  some project-specific exceptions
- When writing new contracts, refer to existing ones for project-specific conventions, naming patterns, and formatting

### TypeScript Code

- Must be autoformatted using ESLint
- Follow patterns and conventions established in the existing codebase for tests and scripts

### Commit Messages

- Must follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) format

### Code Quality

- The repository includes a pre-commit hook that checks code formatting and commit message structure
- Resolve any issues flagged by the pre-commit hook before submitting a pull request

### Documentation

- Keep inline comments and documentation up-to-date with code changes
- For significant changes, update relevant sections of the project documentation

### Testing

- Write appropriate tests (unit tests, integration tests, and fuzzing tests) for new features or bug fixes
- Ensure all tests pass before submitting a pull request

Distinguishing Hardhat test files from Foundry-related files is crucial for proper test execution and maintaining code consistency. For any questions, contact the maintainers.

## Branches

### `master`

This is the production branch and the default branch of the repository.
The [deployed protocol contracts](https://docs.lido.fi/deployed-contracts/) must match the contracts stored in the
`/contracts` directory. All pull requests to `master` must originate from the `develop` branch and require at least
one approving review before merging.

### `develop`

This is the main development branch. All pull requests to `master` should be submitted to `develop` first
for peer review.

## Local deployment

WIP

## CI/CD Integration

To integrate the core repository's integration tests into other repositories using GitHub Actions, you can follow the example workflow below. This workflow demonstrates how to set up and run integration tests from the core repository in another repository.

By default, the workflow will run the integration tests against the latest version of the deployed protocol on Ethereum Mainnet utilizing contract addresses from [deployed protocol contracts](https://docs.lido.fi/deployed-contracts/).

<details>
<summary>Example GitHub Actions workflow file</summary>

```yaml
name: Run Lido Core Integration Tests

on: ...

jobs:
  run-core-integration-tests:
    runs-on: ubuntu-latest
    timeout-minutes: 120

    services:
      mainnet-fork:
        image: hardhat/hardhat:2.22.8 # note: this is an example image, choose the appropriate one for your needs
        ports:
          - 8545:8545
        env:
          ETH_RPC_URL: ${{ secrets.ETH_RPC_URL }}

    steps:
      ### steps to update the deployed protocol (optional) ###

      - uses: actions/checkout@v4
        with:
          repository: lidofinance/core
          ref: master
          path: core

      - name: Enable corepack
        shell: bash
        run: corepack enable

      - uses: actions/setup-node@v4
        with:
          node-version-file: ./core/.nvmrc
          cache: yarn

      - name: Install dependencies
        working-directory: core
        shell: bash
        run: yarn install

      - name: Set env
        working-directory: core
        shell: bash
        run: cp .env.example .env

      - name: Run integration tests
        working-directory: core
        shell: bash
        run: yarn test:integration:fork:mainnet
        env:
          LOG_LEVEL: debug # optional
```

</details>

## Code of Conduct

Please refer to the [Lido Contributor Code of Conduct](/CODE_OF_CONDUCT.md).
