# DePool Ethereum Liquid Staking Protocol

The DePool Ethereum Liquid Staking Protocol, built on the Ethereum blockchain, allows their users to earn staking rewards on Beacon chain without locking Ether or maintaining staking infrastructure. 

Users can deposit Ether to DePool smart contract and receive stETH tokens in return. The smart contract then stakes tokens with DAO-picked staking providers. Users' deposited funds are controlled by the DAO, staking providers never have direct access to the users' assets. 

Unlike staked ether, stETH token is free from the limitations associated with a lack of liquidity and can be transferred at any time. Token fair price could be calculated based on the total amount of staked ether, plus rewards and minus any slashing penalties.

Before getting started with this repo, please read:
* Whitepaper (TODO: add link here)
* Documentation (TODO: add link here)

## DePool DAO

The DePool DAO is a Decentralized Autonomous Organization which manages the liquid staking protocol by deciding on key parameters (e.g., setting fees, assigning staking providers and oracles, etc.) through the voting power of governance token (DPG) holders.

In addition, the DAO will accumulate service fees and spend them on further research, development, and protocol upgrades. Initial DAO members will take part in the threshold signature for Ethereum 2.0 by making BLS threshold signatures.

The DePool DAO is an [Aragon organization](https://aragon.org/dao). Since Aragon provides a full end-to-end framework to build DAOs, we use its standard tools. Protocol smart contracts extend AragonApp base contract and can be managed by DAO.

Full list of protocol levers that are controllable by Aragon DAO and you can found [here](docs/protocol-levers.md).

## Contracts

The protocol implemented as a set of smart contracts which extend AragonApp base contract.

<dl>
  <dt>[StETH](contracts/StETH.sol)</dt>
  <dd>StETH is ERC20 token which represents staked ether. Tokens are minted upon deposit and burned when redeemed. StETH tokens are pegged 1:1 to the Ethers that are held by DePool. StETH token’s balances are updated when oracle reports change in total stake every day.</dd>
</dl>

<dl>
  <dt>[DePool](contracts/DePool.sol)</dt>
  <dd>DePool is a the core contract which acts as a liquid staking pool. The contract is responsible for Ether deposits and withdrawals, minting and burning liquid tokens, delegating funds to staking providers, applying fees and accept updates from oracle contract. Staking providers' logic is extracted to the separate contract StakingProvidersRegistry.</dd>
</dl>

<dl>
  <dt>StakingProvidersRegistry</dt>
  <dd>Staking Providers act as validators on Beacon chain for the benefit of the protcol. The DAO selects validators and adds their addresses to StakingProvidersRegistry contract. Authorized providers have to generate a set of keys for validation and also provide them to the smart contract. As ether is received from users, it is distributed in chunks of 32 ethers between all active Staking Providers. The contract contains a list of validators, their keys and the logic for distributing rewards between them. The DAO has the ability to deactivate misbehaving validators.
</dd>
</dl>

<dl>
  <dt>[DePoolOracle](contracts/oracle/DePoolOracle.sol)</dt>
  <dd>DePoolOracle is a contract where oracles send addresses' balances controlled by the DAO on the ETH 2.0 side. The balances can go up because of reward accumulation and can go down because of slashing. Oracles are assigned by DAO.</dd>
</dl>

<dl>
  <dt>CStETH</dt>
  <dd>It's ERC20 token which represents staked ether in a compound like way. The contract also swaps StETH token to CStETH and vice versa. It’s a wrapper contract that accepts StETH tokens and mints CStETH in return.</dd>
</dl>

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

Installation is local and don't require root privileges.

If you have `lerna` installed globally
```bash
npm run bootstrap
```

otherwise

```bash
npx lerna bootstrap 
```

### Building docker containers

```
docker-compose build --no-cache
```

### Starting & stopping e2e environment

E2E environment consist of two parts: ETH1 related process and ETH 2.0 related process. 

For ETH1 part: Ethereum single node (ganache), IPFS docker containers and Aragon Web App.

For ETH2 part: Beacon chain node, genesis validators machine, and, optionally 2nd and 3rd peer beacon chain nodes.

To start the whole environment, use:
```bash
./startup.sh
```
then go to [http://localhost:3000/#/depool-dao/](http://localhost:3000/#/depool-dao/) to manage DAO via Aragon Web App

> To save time you can use snapshot with predeployed contracts in ETH1 chain: `./startup.sh -s `  

##### ETH1 part
During script execution, the following will be installed:
- Deposit Contract instance
- each Aragon App instance (contracts: DePool, DePoolOracle and StETH )
- Aragon PM for 'depoolspm.eth'
- DePool DAO template 
- and finally, DePool DAO will be deployed 

To start only ETH1 part use:

```bash
./startup.sh -1
```

##### ETH2 part
To work with ETH2 part, ETH1 part must be running. 

During script execution, the following will happen:
- beacon chain genesis config (Minimal with tunes) will be generated.
- validator's wallet with 4 keys will be generated
- A deposit of 32ETH will be made to Deposit Contract for each validator key.
- Based on the events about the deposit, a genesis block will be created, which including validators.
- ETH2 node with new Genesis block will start 

To reseat and restart only ETH2 part use:

```bash
./startup.sh -r2
```

##### Stop all

To stop use:
> Note: this action permanently deletes all generated data

```bash
./shutdown.sh
```

### DKG
To build DGK container:
 
 * Add your local ssh key to github account
 * run `./dkg.sh`

### Build & test all our apps

Unit tests

```bash
npm run test
```

E2E tests

```bash
./dkg.sh
npm run test:e2e
```

#### Gas meter

In an app folder:

```bash
npm run test:gas
```

#### Generate test coverage report

For all apps, in the repo root:

```bash
npm run test:all:coverage
```

In an app folder:

```bash
npm run test:coverage
```

Test coverage is reported to `coverage.json` and `coverage/index.html` files located
inside each app's folder.

Keep in mind that the code uses `assert`s to check invariants that should always be kept
unless the code is buggy (in contrast to `require` statements which check pre-coditions),
so full branch coverage will never be reported until
[solidity-coverage#219] is implemented.

[solidity-coverage#219]: https://github.com/sc-forks/solidity-coverage/issues/269

### _(deprecated)_ Configuration

Can be specified in a local file `.dev.env`.

For options see [dev.env.default](dev.env.default).

The configuration is read only during new dao deployment.


### _(deprecated)_ New dao creation

```bash
./bin/deploy-dev-contracts.sh
```

The GUI for the created DAO can be accessed at `http://localhost:3000/?#/<dao_address>/`.

Note: `DAO_ID` must be unique in a blockchain.

### Other

To reset the devchain state, stop the processes and use:

```bash
./shutdown.sh && ./startup.sh
```

or to just clean restart

```bash
./startup.sh -r -s
```

You free to mix the keys.

