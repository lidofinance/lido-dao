# Why we use different compilers

For Lido project coordination, governance and funds management we use [Aragon](https://aragon.org/dao), a well-developed and proven DAO Framework. The current stable release of its Kernel, [4.4.0](https://github.com/aragon/aragonOS/tree/v4.4.0) is fixed on the specific compiler version - [solc 0.4.24](https://solidity.readthedocs.io/en/v0.4.24/), that is currently outdated. Keeping security and consistency in mind, we decided to stay on an older yet proven combination - for all the contracts under Aragon management (`Lido`, `stETH`, `LegacyOracle`) we use solc 0.4.24 release.

For the other contracts the newer compiler versions are used.

# How to compile

All at once:

```bash
yarn compile
```
