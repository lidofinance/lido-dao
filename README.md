# Lido Ethereum Liquid Staking Protocol

[![Tests](https://github.com/lidofinance/lido-dao/workflows/Tests/badge.svg)](https://github.com/lidofinance/lido-dao/actions)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

The Lido Ethereum Liquid Staking Protocol allows their users to earn staking rewards on the Beacon chain without locking Ether or maintaining staking infrastructure.

Users can deposit Ether to the Lido smart contract and receive stETH tokens in return. The smart contract then stakes tokens with the DAO-picked node operators. Users' deposited funds are pooled by the DAO, node operators never have direct access to the users' assets.

Unlike staked ether, the stETH token is free from the limitations associated with a lack of liquidity and can be transferred at any time. The stETH token balance corresponds to the amount of Ether that the holder could request to withdraw.

Before getting started with this repo, please read:

* [A Primer](https://lido.fi/static/Lido:Ethereum-Liquid-Staking.pdf)
* [Documentation](/docs)

## Lido DAO

The Lido DAO is a Decentralized Autonomous Organization that manages the liquid staking protocol by deciding on key parameters (e.g., setting fees, assigning node operators and oracles, etc.) through the voting power of governance token (DPG) holders.

Also, the DAO will accumulate service fees and spend them on insurance, research, development, and protocol upgrades. Initial DAO members will take part in the threshold signature for Ethereum 2.0 by making BLS threshold signatures.

The Lido DAO is an [Aragon organization](https://aragon.org/dao). Since Aragon provides a full end-to-end framework to build DAOs, we use its standard tools. The protocol smart contracts extend AragonApp base contract and can be managed by the DAO.

## Protocol levers

A full list of protocol levers that are controllable by the Aragon DAO can be found [here](docs/protocol-levers.md).

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
* node.js v12
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

### Building docker containers

```bash
cd e2e
docker-compose build --no-cache
```

### Starting & stopping e2e environment

> ***All E2E operations must be launched under the `./e2e` subdirectory***

The E2E environment consists of two parts: ETH1-related processes and ETH 2.0-related processes.

For ETH1 part: Ethereum single node (ganache), IPFS docker containers and Aragon Web App.

For ETH2 part: Beacon chain node, genesis validators machine, and, optionally, 2nd and 3rd peer beacon chain nodes.

To start the whole environment from pre-deployed snapshots, use:

```bash
./startup.sh -r -s
```

then go to [http://localhost:3000/#/lido-dao/](http://localhost:3000/#/lido-dao/) to manage the DAO via Aragon Web App.

> To completely repeat the compilation and deployment process in ETH1 chain, just omit the `-s` flag.

#### ETH1 part

As a result of the script execution, the following will be installed:

* the Deposit Contract instance;
* all Aragon App instances (contracts: Lido, NodeOperatorsRegistry, and LidoOracle)
* the Aragon PM for `lido.eth`;
* the Lido DAO template;
* and finally, the Lido DAO will be deployed.

To start only the ETH1 part, use:

```bash
./startup.sh -1
```

#### ETH2 part

To work with the ETH2 part, the ETH1 part must be running.

As a result of the script execution, the following will happen:

* the Beacon chain genesis config (Minimal with tunes) will be generated;
* validator's wallet with 4 keys will be generated;
* a deposit of 32 ETH will be made to the Deposit Contract for each validator key;
* based on the events about the deposit, a genesis block will be created, including validators;
* ETH2 node will start from the new Genesis block.

To reseat and restart only the ETH2 part, use:

```bash
./startup.sh -r2
```

##### Stop all

To stop, use:
> Note: this action permanently deletes all generated data

```bash
./shutdown.sh
```

### DKG

To build a DGK container:

 * Add your local SSH key to the Github account;
 * run `./dkg.sh` inside the `e2e` directory.

### Build & test all our apps

Run unit tests:

```bash
yarn test
```

Run E2E tests:

```bash
cd e2e
./dkg.sh
./startup.sh -r -s
yarn test:e2e
./shutdown.sh
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

2020 Lido <info@lido.fi>

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, version 3 of the License, or any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the [GNU General Public License](LICENSE)
along with this program. If not, see <https://www.gnu.org/licenses/>.
