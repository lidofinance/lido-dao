// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>
//
// SPDX-License-Identifier: GPL-3.0
//
pragma solidity 0.8.9;

import "./interfaces/IStakingModule.sol";
import "./interfaces/IDepositContract.sol";
import "./lib/BytesLib.sol";
import "./lib/UnstructuredStorage.sol";

import "hardhat/console.sol";

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

    function updateBufferedCounters(uint256 depositsAmount) external;

    function getTreasury() external view returns (address);

    function getLastReportTimestamp() external view returns (uint64);
}

contract StakingRouter {
    using UnstructuredStorage for bytes32;

    event ModuleAdded();
    event ModulePaused();
    event ModuleUnpaused();
    event ModuleActiveStatus();
    event DistributedShares(uint256 modulesShares, uint256 treasuryShares, uint256 remainShares);
    event DistributedDeposits(address indexed moduleAddress, uint256 assignedKeys, uint64 timestamp);

    error InvalidType();

    struct StakingModule {
        /// @notice name of module
        string name;
        /// @notice address of module
        address moduleAddress;
        /// @notice treasury fee
        uint16 treasuryFee;
        /// @notice target percent of total keys in protocol, in BP
        uint16 targetShare;
        /// @notice target percent of targetShare can be recycled by module, in BP
        uint16 recycleShare;
        /// @notice flag if module can not accept the deposits
        bool paused;
        /// @notice flag if module can participate in further reward distribution
        bool active;
        uint64 lastDepositAt;
    }

    struct ModuleLookupCacheEntry {
        /// @notice index of module
        uint256 id;
        /// @notice address of module
        address moduleAddress;
        /// @notice total amount of keys in the module
        uint256 totalKeys;
        /// @notice total amount of used keys in the module
        uint256 totalUsedKeys;
        /// @notice total amount of stopped keys in the module
        uint256 totalStoppedKeys;
        /// @notice the number of keys that have been allocated to this module
        uint256 assignedKeys;
        /// @notice treasury fee in BP
        uint16 treasuryFee;
        /// @notice target percent of total keys in protocol, in BP
        uint16 targetShare;
        /// @notice target percent of targetShare can be recycled by module, in BP
        uint16 recycleShare;
        /// @notice flag if module can not accept the deposits
        bool paused;
        /// @notice flag if module can participate in further reward distribution
        bool active;
        bool skip;
    }

    struct RecycleLevel {
        uint64 delay;
        uint16 percent;
    }

    struct RecycleCache {
        uint256 totalRecycleKeys;
        uint256[] recycleKeys;
    }

    address public immutable lido;
    address public immutable deposit_contract;
    address public dsm;

    /// Version of the initialized contract data
    /// NB: Contract versioning starts from 1.
    /// The version stored in CONTRACT_VERSION_POSITION equals to
    /// - 0 right after deployment when no initializer is invoked yet
    /// - N after calling initialize() during deployment from scratch, where N is the current contract version
    /// - N after upgrading contract from the previous version (after calling finalize_vN())
    bytes32 internal constant CONTRACT_VERSION_POSITION = keccak256("lido.WithdrawalQueue.contractVersion");

    uint256 public constant DEPOSIT_SIZE = 32 ether;

    uint256 internal constant DEPOSIT_AMOUNT_UNIT = 1000000000 wei;
    uint256 internal constant TOTAL_BASIS_POINTS = 10000;

    uint256 public constant PUBKEY_LENGTH = 48;
    uint256 public constant SIGNATURE_LENGTH = 96;

    uint256 public constant RECYCLE_DELAY = 12 hours;

    mapping(uint256 => StakingModule) internal modules;
    mapping(address => uint256) internal modules_ids;
    uint256 internal modulesCount;

    //stake allocation module_index -> amount
    mapping(uint256 => uint256) public allocation;
    uint256 internal totalAllocation; // provisioned total stake = total current stake + total allocation

    uint64 public lastDistributeAt;
    uint256 public lastDepositsAmount;

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
     * @param _targetShare target total stake share
     * @param _recycleShare allowed share of _targetShare to be recycled by module
     * @param _treasuryFee treasury fee
     */
    function addModule(string memory _name, address _moduleAddress, uint16 _targetShare, uint16 _recycleShare, uint16 _treasuryFee)
        external
    {
        require(_targetShare <= TOTAL_BASIS_POINTS, "VALUE_OVER_100_PERCENT");
        require(_treasuryFee <= TOTAL_BASIS_POINTS, "VALUE_OVER_100_PERCENT");

        uint256 _modulesCount = modulesCount;
        StakingModule storage module = modules[_modulesCount];
        modules_ids[_moduleAddress] = _modulesCount;

        module.name = _name;
        module.moduleAddress = _moduleAddress;
        module.targetShare = _targetShare;
        module.recycleShare = _recycleShare;
        module.treasuryFee = _treasuryFee;
        module.paused = false;
        module.active = true;
        modulesCount = ++_modulesCount;
        //@todo call distribute ?
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
        require(msg.sender == dsm, "invalid_caller");

        StakingModule storage module = modules[_moduleIndex];
        require(!module.paused, "module_is_paused");

        module.paused = true;
    }

    /**
     * Unpauses deposits.
     *
     * Only callable by the dsm.
     */
    function unpauseModule(uint256 _moduleIndex) external {
        require(msg.sender == dsm, "invalid_caller");

        StakingModule storage module = modules[_moduleIndex];
        if (module.paused) {
            module.paused = false;
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
     * @notice get total keys which can used for rewards and center distirbution
     *
     * @return totalUsedKeys total keys which used for calculation
     * @return moduleUsedKeys array of amount module keys
     */
    function getTotalUsedKeys() public view returns (uint256 totalUsedKeys, uint256[] memory moduleUsedKeys) {
        // calculate total used keys for operators
        moduleUsedKeys = new uint256[](modulesCount);
        for (uint256 i = 0; i < modulesCount; ++i) {
            StakingModule memory module = modules[i];
            moduleUsedKeys[i] = IStakingModule(module.moduleAddress).getTotalUsedKeys();
            totalUsedKeys += moduleUsedKeys[i];
        }
    }

    /**
     * @notice return shares table
     *
     * @return recipients recipients list
     * @return modulesShares shares of each recipient
     * @return moduleFee shares of each recipient
     * @return treasuryFee shares of each recipient
     */
    function getSharesTable()
        external
        view
        returns (address[] memory recipients, uint256[] memory modulesShares, uint256[] memory moduleFee, uint256[] memory treasuryFee)
    {
        assert(modulesCount != 0);

        // +1 for treasury
        recipients = new address[](modulesCount);
        modulesShares = new uint256[](modulesCount);
        moduleFee = new uint256[](modulesCount);
        treasuryFee = new uint256[](modulesCount);

        uint256 idx = 0;
        uint256 treasuryShares = 0;

        (uint256 totalKeys, uint256[] memory moduleKeys) = getTotalUsedKeys();

        for (uint256 i = 0; i < modulesCount; ++i) {
            StakingModule memory stakingModule = modules[i];
            IStakingModule module = IStakingModule(stakingModule.moduleAddress);

            recipients[idx] = stakingModule.moduleAddress;
            modulesShares[idx] = (moduleKeys[i] * TOTAL_BASIS_POINTS / totalKeys);
            moduleFee[idx] = module.getFee();
            treasuryFee[idx] = stakingModule.treasuryFee;

            ++idx;
        }

        return (recipients, modulesShares, moduleFee, treasuryFee);
    }

    /**
     *  @dev This function takes at the input the number of rewards received during the oracle report and distributes them among the connected modules
     *  @param _totalShares amount of shares to distribute
     *  @param _totalKeys total keys in modules
     *  @param _moduleKeys the number of keys in each module
     *  @return distributed actual amount of shares that was transferred to modules as a rewards
     */
    function distributeShares(uint256 _totalShares, uint256 _totalKeys, uint256[] memory _moduleKeys)
        external
        returns (uint256 distributed)
    {
        assert(_totalKeys > 0);
        require(address(lido) == msg.sender, "INVALID_CALLER");

        uint256 treasuryShares = 0;

        //distribute shares to modules
        distributed = 0;
        for (uint256 i = 0; i < modulesCount; ++i) {
            StakingModule memory stakingModule = modules[i];
            if (!stakingModule.active) {
                continue;
            }

            IStakingModule module = IStakingModule(stakingModule.moduleAddress);

            uint256 totalFee = module.getFee() + stakingModule.treasuryFee;
            uint256 moduleFee = (module.getFee() * TOTAL_BASIS_POINTS) / totalFee;
            uint256 treasuryFee = (stakingModule.treasuryFee * TOTAL_BASIS_POINTS) / totalFee;

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
        uint256 depositsAmount = address(this).balance / DEPOSIT_SIZE;

        (ModuleLookupCacheEntry[] memory cache, uint256 newTotalAllocation) = getAllocation(depositsAmount);

        uint256 _modulesCount = modulesCount;
        uint64 _now = uint64(block.timestamp);
        bool isUpdated;

        for (uint256 i = 0; i < _modulesCount; i++) {
            if (allocation[i] != cache[i].assignedKeys) {
                allocation[i] = cache[i].assignedKeys;
                isUpdated = true;
                if (cache[i].assignedKeys > 0) {
                    emit DistributedDeposits(cache[i].moduleAddress, cache[i].assignedKeys, _now);
                }
            }
        }
        // @todo придумать более красивый способ от повторного распределения
        // кейс:
        // - предположим, у нас 3 модуля:
        //   1. Curated: totalKeys = 15000, totalUsedKeys = 9700, targetShare = 100% (т.е. без ограничений)
        //   2. Community: totalKeys = 300, totalUsedKeys = 100, targetShare = 1% (1% от общего числа валидаторов)
        //   3. DVT:  totalKeys = 200, totalUsedKeys = 0, targetShare = 5% (5% от общего числа валидаторов)
        // - на баланс SR приходит eth на 200 депозитов и вызывается distributeDeposits
        // - происходит аллокация по модулям (targetShare модулей в данном случае не превышен),
        //  тогда депозиты(ключи) распределятся так: Curated - 0, Community - 50, DVT - 150. Таблица аллокации: [0, 50, 150]
        // - допустим в тчении 12 часов Community и Curated модули функционируют нормально, а DVT модуль тормозит.
        // - Если Community модуль уже задепозитил 10 из своих ключей, значит вся его аллокация (т.е.
        //   еще 40 незадепозиченных ключей) не попадает под механизм recycle, а 100% аллокации DVT модуля
        //   становится доступна для депозита другими модулями.
        // - допустим Curated модуль через 12 часов депозитит все доступные recycled ключи: 100% от 150 ключей DVT модуля.
        //   Новая таблица аллокаци после депозита: [0, 40, 0].
        // - допустим, на SR приходит еще eth на 1 депозит, и повторно вывзывается distributeDeposits: метод отработает и
        //   переформирует таблицу аллокаций на: [0, 0, 40] - и ключи модуля 1 снова становятся доступны для депозита любым
        //   модулем, т.к. перетекли в корзинку модуля DVT, который на данный момент уже числится "тормозным"
        //
        // suggested solution: close the call distributeDeposits() wuth security role


        require(depositsAmount > lastDepositsAmount && isUpdated, "allocation not changed");
        totalAllocation = newTotalAllocation;
        lastDistributeAt = _now;
        lastDepositsAmount = depositsAmount;
    }

    /**
     * @dev This function returns the allocation table of the specified number of keys (deposits) between modules, depending on restrictions/pauses.
     *      Priority is given to models with the lowest number of used keys
     * @param keysToDistribute the number of keys to distribute between modules
     * @return cache modules with assignedKeys variable which store the number of keys allocation
     */
    function getAllocation(uint256 keysToDistribute)
        public
        view
        returns (ModuleLookupCacheEntry[] memory cache, uint256 newTotalAllocation)
    {
        uint256 curTotalAllocation;
        (cache, curTotalAllocation) = _loadModuleCache();

        ModuleLookupCacheEntry memory entry;
        uint256 _modulesCount = modulesCount;

        uint256 distributedKeys;
        uint256 bestModuleIdx;
        uint256 smallestStake;
        uint256 stake;
        newTotalAllocation = curTotalAllocation + keysToDistribute;
        while (distributedKeys < keysToDistribute) {
            bestModuleIdx = _modulesCount;
            smallestStake = 0;

            for (uint256 i = 0; i < _modulesCount; i++) {
                entry = cache[i];
                if (entry.skip) {
                    continue;
                }

                unchecked {
                    stake = entry.totalUsedKeys + entry.assignedKeys - entry.totalStoppedKeys;
                }
                if (
                    entry.totalUsedKeys + entry.assignedKeys == entry.totalKeys || entry.targetShare == 0
                        || (entry.targetShare < 10000 && stake >= (newTotalAllocation * entry.targetShare) / TOTAL_BASIS_POINTS)
                ) {
                    cache[i].skip = true;
                    continue;
                }

                if (bestModuleIdx == _modulesCount || stake < smallestStake) {
                    bestModuleIdx = i;
                    smallestStake = stake;
                }
            }

            if (bestModuleIdx == _modulesCount) {
                // not found
                break;
            }

            unchecked {
                cache[bestModuleIdx].assignedKeys++;
                distributedKeys++;
            }
        }

        require(distributedKeys > 0, "INVALID_ASSIGNED_KEYS");

        // get new provisoned total stake
        newTotalAllocation = curTotalAllocation + distributedKeys;
    }

    function getLastReportTimestamp() public view returns (uint64 lastReportAt) {
        return ILido(lido).getLastReportTimestamp();
    }

    function getModuleMaxKeys(uint256 moduleId) external view returns (uint256 assignedKeys, uint256 recycledKeys) {
        RecycleCache memory recycleCache = getRecycleAllocation();

        return _getModuleMaxKeys(moduleId, recycleCache);
    }

    function _getModuleMaxKeys(uint256 moduleId, RecycleCache memory recycleCache)
        internal
        view
        returns (uint256 assignedKeys, uint256 recycledKeys)
    {
        StakingModule memory moduleCache = modules[moduleId];
        IStakingModule module = IStakingModule(moduleCache.moduleAddress);

        uint256 totalKeys = module.getTotalKeys();
        uint256 totalUsedKeys = module.getTotalUsedKeys();
        uint256 stakeLimit;
        if (moduleCache.targetShare < 10000) {
            stakeLimit =
                (totalAllocation * moduleCache.targetShare * (10000 + moduleCache.recycleShare)) / TOTAL_BASIS_POINTS / TOTAL_BASIS_POINTS;
            if (stakeLimit > totalKeys) {
                stakeLimit = totalKeys;
            }
        } else {
            stakeLimit = totalKeys;
        }

        uint256 restKeys = stakeLimit - totalUsedKeys;
        assignedKeys = allocation[moduleId];
        // substruct module's own recycle keys
        unchecked {
            recycledKeys = recycleCache.totalRecycleKeys - recycleCache.recycleKeys[moduleId];
        }

        if (assignedKeys + recycledKeys > restKeys) {
            unchecked {
                recycledKeys = restKeys - assignedKeys;
            }
        }
    }

    function getRecycleAllocation() public view returns (RecycleCache memory recycleCache) {
        uint256 _modulesCount = modulesCount;
        recycleCache.recycleKeys = new uint[](_modulesCount);
        uint64 _now = uint64(block.timestamp);
        uint64 lastReportAt = getLastReportTimestamp();
        if (lastReportAt == 0) {
            lastReportAt = lastDistributeAt;
        }

        uint64 lastDepositAt;
        uint64 timeDelta;
        uint256 curAllocation;
        for (uint256 i = 0; i < _modulesCount; i++) {
            curAllocation = allocation[i];
            if (curAllocation == 0) {
                continue;
            }
            lastDepositAt = modules[i].lastDepositAt;

            // if module deposit has ocurred after report, check module slowness based on it lastDepositAt time
            // else check module slowness based on lastReportAt time
            timeDelta = _now - (lastDepositAt > lastReportAt ? lastDepositAt : lastReportAt);

            if (timeDelta > RECYCLE_DELAY) {
                recycleCache.recycleKeys[i] = curAllocation;
                recycleCache.totalRecycleKeys += curAllocation;
            }
        }
    }

    function _loadModuleCache() internal view returns (ModuleLookupCacheEntry[] memory cache, uint256 newTotalAllocation) {
        cache = new ModuleLookupCacheEntry[](modulesCount);
        if (0 == cache.length) return (cache, 0);

        uint256 idx = 0;
        for (uint256 i = 0; i < modulesCount; ++i) {
            StakingModule memory stakingModule = modules[i];
            IStakingModule module = IStakingModule(stakingModule.moduleAddress);

            ModuleLookupCacheEntry memory entry = cache[idx++];
            entry.id = i;
            entry.moduleAddress = stakingModule.moduleAddress;
            entry.totalKeys = module.getTotalKeys();
            entry.totalUsedKeys = module.getTotalUsedKeys();
            entry.totalStoppedKeys = module.getTotalStoppedKeys();
            entry.targetShare = stakingModule.targetShare;
            entry.recycleShare = stakingModule.recycleShare;
            entry.paused = stakingModule.paused;
            // prefill skip flag for paused or full modules
            entry.skip = entry.paused || entry.totalUsedKeys == entry.totalKeys;
            // update global totals
            newTotalAllocation += (entry.totalUsedKeys - entry.totalStoppedKeys);
        }
    }

    function _useRecycledKeys(uint256 moduleId, uint256 recycledKeys, RecycleCache memory recycleCache) internal {
        require(recycledKeys <= recycleCache.totalRecycleKeys, "exceed recycled amount");
        uint256 _modulesCount = modulesCount;

        for (uint256 i = 0; i < _modulesCount; i++) {
            // skip recycle of the module itself, or already recycled module
            if (recycleCache.recycleKeys[i] == 0 || moduleId == i) {
                continue;
            }
            uint256 keysToUse;
            uint256 moduleAlloc = allocation[i];
            if (recycleCache.recycleKeys[i] > recycledKeys) {
                keysToUse = recycledKeys;
            } else {
                keysToUse = recycleCache.recycleKeys[i];
            }

            // should never fired
            require(keysToUse <= moduleAlloc, "allocation < keysToUse");

            unchecked {
                allocation[i] = moduleAlloc - keysToUse;
                recycledKeys -= keysToUse;
            }

            if (recycledKeys == 0) {
                break;
            }
        }
        require(recycledKeys == 0, "recycle cache error");
    }

    /**
     * @dev Invokes a deposit call to the official Deposit contract
     * @param pubkeys Validators to stake for
     * @param signatures Signaturse of the deposit call
     */
    function deposit(bytes memory pubkeys, bytes memory signatures) external returns (uint256) {
        require(pubkeys.length > 0, "INVALID_PUBKEYS");

        require(pubkeys.length % PUBKEY_LENGTH == 0, "REGISTRY_INCONSISTENT_PUBKEYS_LEN");
        require(signatures.length % SIGNATURE_LENGTH == 0, "REGISTRY_INCONSISTENT_SIG_LEN");

        uint256 depositsAmount = pubkeys.length / PUBKEY_LENGTH;
        require(depositsAmount == signatures.length / SIGNATURE_LENGTH, "REGISTRY_INCONSISTENT_SIG_COUNT");

        uint256 moduleId = modules_ids[msg.sender];

        require(modules[moduleId].active && !modules[moduleId].paused, "module paused or not active");

        RecycleCache memory recycleCache = getRecycleAllocation();

        (uint256 assignedKeys, uint256 recycledKeys) = _getModuleMaxKeys(moduleId, recycleCache);
        require((assignedKeys + recycledKeys >= depositsAmount), "not enough keys");

        // recycled amount correction
        if (depositsAmount > assignedKeys) {
            recycledKeys = depositsAmount - assignedKeys;
        } else {
            recycledKeys = 0;
            assignedKeys = depositsAmount;
        }

        for (uint256 i = 0; i < depositsAmount; ++i) {
            bytes memory pubkey = BytesLib.slice(pubkeys, i * PUBKEY_LENGTH, PUBKEY_LENGTH);
            bytes memory signature = BytesLib.slice(signatures, i * SIGNATURE_LENGTH, SIGNATURE_LENGTH);
            _stake(pubkey, signature);
        }

        allocation[moduleId] -= assignedKeys;
        ILido(lido).updateBufferedCounters(depositsAmount);

        if (recycledKeys > 0) {
            _useRecycledKeys(moduleId, recycledKeys, recycleCache);
        }

        // this.modules[index].used_keys += depositsAmount
        modules[moduleId].lastDepositAt = uint64(block.timestamp);

        // reduce rest amount of deposits
        lastDepositsAmount -= depositsAmount;

        return depositsAmount;
    }

    /**
     * @dev Invokes a deposit call to the official Deposit contract
     * @param _pubkey Validator to stake for
     * @param _signature Signature of the deposit call
     */
    function _stake(bytes memory _pubkey, bytes memory _signature) internal {
        bytes32 withdrawalCredentials = ILido(lido).getWithdrawalCredentials();
        require(withdrawalCredentials != 0, "EMPTY_WITHDRAWAL_CREDENTIALS");

        uint256 value = DEPOSIT_SIZE;

        // The following computations and Merkle tree-ization will make official Deposit contract happy
        uint256 depositsAmount = value / DEPOSIT_AMOUNT_UNIT;
        assert(depositsAmount * DEPOSIT_AMOUNT_UNIT == value); // properly rounded

        // Compute deposit data root (`DepositData` hash tree root) according to deposit_contract.sol
        bytes32 pubkeyRoot = sha256(_pad64(_pubkey));
        bytes32 signatureRoot = sha256(
            abi.encodePacked(
                sha256(BytesLib.slice(_signature, 0, 64)), sha256(_pad64(BytesLib.slice(_signature, 64, SIGNATURE_LENGTH - 64)))
            )
        );

        bytes32 depositDataRoot = sha256(
            abi.encodePacked(
                sha256(abi.encodePacked(pubkeyRoot, withdrawalCredentials)),
                sha256(abi.encodePacked(_toLittleEndian64(depositsAmount), signatureRoot))
            )
        );

        uint256 targetBalance = address(this).balance - value;

        getDepositContract().deposit{value: value}(_pubkey, abi.encodePacked(withdrawalCredentials), _signature, depositDataRoot);
        require(address(this).balance == targetBalance, "EXPECTING_DEPOSIT_TO_HAPPEN");
    }

    function trimUnusedKeys() external {
        if (modulesCount > 0) {
            for (uint256 i = 0; i < modulesCount; ++i) {
                StakingModule memory stakingModule = modules[i];
                IStakingModule module = IStakingModule(stakingModule.moduleAddress);

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

    // note: should be set to actual levels count
    uint256 internal constant RECYCLE_LEVELS_COUNT = 4;

    function _getRecycleLevel(uint16 level) internal pure returns (RecycleLevel memory) {
        return [
            RecycleLevel(12 * 3600, 0), // 0% during 12h
            RecycleLevel(15 * 3600, 5000), // 50% after 12h
            RecycleLevel(18 * 3600, 7500), // 75% after 15h
            RecycleLevel(0, 10000) // 100% after 18h
        ][level];
    }
}
