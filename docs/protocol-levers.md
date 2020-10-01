# Levers
Here is a list of levers inside the protocol.

## ACL

TODO: add description to each permission.

* PAUSE_ROLE
* MANAGE_FEE
* MANAGE_WITHDRAWAL_KEY
* MANAGE_SIGNING_KEYS
* SET_ORACLE

## Governance

TODO: update levers according to the current implementation.
TODO: split levers by different contracts: DePool, StakingProvidersRegistry, DePoolOracle.

#### `oracle`
##### File: `DePool.sol`
##### Description
Authorized oracle address that deliver reward/slashing rate feed to help establish liquid staking token fair price
##### Setting
###### File: `DePool.sol`
`setOracle(address)`: sets `_oracle` to new address. Oracle should be a contract.

<br />
<br />
#### `feeBasisPoints`
##### File: `DePool.sol`
##### Description
Fee rate, in basis points. The fees are accrued when oracles report staking results.
##### Setting
###### File: `DePool.sol`
`setFee(uint32 _feeBasisPoints)` set fee rate to `_feeBasisPoints` basis points.

<br />
<br />
#### `withdrawalCredentials`
##### File: `DePool.sol`
##### Description
Credentials to withdraw ETH on ETH 2.0 side after the phase 2 is launched
##### Setting
###### File: `DePool.sol`
`setWithdrawalCredentials(bytes _withdrawalCredentials)`: sets credentials to `_withdrawalCredentials`. Note that setWithdrawalCredentials discards all unused signing keys as the signatures are invalidated.
<br />
<br />
#### `addSigningKeys()`
##### File: `DePool.sol`
##### Description
Add `_quantity` validator signing keys to the set of usable keys. Concatenated keys are: `_pubkeys`. `_signatures` are concatenated signatures for (pubkey, withdrawal_credentials, 32000000000) messages.
```
addSigningKeys(
  uint256 _quantity, 
  bytes _pubkeys,
  bytes _signatures
)
```
TODO: update acording to new DP spec.

<br />
<br />
#### `removeSigningKey()`
##### File: `DePool.sol`
##### Description
Removes a validator signing key #`_index` from the set of usable keys.
`removeSigningKey(uint256 _index)`

TODO: update acording to new DP spec.

<br />
<br />
#### `transferToVault()`
##### File: `DePool.sol`
##### Description
TODO: add description

<br />
<br />
### Emergency

#### `stop()`
##### File: `DePool.sol`
##### Description
Stop pool routine operations.

<br />
<br />
#### `resume()`
##### File: `DePool.sol`
##### Description
Resume pool routine operations.

<br />
<br />