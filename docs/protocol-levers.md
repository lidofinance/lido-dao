# Protocol levers

The protocol provides a number of settings controllable by the DAO. Modifying each of them requires
the caller to have a specific permission. After deploying the DAO, all permissions belong to the DAO
`Voting` app, which can also manage them. This means that, initially, levers can only be changed by
the DAO voting, and other entities can be allowed to do the same only as a result of the voting.

All existing levers are listed below, grouped by the contract.

### A note on upgradeability

The following contracts are upgradeable by the DAO voting:

* `contracts/0.4.24/StETH.sol`
* `contracts/0.4.24/Lido.sol`
* `contracts/0.4.24/NodeOperatorsRegistry.sol`
* `contracts/0.4.24/LidoOracle.sol`

Upgradeability is implemented by the Aragon kernel and base contracts. To upgrade an app, one needs
the `dao.APP_MANAGER_ROLE` permission provided by Aragon. All upgradeable contracts use the
[Unstructured Storage pattern] in order to provide stable storage structure accross upgrades.

[Unstructured Storage pattern]: https://blog.openzeppelin.com/upgradeability-using-unstructured-storage

The following contracts are not upgradeable and don't depend on the Aragon code:

* `contracts/0.6.12/CstETH.sol`


## [StETH.sol](/contracts/0.4.24/StETH.sol)

### Minting and burning

* Mutator: `mint(address _to, uint256 _value)`
  * Permission required: `MINT_ROLE`
* Mutator: `burn(address _account, uint256 _value)`
  * Permission required: `BURN_ROLE`

Initially, only the `Lido.sol` contract is authorized to mint and burn tokens, but the DAO can
vote to grant these permissions to other actors.


### Pausing

* Mutators: `stop()`, `resume()`
  * Permission required: `PAUSE_ROLE`
* Accessor: `isStopped() returns (bool)`

When paused, the token contract won’t allow minting, burning, transferring tokens, approving token
transfers and changing allowances. Calls of the following functions will revert:

* `mint(address, uint256)`
* `burn(address, uint256)`
* `transfer(address, uint256)`
* `transferFrom(address, address, uint256)`
* `approve(address, uint256)`
* `increaseAllowance(address, uint)`
* `decreaseAllowance(address, uint)`


## [Lido.sol](/contracts/0.4.24/Lido.sol)

### Oracle

The address of the oracle contract.

* Mutator: `setOracle(address)`
  * Permission required: `SET_ORACLE`
* Accessor: `getOracle() returns (address)`

This contract serves as a bridge between ETH 2.0 -> ETH oracle committee members and the rest of the protocol,
implementing quorum between the members. The oracle committee members report balances controlled by the DAO
on the ETH 2.0 side, which can go up because of reward accumulation and can go down due to slashing.


### Fee

The total fee, in basis points (`10000` corresponding to `100%`).

* Mutator: `setFee(uint16)`
  * Permission required: `MANAGE_FEE`
* Accessor: `getFee() returns (uint16)`

The fee is taken on staking rewards and distributed between the treasury, the insurance fund, and
node operators.


### Fee distribution

Controls how the fee is distributed between the treasury, the insurance fund, and node operators.
Each fee component is in basis points; the sum of all components must add up to 1 (`10000` basis points).

* Mutator: `setFeeDistribution(uint16 treasury, uint16 insurance, uint16 operators)`
  * Permission required: `MANAGE_FEE`
* Accessor: `getFeeDistribution() returns (uint16 treasury, uint16 insurance, uint16 operators)`


### ETH 2.0 withdrawal Credentials

Credentials to withdraw ETH on ETH 2.0 side after phase 2 is launched.

* Mutator: `setWithdrawalCredentials(bytes)`
  * Permission required: `MANAGE_WITHDRAWAL_KEY`
* Accessor: `getWithdrawalCredentials() returns (bytes)`

The pool uses these credentials to register new ETH 2.0 validators.


### Deposit loop iteration limit

Controls how many ETH 2.0 validators can be registered in a single transaction.

* Mutator: `setDepositIterationLimit(uint256)`
  * Permission required: `SET_DEPOSIT_ITERATION_LIMIT`
* Accessor: `getDepositIterationLimit() returns (uint256)`
* [Scenario test](/test/scenario/lido_deposit_iteration_limit.js)

When someone submits Ether to the pool, the received Ether gets buffered in the pool contract. If the amount
of the buffered Ether becomes larger than the ETH 2.0 deposit size (32 ETH), then the pool tries to register
as many ETH 2.0 validators as it can. The limiting factors here are the amount of the buffered Ether (obviously),
the number of spare validator keys (provided by node operators), and the deposit loop iteration limit,
controlled by this lever.

The limit is needed to prevent the submit transaction from [failing due to the block gas limit](https://github.com/ConsenSys/smart-contract-best-practices/blob/8f99aef/docs/known_attacks.md#gas-limit-dos-on-a-contract-via-unbounded-operations).
This is possible if the amount of the buffered Ether becomes sufficiently large, which, in turn, can occur due to:

* a user sending a large amount of Ether in a single transaction;
* temporary lack of new validator keys.

In a situation when some Ether that could otherwise be used to register validators gets left buffered in
the pool due to this limit, one can resume registering new validators by submitting zero Ether, which is
allowed exactly for this purpose.

Currently, the submit function, compiled with `200` optimizer iterations, consumes around `577000 gas` plus
`107000 gas` for each registered validator, so the default limit is set by deploy scripts to `16` validators
to make the submit transaction occupy no more than `20%` of a block. See [this file](/estimate_deposit_loop_gas.js)
for the related calculations; you can run them with `yarn estimate-deposit-loop-gas`.


### Pausing

* Mutators: `stop()`, `resume()`
  * Permission required: `PAUSE_ROLE`
* Accessor: `isStopped() returns (bool)`

When paused, the pool won’t accept user submissions and won’t allow user withdrawals. The following
transactions will revert:

* Plain Ether transfers;
* Calls of the `submit(address)` function;
* Calls of the `withdraw(uint256, bytes32)` function (withdrawals are not implemented yet).


### TODO

* Treasury (`getTreasury() returns (address)`; mutator?)
* Insurance fund (`getInsuranceFund() returns (address)`; mutator?)
* Transfer to vault (`transferToVault()`)


## [NodeOperatorsRegistry.sol](/contracts/0.4.24/nos/NodeOperatorsRegistry.sol)

### Pool

Address of the pool contract.

* Mutator: `setPool(address)`
  * Permission required: `SET_POOL`
* Accessor: `pool() returns (address)`


### Node Operators list

* Mutator: `addNodeOperator(string _name, address _rewardAddress, uint64 _stakingLimit)`
  * Permission required: `ADD_NODE_OPERATOR_ROLE`
* Mutator: `setNodeOperatorName(uint256 _id, string _name)`
  * Permission required: `SET_NODE_OPERATOR_NAME_ROLE`
* Mutator: `setNodeOperatorRewardAddress(uint256 _id, address _rewardAddress)`
  * Permission required: `SET_NODE_OPERATOR_ADDRESS_ROLE`
* Mutator: `setNodeOperatorStakingLimit(uint256 _id, uint64 _stakingLimit)`
  * Permission required: `SET_NODE_OPERATOR_LIMIT_ROLE`

Node Operators act as validators on the Beacon chain for the benefit of the protocol. Each
node operator submits no more than `_stakingLimit` signing keys that will be used later
by the pool for registering the corresponding ETH 2.0 validators. As oracle committee
reports rewards on the ETH 2.0 side, the fee is taken on these rewards, and part of that fee
is sent to node operators’ reward addresses (`_rewardAddress`).


### Deactivating a node operator

* Mutator: `setNodeOperatorActive(uint256 _id, bool _active)`
  * Permission required: `SET_NODE_OPERATOR_ACTIVE_ROLE`

Misbehaving node operators can be deactivated by calling this function. The pool skips
deactivated operators during validator registration; also, deactivated operators don’t
take part in fee distribution.


### Managing node operator’s signing keys

* Mutator: `addSigningKeys(uint256 _operator_id, uint256 _quantity, bytes _pubkeys, bytes _signatures)`
  * Permission required: `MANAGE_SIGNING_KEYS`
* Mutator: `removeSigningKey(uint256 _operator_id, uint256 _index)`
  * Permission required: `MANAGE_SIGNING_KEYS`

Allow to manage signing keys for the given node operator.

> Signing keys can also be managed by the reward address of a signing provier by calling
> the equivalent functions with the `SP` suffix: `addSigningKeysSP`, `removeSigningKeySP`.


### Reporting new stopped validators

* Mutator: `reportStoppedValidators(uint256 _id, uint64 _stoppedIncrement)`
  * Permission required: `REPORT_STOPPED_VALIDATORS_ROLE`

Allows to report that `_stoppedIncrement` more validators of a node operator have become stopped.


## [LidoOracle.sol](/contracts/0.4.24/oracle/LidoOracle.sol)

### Pool

Address of the pool contract.

* Mutator: `setPool(address)`
  * Permission required: `SET_POOL`
* Accessor: `pool() returns (address)`


### Members list

The list of oracle committee members.

* Mutators: `addOracleMember(address)`, `removeOracleMember(address)`
  * Permission required: `MANAGE_MEMBERS`
* Accessor: `getOracleMembers() returns (address[])`


### The quorum

The number of oracle committee members required to form a data point.

* Mutator: `setQuorum(uint256)`
  * Permission required: `MANAGE_QUORUM`
* Accessor: `getQuorum() returns (uint256)`

The data point for a given report interval is formed when:

1. No less than `quorum` oracle committee members have reported their value
   for the given report interval;
2. Among these values, there is some value that occurs more frequently than
   the others, i.e. the set of reported values is unimodal. This value is
   then used for the resulting data point.
