# Lido Ethereum Liquid Staking Protocol

[![Tests](https://github.com/lidofinance/lido-dao/workflows/Tests/badge.svg)](https://github.com/lidofinance/lido-dao/actions)

The Lido Ethereum Liquid Staking Protocol, built on Ethereum 2.0's Beacon chain, allows their users to earn staking rewards on the Beacon chain without locking Ether or maintaining staking infrastructure.

Users can deposit Ether to the Lido smart contract and receive stETH tokens in return. The smart contract then stakes tokens with the DAO-picked node operators. Users' deposited funds are pooled by the DAO, node operators never have direct access to the users' assets.

Unlike staked ether, the stETH token is free from the limitations associated with a lack of liquidity and can be transferred at any time. The stETH token balance corresponds to the amount of Beacon chain Ether that the holder could withdraw if state transitions were enabled right now in the Ethereum 2.0 network.

Before getting started with this repo, please read:

* Whitepaper (TODO: add a link here)
* Documentation (TODO: add a link here)

## Lido DAO

The Lido DAO is a Decentralized Autonomous Organization that manages the liquid staking protocol by deciding on key parameters (e.g., setting fees, assigning node operators and oracles, etc.) through the voting power of governance token (DPG) holders.

Also, the DAO will accumulate service fees and spend them on insurance, research, development, and protocol upgrades. Initial DAO members will take part in the threshold signature for Ethereum 2.0 by making BLS threshold signatures.

The Lido DAO is an [Aragon organization](https://aragon.org/dao). Since Aragon provides a full end-to-end framework to build DAOs, we use its standard tools. The protocol smart contracts extend AragonApp base contract and can be managed by the DAO.

## Protocol levers

A full list of protocol levers that are controllable by the Aragon DAO can be found [here](docs/protocol-levers.md).

## Contracts

Most of the protocol is implemented as a set of smart contracts that extend the [AragonApp](https://github.com/aragon/aragonOS/blob/next/contracts/apps/AragonApp.sol) base contract.
These contracts are located in the [contracts/0.4.24](contracts/0.4.24) directory. Additionally, there are contracts that don't depend on the Aragon; they are located in the [contracts/0.6.12](contracts/0.6.12) directory.

#### [StETH](contracts/0.4.24/StETH.sol)
StETH is an ERC20 token which represents staked ether. Tokens are minted upon deposit and burned when redeemed. StETH tokens are pegged 1:1 to the Ethers that are held by Lido. StETH token’s balances are updated when the oracle reports change in total stake every day.

#### [Lido](contracts/0.4.24/Lido.sol)
Lido is the core contract which acts as a liquid staking pool. The contract is responsible for Ether deposits and withdrawals, minting and burning liquid tokens, delegating funds to node operators, applying fees, and accepting updates from the oracle contract. Node Operators' logic is extracted to a separate contract, NodeOperatorsRegistry.

#### [NodeOperatorsRegistry](contracts/0.4.24/nos/NodeOperatorsRegistry.sol)
Node Operators act as validators on the Beacon chain for the benefit of the protocol. The DAO selects node operators and adds their addresses to the NodeOperatorsRegistry contract. Authorized operators have to generate a set of keys for the validation and also provide them with the smart contract. As Ether is received from users, it is distributed in chunks of 32 Ether between all active Node Operators. The contract contains a list of operators, their keys, and the logic for distributing rewards between them. The DAO can deactivate misbehaving operators.

#### [LidoOracle](contracts/0.4.24/oracle/LidoOracle.sol)
LidoOracle is a contract where oracles send addresses' balances controlled by the DAO on the ETH 2.0 side. The balances can go up because of reward accumulation and can go down due to slashing and staking penalties. Oracles are assigned by the DAO.

#### [CStETH](contracts/0.6.12/CstETH.sol)
It's an ERC20 token that represents the account's share of the total supply of StETH tokens. The balance of a CStETH token holder only changes on transfers, unlike the balance of StETH that is also changed when oracles report staking rewards, penalties, and slashings. It's a "power user" token that might be needed to work correctly with some DeFi protocols like Uniswap v2, cross-chain bridges, etc.

The contract also works as a wrapper that accepts StETH tokens and mints CStETH in return. The reverse exchange works exactly the opposite, the received CStETH tokens are burned, and StETH tokens are returned to the user.

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

To start the whole environment from predeployed snapshots, use:

```bash
./startup.sh -r -s
```

then go to [http://localhost:3000/#/lido-dao/](http://localhost:3000/#/lido-dao/) to manage the DAO via Aragon Web App.

> To completely repeat the compilation and deployment process in ETH1 chain, just omit the `-s` flag.

#### ETH1 part

As a result of the script execution, the following will be installed:

* the Deposit Contract instance;
* all Aragon App instances (contracts: Lido, NodeOperatorsRegistry, LidoOracle, and StETH)
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
unless the code is buggy (in contrast to `require` statements which check pre-coditions),
so full branch coverage will never be reported until
[solidity-coverage#219] is implemented.

[solidity-coverage#219]: https://github.com/sc-forks/solidity-coverage/issues/269

## Deploying

Networks are defined in `buidler.config.js` file. To select the target network for deployment,
set `NETWORK_NAME` environment variable to a network name defined in that file. All examples
below assume `localhost` target network.

#### Network state file

Deployment scripts read their config from and store their results to a file called `deployed.json`,
located in the repo root. This file has the following structure and should always be committed:

```js
{
  "networks": {
    "1337": { // network id
      "networkName": "devnet", // serves as a comment
      // ...deployment results
    }
  }
}
```

When a script sees that some contract address is already defined in the network state file, it won't
re-deploy the same contract. This means that all deployment scripts are idempotent, you can call the
same script twice and the second call will be a nop.

You may want to specify some of the configuration options in `networks.<netId>` prior to running
deployment to avoid those values being set to default values:

* `owner` The address that everything will be deployed from.
* `ensAddress` The address of a ENS instance.
* `depositContractAddress` The address of the Beacon chain deposit contract (it will deployed otherwise).
* `daoInitialSettings` Initial settings of the DAO; see below.

You may specify any number additional keys inside any network state, they will be left intact by
deployment scripts.

#### DAO initial settings

Initial DAO settings can be specified pripr to deployment for the specific network in
`networks.<netId>.daoInitialSettings` field inside `deployed.json` file.

* `holders` Addresses of initial DAO token holders.
* `stakes` Initial DAO token balances of the holders.
* `tokenName` Name of the DAO token.
* `tokenSymbol` Symbol of the DAO token.
* `voteDuration` See [Voting app documentation].
* `votingSupportRequired` See [Voting app documentation].
* `votingMinAcceptanceQuorum` See [Voting app documentation].
* `depositIterationLimit` See [protocol levers documentation].

[Voting app documentation]: https://wiki.aragon.org/archive/dev/apps/voting
[protocol levers documentation]: /protocol-levers.md

An example of `deployed.json` file prepared for a testnet deployment:

```js
{
  "networks": {
    "5": {
      "networkName": "goerli",
      "depositContractAddress": "0x07b39f4fde4a38bace212b546dac87c58dfe3fdc",
      "owner": "0x3463dD800410965fdBeC2958085b1467CBd4aA31",
      "daoInitialSettings": {
        "holders": [
          "0x9be0D8ef365A7217c2313c3f33a71D5CeBea2686",
          "0x7B1F4c068b3E89Cc586c2f3656Bd95f56CA5B10A",
          "0x6244D856606c874DEAC61a61bd07698d47a6F6F2"
        ],
        "stakes": [
          "100000000000000000000",
          "100000000000000000000",
          "100000000000000000000"
        ],
        "tokenName": "Lido DAO Token",
        "tokenSymbol": "LDO",
        "voteDuration": 86400,
        "votingSupportRequired": "500000000000000000",
        "votingMinAcceptanceQuorum": "50000000000000000",
        "depositIterationLimit": 16
      }
    }
  }
}
```

#### Step 1: сompile the code

```bash
yarn compile
```

#### Step 2: deploy Aragon environment and core apps (optional)

This is required for test/dev networks that don't have Aragon environment deployed.

```bash
# ENS, APMRegistryFactory, DAOFactory, APMRegistry for aragonpm.eth, etc.
NETWORK_NAME=localhost yarn deploy:aragon-env

# Core Aragon apps: voting, vault, etc.
NETWORK_NAME=localhost yarn deploy:aragon-std-apps
```

#### Step 3: deploy Lido APM registry and DAO template

```bash
NETWORK_NAME=localhost yarn deploy:apm-and-template
```

#### Step 4: build and deploy Lido applications

```bash
NETWORK_NAME=localhost yarn deploy:apps
```

#### Step 5: deploy the DAO

```bash
NETWORK_NAME=localhost yarn deploy:dao
```

This step deploys `DepositContract` as well, if `depositContractAddress` is not specified
in `deployed.json`.
