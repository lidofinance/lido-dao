// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>
//
// SPDX-License-Identifier: GPL-3.0
//
pragma solidity 0.8.9;

import 'hardhat/console.sol';
import './IModule.sol';
import './interfaces/IDepositContract.sol';
import './lib/BytesLib.sol';

import 'hardhat/console.sol';

/**
 * @title Interface defining a Lido liquid staking pool
 * @dev see also [Lido liquid staking pool core contract](https://docs.lido.fi/contracts/lido)
 */
interface ILido {
    function totalSupply() external view returns (uint256);

    function getTotalShares() external view returns (uint256);

    function mintShares(uint256 shares2mint) external;

    function transferShares(address recipient, uint256 sharesAmount) external returns (uint256);

    function getWithdrawalCredentials() external view returns (bytes32);

    function updateBufferedCounters(uint256 keysAmount) external;

    function getTreasury() external view returns (address);

    function getLastReportTimestamp() external view returns (uint64);
}

contract StakingRouter {
    //////for test
    event KeysAssigned(bytes pubkeys, bytes signatures);
    //////

    event DepositsUnpaused();

    error InvalidType();

    address public immutable lido;
    address public immutable deposit_contract;
    address public dsm;

    uint256 public constant DEPOSIT_SIZE = 32 ether;

    uint256 internal constant DEPOSIT_AMOUNT_UNIT = 1000000000 wei;
    uint256 internal constant TOTAL_BASIS_POINTS = 10000;

    uint256 public constant PUBKEY_LENGTH = 48;
    uint256 public constant SIGNATURE_LENGTH = 96;

    uint256 public constant MAX_TIME = 86400;

    struct StakingModule {
        string name;
        address moduleAddress;
        uint16 treasuryFee;
        uint16 cap; //in basic points, e.g 500 - 5%
        bool paused;
        bool active;
        uint64 lastDepositAt;
        uint64 recycleAt;
        uint16 recycleLevel;
        uint256 recycleRestAmount;
    }

    struct ModuleLookupCacheEntry {
        // Makes no sense to pack types since reading memory is as fast as any op
        uint256 id;
        address moduleAddress;
        uint256 totalKeys;
        uint256 totalUsedKeys;
        uint256 totalStoppedKeys;
        uint256 totalExitedKeys;
        uint256 assignedKeys;
        uint16 treasuryFee;
        uint16 cap;
        bool paused;
        bool active;
        bool skip;
    }

    struct RecycleLevel {
        uint64 delay;
        uint16 percent;
    }

    struct RecycleCache {
        uint totalRecycleKeys;
        uint16[] levels;
        uint[] keysAmounts;
    }

    mapping(uint => StakingModule) internal modules;
    mapping(address => uint) internal modules_ids;
    uint internal modulesCount;

    //stake allocation module_index -> amount
    mapping(uint => uint) public allocation;
    uint internal totalAllocation;

    uint64 public timePeriod = 86400;
    uint64 public lastDistributeAt;
    uint public lastNumDeposits;

    constructor(address _lido, address _deposit_contract) {
        lido = _lido;
        deposit_contract = _deposit_contract;
    }

    /**
     * @notice register a DSM module
     * @param _dsm address of DSM
     */
    function setDepositSecurityModule(address _dsm) external {
        dsm = _dsm;
    }

    /**
     * @notice register a new module
     * @param _name name of module
     * @param _moduleAddress target percent of total keys in protocol, in BP
     * @param _cap soft cap
     * @param _cap treasury fee
     */
    function addModule(string memory _name, address _moduleAddress, uint16 _cap, uint16 _treasuryFee) external {
        require(_cap <= TOTAL_BASIS_POINTS, 'VALUE_OVER_100_PERCENT');
        require(_treasuryFee <= TOTAL_BASIS_POINTS, 'VALUE_OVER_100_PERCENT');

        uint _modulesCount = modulesCount;
        StakingModule storage module = modules[_modulesCount];
        modules_ids[_moduleAddress] = _modulesCount;

        module.name = _name;
        module.moduleAddress = _moduleAddress;
        module.cap = _cap;
        module.treasuryFee = _treasuryFee;
        module.paused = false;
        module.active = true;
        modulesCount = ++_modulesCount;
    }

    function getModule(uint256 moduleId) external view returns (StakingModule memory) {
        //@todo check exists

        return modules[moduleId];
    }

    /**
     * @notice Returns total number of node operators
     */
    function getModulesCount() public view returns (uint256) {
        return modulesCount;
    }

    /**
     * @notice pause a module
     * @param _moduleIndex index of module
     */
    function pauseModule(uint256 _moduleIndex) external {
        require(msg.sender == dsm, 'invalid_caller');

        StakingModule storage module = modules[_moduleIndex];
        require(!module.paused, 'module_is_paused');

        module.paused = true;
    }

    /**
     * Unpauses deposits.
     *
     * Only callable by the dsm.
     */
    function unpauseModule(uint256 _moduleIndex) external {
        require(msg.sender == dsm, 'invalid_caller');

        StakingModule storage module = modules[_moduleIndex];
        if (module.paused) {
            module.paused = false;
            emit DepositsUnpaused();
        }
    }

    /**
     * @notice set the module activity flag for participation in further reward distribution
     */
    function setModuleActive(uint256 _moduleIndex, bool _active) external {
        StakingModule storage module = modules[_moduleIndex];
        module.active = _active;
    }

    /**
     * @notice calculate shares to mint on Lido
     * @param _totalRewards total rewards from oracle report
     *
     * @return shares2mint amount of shares, which need to mint
     * @return totalKeys total keys which used for calculation
     * @return moduleKeys array of amount module keys
     */
    function calculateShares2Mint(
        uint256 _totalRewards
    ) external returns (uint256 shares2mint, uint256 totalKeys, uint256[] memory moduleKeys) {
        assert(modulesCount != 0);

        // calculate total used keys for operators
        moduleKeys = new uint256[](modulesCount);
        for (uint256 i = 0; i < modulesCount; ++i) {
            StakingModule memory module = modules[i];
            moduleKeys[i] = IModule(module.moduleAddress).getTotalKeys();
            totalKeys += moduleKeys[i];
        }

        //calculate total fee to mint
        uint256 totalFee = 0;
        for (uint256 i = 0; i < modulesCount; ++i) {
            StakingModule memory stakingModule = modules[i];
            IModule module = IModule(stakingModule.moduleAddress);

            uint256 moduleFeeBasisPoints = module.getFee() + stakingModule.treasuryFee;

            uint256 rewards = (_totalRewards * moduleKeys[i]) / totalKeys;

            uint256 opRewards = (rewards * moduleFeeBasisPoints) / TOTAL_BASIS_POINTS;

            totalFee += opRewards;
        }

        // _now we want to mint new shares to the fee recipient, so that the total cost of the
        // newly-minted shares exactly corresponds to the fee taken:
        //
        // shares2mint * newShareCost = totalFee
        // newShareCost = newTotalPooledEther / (prevTotalShares + shares2mint)
        //
        //
        //                  _totalRewards * prevTotalShares
        // shares2mint = ---------------------------------------
        //                 newTotalPooledEther - _totalRewards
        //

        uint256 totalSupply = ILido(lido).totalSupply();
        uint256 prevTotalShares = ILido(lido).getTotalShares();

        shares2mint = (totalFee * prevTotalShares) / (totalSupply - totalFee);

        return (shares2mint, totalKeys, moduleKeys);
    }

    /**
     *  @dev This function takes at the input the number of rewards received during the oracle report and distributes them among the connected modules
     *  @param _totalShares amount of shares to distribute
     *  @param _totalKeys total keys in modules
     *  @param _moduleKeys the number of keys in each module
     *  @return distributed actual amount of shares that was transferred to modules as a rewards
     */
    function distributeShares(uint256 _totalShares, uint256 _totalKeys, uint256[] memory _moduleKeys) external returns (uint distributed) {
        assert(_totalKeys > 0);
        require(address(lido) == msg.sender, 'INVALID_CALLER');

        uint256 treasuryShares = 0;

        //distribute shares to modules
        distributed = 0;
        for (uint256 i = 0; i < modulesCount; ++i) {
            StakingModule memory stakingModule = modules[i];
            if (!stakingModule.active) {
                continue;
            }

            IModule module = IModule(stakingModule.moduleAddress);

            uint totalFee = module.getFee() + stakingModule.treasuryFee;
            uint moduleFee = (module.getFee() * TOTAL_BASIS_POINTS) / totalFee;
            uint treasuryFee = (stakingModule.treasuryFee * TOTAL_BASIS_POINTS) / totalFee;

            // uint256 moduleTotalKeys = module.getTotalKeys();
            uint256 rewardsShares = (_totalShares * _moduleKeys[i]) / _totalKeys;

            uint256 moduleShares = (rewardsShares * moduleFee) / TOTAL_BASIS_POINTS;
            treasuryShares += (rewardsShares * treasuryFee) / TOTAL_BASIS_POINTS;

            //transfer from SR to recipient
            ILido(lido).transferShares(address(module), moduleShares);

            distributed += moduleShares;
        }

        //distribute shares to the treasury
        address treasury = ILido(lido).getTreasury();
        ILido(lido).transferShares(treasury, treasuryShares);

        uint256 remainShares = _totalShares - distributed - treasuryShares;

        // transfer remaining shares
        if (remainShares > 0) {
            ILido(lido).transferShares(treasury, remainShares);
        }
    }

    function distributeDeposits() public {
        uint256 numDeposits = address(this).balance / DEPOSIT_SIZE;

        require(numDeposits > lastNumDeposits);
        lastDistributeAt = uint64(block.timestamp);
        lastNumDeposits = numDeposits;

        ModuleLookupCacheEntry[] memory cache = getAllocation(numDeposits); //module-eth

        for (uint256 i = 0; i < modulesCount; i++) {
            allocation[i] = cache[i].assignedKeys;
        }
    }

    /**
     * @notice get total keys which can used for rewards and center distirbution
     *
     * @return totalKeys total keys which used for calculation
     * @return moduleKeys array of amount module keys
     */
    function getTotalKeys() public view returns (uint256 totalKeys, uint256[] memory moduleKeys) {
        // calculate total used keys for operators
        moduleKeys = new uint256[](modulesCount);
        for (uint256 i = 0; i < modulesCount; ++i) {
            StakingModule memory module = modules[i];
            moduleKeys[i] = IModule(module.moduleAddress).getTotalKeys();
            totalKeys += moduleKeys[i];
        }
    }

    function _loadModuleCache() internal view returns (ModuleLookupCacheEntry[] memory cache, uint totalKeys) {
        cache = new ModuleLookupCacheEntry[](modulesCount);
        if (0 == cache.length) return (cache, 0);

        uint256 idx = 0;
        for (uint256 i = 0; i < modulesCount; ++i) {
            StakingModule memory stakingModule = modules[i];
            IModule module = IModule(stakingModule.moduleAddress);

            ModuleLookupCacheEntry memory entry = cache[idx++];
            entry.id = i;
            entry.moduleAddress = stakingModule.moduleAddress;
            entry.totalKeys = module.getTotalKeys();
            totalKeys += entry.totalKeys;
            entry.totalUsedKeys = module.getTotalUsedKeys();
            entry.totalStoppedKeys = module.getTotalStoppedKeys();
            entry.totalExitedKeys = module.getTotalExitedKeys();
            entry.cap = stakingModule.cap;
            entry.paused = stakingModule.paused;
            // prefill skip flag for paused or full modules
            entry.skip = entry.paused || entry.totalUsedKeys == entry.totalKeys;
            // entry.lastDepositAt = stakingModule.lastDepositAt;
            // entry.recycleAt = stakingModule.recycleAt;
            // entry.recycleLevel = stakingModule.recycleLevel;
            // entry.recycleRestAmount = stakingModule.recycleRestAmount;
        }

        return (cache, totalKeys);
    }

    /**
     * @dev This function returns the allocation table of the specified number of keys (deposits) between modules, depending on restrictions/pauses.
     *      Priority is given to models with the lowest number of used keys
     * @param keysToDistribute the number of keys to distribute between modules
     * @return cache modules with assignedKeys variable which store the number of keys allocation
     */
    function getAllocation(uint256 keysToDistribute) public view returns (ModuleLookupCacheEntry[] memory cache) {
        uint256 totalKeys;
        (cache, totalKeys) = _loadModuleCache();
        ModuleLookupCacheEntry memory entry;
        uint _modulesCount = modulesCount;

        uint newTotlaUsedKeys;
        uint256 bestModuleIdx;
        uint256 smallestStake;
        uint256 stake;
        while (keysToDistribute > 0) {
            bestModuleIdx = _modulesCount;
            smallestStake = 0;

            for (uint256 i = 0; i < _modulesCount; i++) {
                entry = cache[i];
                if (entry.skip) {
                    continue;
                }

                // todo: unchecked?
                newTotlaUsedKeys = entry.totalUsedKeys + entry.assignedKeys;
                if (
                    newTotlaUsedKeys == entry.totalKeys ||
                    // todo: unchecked?
                    (entry.cap > 0 && (newTotlaUsedKeys * TOTAL_BASIS_POINTS) / totalKeys >= entry.cap)
                ) {
                    entry.skip = true;
                    continue;
                }

                unchecked {
                    stake = newTotlaUsedKeys - entry.totalStoppedKeys - entry.totalExitedKeys;
                }
                if (bestModuleIdx == _modulesCount || stake < smallestStake) {
                    bestModuleIdx = i;
                    smallestStake = stake;
                }
            }

            if (bestModuleIdx == _modulesCount)
                // not found
                break;

            // assert(entry.usedSigningKeys < UINT64_MAX);
            // todo: unchecked?
            ++cache[bestModuleIdx].assignedKeys;
            unchecked {
                --keysToDistribute;
            }
        }

        require(keysToDistribute == 0, 'INVALID_ASSIGNED_KEYS');

        return cache;
    }

    function getLastReportTimestamp() public view returns (uint64 lastReportAt) {
        return ILido(lido).getLastReportTimestamp();
    }

    function getModuleMaxKeys(uint256 moduleId) external view returns (uint allocKeysAmount, uint recycledKeysAmount) {
        RecycleCache memory recycleCache = getRecycleAllocation();

        return _getModuleMaxKeys(moduleId, recycleCache);
    }

    function _getModuleMaxKeys(
        uint256 moduleId,
        RecycleCache memory recycleCache
    ) internal view returns (uint allocKeysAmount, uint recycledKeysAmount) {
        IModule module = IModule(modules[moduleId].moduleAddress);
        //todo: unchecked ?
        uint restKeysAmount = module.getTotalKeys() - module.getTotalUsedKeys();
        allocKeysAmount = allocation[moduleId];
        // substruct module's own recycle keys
        unchecked {
            recycledKeysAmount = recycleCache.totalRecycleKeys - recycleCache.keysAmounts[moduleId];
        }
        if (allocKeysAmount + recycledKeysAmount > restKeysAmount) {
            //todo: check upper cap for non fallback modules (to reduce imbalance)
            unchecked {
                recycledKeysAmount = restKeysAmount - allocKeysAmount;
            }
        }
    }

    function getRecycleAllocation() public view returns (RecycleCache memory recycleCache) {
        uint _modulesCount = modulesCount;
        recycleCache.levels = new uint16[](_modulesCount);
        recycleCache.keysAmounts = new uint[](_modulesCount);
        uint64 _now = uint64(block.timestamp);
        uint64 lastReportAt = getLastReportTimestamp();
        if (lastReportAt == 0) {
            lastReportAt = lastDistributeAt;
        }

        StakingModule memory moduleCache;
        uint64 timeDelta;
        uint curAllocation;
        for (uint i = 0; i < _modulesCount; i++) {
            moduleCache = modules[i];
            curAllocation = allocation[i];
            if (curAllocation == 0) {
                continue;
            }
            if (moduleCache.recycleAt > lastReportAt) {
                // default assumes we are still on the same level
                recycleCache.levels[i] = moduleCache.recycleLevel;
                // todo: check limits in case when fallback module is 'slow'
                recycleCache.keysAmounts[i] = moduleCache.recycleRestAmount;
                //   } else {
                //     recycleCache.levels[i] = 0;
                //     recycleCache.keysAmounts[i] = 0;
            }

            if (moduleCache.lastDepositAt > lastReportAt) {
                // if module deposit has ocurred after report, check module slowness based on it lastDepositAt time
                timeDelta = _now - moduleCache.lastDepositAt;
            } else {
                // check module slowness based on lastReportAt time
                timeDelta = _now - lastReportAt;
            }
            // let kMod = Math.floor((curAllocation * 10000) / this.bufferKeys)

            uint16 curLevel;
            uint64 delay;
            // RecycleLevel memory recycleLevel;
            // find cur recycle level
            for (curLevel = recycleCache.levels[i]; curLevel < RECYCLE_LEVELS_COUNT; curLevel++) {
                // recycleLevel = _getRecycleLevel(level);
                // reduce delay for modules with bigger stake
                // delay = Math.floor((recycleLevels[curLevel].delay * (10000 - kMod)) / 10000)
                delay = _getRecycleLevel(curLevel).delay;
                if (timeDelta <= delay || delay == 0) {
                    break;
                }
            }
            if (curLevel == 0) {
                // skip healthy module
                continue;
            } else if (curLevel == RECYCLE_LEVELS_COUNT) {
                // sanity fix last level
                curLevel--;
            }
            // skip if the current level is the same
            if (curLevel > recycleCache.levels[i]) {
                // adjust amount according module share in provision stake
                // todo: едж кейс: модуль всего 1 или только один модуль не депозитит
                // let percent = recycleLevels[curLevel].percent + ((10000 - recycleLevels[curLevel].percent) * kMod) / 10000
                // const percent = _getRecycleLevel(curLevel).percent;
                recycleCache.keysAmounts[i] = (curAllocation * uint(_getRecycleLevel(curLevel).percent)) / 10000;
                recycleCache.levels[i] = curLevel;
            }
            recycleCache.totalRecycleKeys += recycleCache.keysAmounts[i];
        }
    }

    function _useRecycledKeys(uint moduleId, uint recycledKeysAmount, RecycleCache memory recycleCache) internal {
        require(recycledKeysAmount <= recycleCache.totalRecycleKeys, 'exceed recycled amount');
        uint _modulesCount = modulesCount;

        for (uint i = 0; i < _modulesCount; i++) {
            if (recycleCache.keysAmounts[i] == 0 || moduleId == i) {
                // skip recycle of the module itself, or already recycled modules
                continue;
            }
            uint keysToUse;
            uint moduleAlloc = allocation[i];
            if (recycleCache.keysAmounts[i] > recycledKeysAmount) {
                keysToUse = recycledKeysAmount;
            } else {
                keysToUse = recycleCache.keysAmounts[i];
            }
            require(keysToUse <= moduleAlloc, 'allocation < keysToUse');

            if (moduleAlloc > keysToUse) {
                modules[i].recycleLevel = recycleCache.levels[i];
                unchecked {
                    modules[i].recycleRestAmount = recycleCache.keysAmounts[i] - keysToUse;
                    allocation[i] = moduleAlloc - keysToUse;
                }
            } else {
                //moduleAlloc == keysToUse
                modules[i].recycleRestAmount = 0;
                modules[i].recycleLevel = 0;
                allocation[i] = 0;
            }
            modules[i].recycleAt = uint64(block.timestamp);

            unchecked {
                recycledKeysAmount -= keysToUse;
            }

            if (recycledKeysAmount == 0) {
                break;
            }
        }
        require(recycledKeysAmount == 0, 'recycle cache error');
    }

    /**
     * @dev Invokes a deposit call to the official Deposit contract
     * @param pubkeys Validators to stake for
     * @param signatures Signaturse of the deposit call
     */
    function deposit(bytes memory pubkeys, bytes memory signatures) external returns (uint256) {
        require(pubkeys.length > 0, 'INVALID_PUBKEYS');

        require(pubkeys.length % PUBKEY_LENGTH == 0, 'REGISTRY_INCONSISTENT_PUBKEYS_LEN');
        require(signatures.length % SIGNATURE_LENGTH == 0, 'REGISTRY_INCONSISTENT_SIG_LEN');

        uint256 keysAmount = pubkeys.length / PUBKEY_LENGTH;
        require(keysAmount == signatures.length / SIGNATURE_LENGTH, 'REGISTRY_INCONSISTENT_SIG_COUNT');

        uint moduleId = modules_ids[msg.sender];

        require(modules[moduleId].active, 'module not active');

        RecycleCache memory recycleCache = getRecycleAllocation();

        (uint allocKeysAmount, uint recycledKeysAmount) = _getModuleMaxKeys(moduleId, recycleCache);
        // todo: check module max cap
        require((allocKeysAmount + recycledKeysAmount >= keysAmount), 'not enough keys');

        // console.log('allocKeysAmount1', allocKeysAmount);
        // console.log('recycledKeysAmount1', recycledKeysAmount);
        // recycled amount correction
        if (keysAmount > allocKeysAmount) {
            recycledKeysAmount = keysAmount - allocKeysAmount;
        } else {
            recycledKeysAmount = 0;
            allocKeysAmount = keysAmount;
        }
        // console.log('allocKeysAmount2', allocKeysAmount);
        // console.log('recycledKeysAmount2', recycledKeysAmount);
        // console.log('keysAmount2', keysAmount);

        for (uint256 i = 0; i < keysAmount; ++i) {
            bytes memory pubkey = BytesLib.slice(pubkeys, i * PUBKEY_LENGTH, PUBKEY_LENGTH);
            bytes memory signature = BytesLib.slice(signatures, i * SIGNATURE_LENGTH, SIGNATURE_LENGTH);
            _stake(pubkey, signature);
        }

        allocation[moduleId] -= allocKeysAmount;
        ILido(lido).updateBufferedCounters(keysAmount);

        if (allocation[moduleId] == 0) {
            modules[moduleId].recycleRestAmount = 0;
            modules[moduleId].recycleLevel = 0;
        }

        if (recycledKeysAmount > 0) {
            _useRecycledKeys(moduleId, recycledKeysAmount, recycleCache);
        }

        // this.modules[index].used_keys += keysAmount
        modules[moduleId].lastDepositAt = uint64(block.timestamp);

        // reduce rest amount of deposits
        lastNumDeposits -= keysAmount;

        return keysAmount;

        // uint currentTimestamp = block.timestamp;
        // uint left = currentTimestamp - lastDistributeAt;

        // require(left > MAX_TIME / 2, 'time threshold');

        // uint unlocked = (left * TOTAL_BASIS_POINTS) / MAX_TIME;

        // console.log('keysAmount', keysAmount);

        // uint amount = 0;
        // uint unlocked_amount = 0;
        // for (uint i = 0; i < modulesCount; i++) {
        //     if (i == moduleId) continue;

        //     unlocked_amount = (allocation[i] * unlocked) / TOTAL_BASIS_POINTS;

        //     if (amount + unlocked_amount < keysAmount) {
        //         amount += unlocked_amount;
        //         allocation[i] -= unlocked_amount;
        //     } else {
        //         uint a = keysAmount - amount;
        //         amount += a;
        //         allocation[i] -= a;
        //     }
        // }

        // console.log('amount', amount);

        // for (uint256 i = 0; i < keysAmount; ++i) {
        //     bytes memory pubkey = BytesLib.slice(pubkeys, i * PUBKEY_LENGTH, PUBKEY_LENGTH);
        //     bytes memory signature = BytesLib.slice(signatures, i * SIGNATURE_LENGTH, SIGNATURE_LENGTH);
        //     _stake(pubkey, signature);
        // }

        // //update DEPOSITED_VALIDATORS_POSITION on LIDO
        // ILido(lido).updateBufferedCounters(keysAmount);

        // return keysAmount;
    }

    /**
     * @dev Invokes a deposit call to the official Deposit contract
     * @param _pubkey Validator to stake for
     * @param _signature Signature of the deposit call
     */
    function _stake(bytes memory _pubkey, bytes memory _signature) internal {
        bytes32 withdrawalCredentials = ILido(lido).getWithdrawalCredentials();
        require(withdrawalCredentials != 0, 'EMPTY_WITHDRAWAL_CREDENTIALS');

        uint256 value = DEPOSIT_SIZE;

        // The following computations and Merkle tree-ization will make official Deposit contract happy
        uint256 depositAmount = value / DEPOSIT_AMOUNT_UNIT;
        assert(depositAmount * DEPOSIT_AMOUNT_UNIT == value); // properly rounded

        // Compute deposit data root (`DepositData` hash tree root) according to deposit_contract.sol
        bytes32 pubkeyRoot = sha256(_pad64(_pubkey));
        bytes32 signatureRoot = sha256(
            abi.encodePacked(
                sha256(BytesLib.slice(_signature, 0, 64)),
                sha256(_pad64(BytesLib.slice(_signature, 64, SIGNATURE_LENGTH - 64)))
            )
        );

        bytes32 depositDataRoot = sha256(
            abi.encodePacked(
                sha256(abi.encodePacked(pubkeyRoot, withdrawalCredentials)),
                sha256(abi.encodePacked(_toLittleEndian64(depositAmount), signatureRoot))
            )
        );

        uint256 targetBalance = address(this).balance - value;

        getDepositContract().deposit{ value: value }(_pubkey, abi.encodePacked(withdrawalCredentials), _signature, depositDataRoot);
        require(address(this).balance == targetBalance, 'EXPECTING_DEPOSIT_TO_HAPPEN');
    }

    function trimUnusedKeys() external {
        if (modulesCount > 0) {
            for (uint256 i = 0; i < modulesCount; ++i) {
                StakingModule memory stakingModule = modules[i];
                IModule module = IModule(stakingModule.moduleAddress);

                module.trimUnusedKeys();
            }
        }
    }

    /**
     * @notice Gets deposit contract handle
     */
    function getDepositContract() public view returns (IDepositContract) {
        return IDepositContract(deposit_contract);
    }

    /**
     * @dev Padding memory array with zeroes up to 64 bytes on the right
     * @param _b Memory array of size 32 .. 64
     */
    function _pad64(bytes memory _b) internal pure returns (bytes memory) {
        assert(_b.length >= 32 && _b.length <= 64);
        if (64 == _b.length) return _b;

        bytes memory zero32 = new bytes(32);
        assembly {
            mstore(add(zero32, 0x20), 0)
        }

        if (32 == _b.length) return BytesLib.concat(_b, zero32);
        else return BytesLib.concat(_b, BytesLib.slice(zero32, 0, uint256(64) - _b.length));
    }

    /**
     * @dev Converting value to little endian bytes and padding up to 32 bytes on the right
     * @param _value Number less than `2**64` for compatibility reasons
     */
    function _toLittleEndian64(uint256 _value) internal pure returns (uint256 result) {
        result = 0;
        uint256 temp_value = _value;
        for (uint256 i = 0; i < 8; ++i) {
            result = (result << 8) | (temp_value & 0xFF);
            temp_value >>= 8;
        }

        assert(0 == temp_value); // fully converted
        result <<= (24 * 8);
    }

    // note: should be sdt to actual levels count
    uint internal constant RECYCLE_LEVELS_COUNT = 4;

    function _getRecycleLevel(uint16 level) internal pure returns (RecycleLevel memory) {
        return
            [
                RecycleLevel(12 * 3600, 0), // 0% during 12h
                RecycleLevel(15 * 3600, 5000), // 50% after 12h
                RecycleLevel(18 * 3600, 7500), // 75% after 15h
                RecycleLevel(0, 10000) // 100% after 18h
            ][level];
    }
}
