# Lido Ethereum Liquid Staking Protocol

[![Tests](https://github.com/lidofinance/lido-dao/workflows/Tests/badge.svg)](https://github.com/lidofinance/lido-dao/actions)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

The Lido Ethereum Liquid Staking Protocol allows their users to earn staking rewards on the Beacon chain without locking ether or maintaining staking infrastru ether

Users can deposit ether to the Lido smart contract and receive stETH tokens in return. The smart contract then stakes tokens with the DAO-picked node operators. Users' deposited funds are pooled by the DAO, node operators never have direct access to the users' assets.

Unlike staked ether, the stETH token is free from the limitations associated with a lack of liquidity and can be transferred at any time. The stETH token balance corresponds to the amount of ether that the holder could request to withdraw.

Before getting started with this repo, please read:

* [Documentation](https://docs.lido.fi/)

## Lido DAO

The Lido DAO is a Decentralized Autonomous Organization that manages the liquid staking protocol by deciding on key parameters (e.g., setting fees, assigning node operators and oracles, etc.) through the voting power of governance token (DPG) holders.

Also, the DAO will accumulate service fees and spend them on insurance, research, development, and protocol upgrades. Initial DAO members will take part in the threshold signature for Ethereum 2.0 by making BLS threshold signatures.

The Lido DAO is an [Aragon organization](https://aragon.org/dao). Since Aragon provides a full end-to-end framework to build DAOs, we use its standard tools. The protocol smart contracts extend AragonApp base contract and can be managed by the DAO.

## Protocol levers

A full list of protocol levers that are controllable by the Aragon DAO can be found [here](https://docs.lido.fi/guides/protocol-levers/).

## Contracts

For the contracts description see https://docs.lido.fi/ contracts section.

## Deployments

For the protocol contracts addresses see https://docs.lido.fi/deployed-contracts/

## Development

### Requirements

* shell - bash or zsh
* docker
* find
* sed
* jq
* curl
* cut
* docker
* node.js v16
* (optional) Lerna
* (optional) Foundry

### Installing Aragon & other deps

Installation is local and doesn't require root privileges.

If you have `yarn` installed globally:

```bash
yarn
```

otherwise:

```bash
npx yarn
```

### Build & test

Run unit tests:

```bash
yarn test
```

Run unit tests and report gas used by each Solidity function:

```bash
yarn test:gas
```

Generate unit test coverage report:

```bash
yarn test:coverage
```

Test coverage is reported to `coverage.json` and `coverage/index.html` files located
inside each app's folder.

Keep in mind that the code uses `assert`s to check invariants that should always be kept
unless the code is buggy (in contrast to `require` statements which check pre-conditions),
so full branch coverage will never be reported until
[solidity-coverage#219] is implemented.

[solidity-coverage#219]: https://github.com/sc-forks/solidity-coverage/issues/269

Run fuzzing tests with foundry:

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
forge test
```

## Deploying

We have several ways to deploy lido smart-contracts and run DAO locally, you can find documents here:

`lido-aragon` [documentation](/docs/lido-aragon.md)

For local development, please see [local documentation](/docs/dev-local.md)

To develop/test on fork, please see [fork documentation](/docs/dev-fork.md)


# License

2023 Lido <info@lido.fi>

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, version 3 of the License, or any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the [GNU General Public License](LICENSE)
along with this program. If not, see <https://www.gnu.org/licenses/>.
