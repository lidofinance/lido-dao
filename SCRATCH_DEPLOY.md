# Deploy Lido protocol from scratch

## Requirements

* node.js v16 (v18 might work fine as well)
* yarn

## General info

The repo contains bash scripts which allow to deploy the DAO under multiple environments:
- local node (ganache, anvil, hardhat network) - `dao-local-deploy.sh`
- goerli testnet - `dao-goerli-deploy.sh`

The protocol has a bunch of parameters to configure for the scratch deployment. The default configuration is stored in files `deployed-<deploy env>-defaults.json`, where `<deploy env>` is the target environment. Currently there is single default configuration `deployed-testnet-defaults.json` suitable for testnet deployments. Compared to the mainnet configuration, it has lower vote durations, more frequent oracle report cycles, etc.
During the deployment, the "default" configuration is copied to `deployed-<network name>.json`, where `<network name>` is the name of a network configuration defined in `hardhat.config.js`. The file `deployed-<network name>.json` gets populated with the contract addresses and transaction hashes during the deployment process.

These are the deployment setups, supported currently:
- local (basically any node at http://127.0.0.1:8545);
- Goerli.

Each is described in the details in the sections below.

> NB: Aragon UI for Lido DAO is to be deprecated and replaced by a custom solution, thus not included in the deployment script.

### Deploy steps

A brief description of what's going on under the hood in the deploy script.

- Prepare `deployed-<network name>.json` file
  - It is copied from `deployed-testnet-defaults.json`
  - and expended by env variables values, e. g. `DEPLOYER`.
  - It gets filled with the deployed contracts info from step to step.
- (optional) Deploy DepositContract.
  - The step is skipped if the DepositContract address is specified
- (optional) Deploy ENS
  - The step is skipped if the ENS Registry address is specified
- Deploy Aragon framework environment
- Deploy standard Aragon apps contracts (like `Agent`, `Voting`)
- Deploy `LidoTemplate` contract
  - This is an auxiliary deploy contract, which performs DAO configuration
- Deploy Lido custom Aragon apps implementations (aka bases), namely for `Lido`, `LegacyOracle`, `NodeOperatorsRegistry`)
- Registry Lido APM name in ENS
- Deploy Aragon package manager contract `APMRegistry` (via `LidoTemplate`)
- Deploy Lido custom Aragon apps repo contracts (via `LidoTemplate`)
- Deploy Lido DAO (via `LidoTemplate`)
- Issue DAO tokens (via `LidoTemplate`)
- Deploy non-Aragon Lido contracts: `OracleDaemonConfig`, `LidoLocator`, `OracleReportSanityChecker`, `EIP712StETH`, `WstETH`, `WithdrawalQueueERC721`, `WithdrawalVault`, `LidoExecutionLayerRewardsVault`, `StakingRouter`, `DepositSecurityModule`, `AccountingOracle`, `HashConsensus` for AccountingOracle, `ValidatorsExitBusOracle`, `HashConsensus` for ValidatorsExitBusOracle, `Burner`.
- Finalize Lido DAO deployment: issue unvested LDO tokens, setup Aragon permissions, register Lido DAO name in Aragon ID (via `LidoTemplate`)
- Initialize non-Aragon Lido contracts
- Set parameters of `OracleDaemonConfig`
- Setup non-Aragon permissions
- Plug NodeOperatorsRegistry as Curated staking module
- Transfer all admin roles from deployer to `Agent`
  - OZ admin roles: `Burner`, `HashConsensus` for `AccountingOracle`, `HashConsensus` TODO
  - OssifiableProxy admins: TODO
  - DepositSecurityModule owner


## Local deployment

Deploys the DAO to local (http://127.0.0.1:8545) dev node (anvil, hardhat, ganache).
The deployment is done from default test account `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`.
The node must be configured with the default test accounts derived from mnemonic `test test test test test test test test test test test junk`.

1. Run `yarn install` (get sure repo dependencies are installed)
2. Run the node on default port 8545 (for the commands see subsections below)
3. Set test account private key `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` to `accounts.json` under `/eth/local` like `"local": ["<private key>"]` (see `accounts.sample.json` for example)
4. Run the deploy script `bash dao-local-deploy.sh` from root repo directory
5. Check out the deploy artifacts in `deployed-local.json`

### Anvil

Run the node with command:

```shell
anvil -p 8545 --auto-impersonate --gas-price 0 --base-fee 0 --chain-id 1337 --mnemonic "test test test test test test test test test test test junk"
```

### Hardhat node

> NB: Hardhat node configuration is set in `hardhat.config.js` under `hardhat: { `.

To run hardhat node execute:
```shell
yarn hardhat node
```

### Ganache

TODO

## Goerli deployment

To do Goerli deployment, the following parameters must be set up via env variables:

- `DEPLOYER`. The deployer address, you must have its private key. It must have enough ether.
- `RPC_URL`. Address of of the Ethereum RPC node to use. E.g. for Infura it is `https://goerli.infura.io/v3/<yourProjectId>`
- `GAS_PRIORITY_FEE`. Gas priority fee. By default set to `2`
- `GAS_MAX_FEE`. Gas max fee. By default set to `100`
- `GATE_SEAL_FACTORY`. Address of the [GateSeal Factory](https://github.com/lidofinance/gate-seals) contract. Must be deployed preliminary. Can be set to any `0x0000000000000000000000000000000000000000` to debug deployment.

Also you need to specify `DEPLOYER` private key in `accounts.json` under `/eth/goerli` like `"goerli": ["<key>"]`. See `accounts.sample.json` for an example.

To start the deployment, run (the env variables must already defined):
```shell
bash dao-goerli-deploy.sh
```
and checkout `deployed-goerli.json`.

## Holešky deployment

```shell
RPC_URL=<PUT-YOUR-VALUE> GATE_SEAL=<PUT-YOUR-VALUE> DEPLOYER=<PUT-YOUR-VALUE> bash dao-holesky-deploy.sh
```

## Publishing sources to Etherscan

TODO


## Post deploy initialization

### Post deploy state

TODO

TODO: paused: staking, steth transfers, accounting  oracle reports, ... what else?

### Initialization up to fully operational state

In order to make protocol fully operational the additional steps are required.

- add `NodeOperatorsRegistry` as staking module: `StakingRouter.addStakingModule`
- add oracle committee members to `HashConsensus` contracts for `AccountingOracle` and `ValidatorsExitBusOracle`: `HashConsensus.addMember`
- initialize initial epoch for `HashConsensus` contracts for `AccountingOracle` and `ValidatorsExitBusOracle`: `HashConsensus.updateInitialEpoch`
- add guardians to `DepositSecurityModule`: `DepositSecurityModule.addGuardians`
- resume protocol: `Lido.resume`
- resume WithdrawalQueue: `WithdrawalQueueERC721.resume`
- add at least one Node Operator: `NodeOperatorsRegistry.addNodeOperator`
- add validator keys to the Node Operators: `NodeOperatorsRegistry.addSigningKeys`
- set staking limits for the Node Operators: `NodeOperatorsRegistry.setNodeOperatorStakingLimit`

NB, that part of the actions require preliminary granting of the required roles, e.g. `STAKING_MODULE_MANAGE_ROLE` for `StakingRouter.addStakingModule`:

```js
  await stakingRouter.grantRole(STAKING_MODULE_MANAGE_ROLE, agent.address, { from: agent.address })
  await stakingRouter.addStakingModule(
    state.nodeOperatorsRegistry.parameters.stakingModuleTypeId,
    nodeOperatorsRegistry.address,
    NOR_STAKING_MODULE_TARGET_SHARE_BP,
    NOR_STAKING_MODULE_MODULE_FEE_BP,
    NOR_STAKING_MODULE_TREASURY_FEE_BP,
    { from: agent.address }
  )
  await stakingRouter.renounceRole(STAKING_MODULE_MANAGE_ROLE, agent.address, { from: agent.address })
```


## Protocol parameters

This section describes part of the parameters and their values used at the deployment. The values are specified in `deployed-testnet-defaults.json`. The subsections below describes values of the parameters.

### OracleDaemonConfig

```python
# Parameters related to "bunker mode"
# See https://research.lido.fi/t/withdrawals-for-lido-on-ethereum-bunker-mode-design-and-implementation/3890/4
# and https://snapshot.org/#/lido-snapshot.eth/proposal/0xa4eb1220a15d46a1825d5a0f44de1b34644d4aa6bb95f910b86b29bb7654e330
# NB: BASE_REWARD_FACTOR: https://ethereum.github.io/consensus-specs/specs/phase0/beacon-chain/#rewards-and-penalties
NORMALIZED_CL_REWARD_PER_EPOCH=64
NORMALIZED_CL_REWARD_MISTAKE_RATE_BP=1000  # 10%
REBASE_CHECK_NEAREST_EPOCH_DISTANCE=1
REBASE_CHECK_DISTANT_EPOCH_DISTANCE=23  # 10% of AO 225 epochs frame
VALIDATOR_DELAYED_TIMEOUT_IN_SLOTS=7200  # 1 day

# See https://snapshot.org/#/lido-snapshot.eth/proposal/0xa4eb1220a15d46a1825d5a0f44de1b34644d4aa6bb95f910b86b29bb7654e330 for "Requirement not be considered Delinquent"
VALIDATOR_DELINQUENT_TIMEOUT_IN_SLOTS=28800  # 4 days

# See "B.3.I" of https://snapshot.org/#/lido-snapshot.eth/proposal/0xa4eb1220a15d46a1825d5a0f44de1b34644d4aa6bb95f910b86b29bb7654e330
NODE_OPERATOR_NETWORK_PENETRATION_THRESHOLD_BP=100  # 1% network penetration for a single NO

# Time period of historical observations used for prediction of the rewards amount
# see https://research.lido.fi/t/withdrawals-for-lido-on-ethereum-bunker-mode-design-and-implementation/3890/4
PREDICTION_DURATION_IN_SLOTS=50400  # 7 days

# Max period of delay for requests finalization in case of bunker due to negative rebase
# twice min governance response time - 3 days voting duration
FINALIZATION_MAX_NEGATIVE_REBASE_EPOCH_SHIFT=1350  # 6 days
```