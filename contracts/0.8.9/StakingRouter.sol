// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {AccessControlEnumerable} from "@openzeppelin/contracts-v4.4/access/AccessControlEnumerable.sol";

import {IStakingRouter} from "./interfaces/IStakingRouter.sol";
import {IStakingModule} from "./interfaces/IStakingModule.sol";
import {ILido} from "./interfaces/ILido.sol";

import {Math} from "./lib/Math.sol";
import {UnstructuredStorage} from "./lib/UnstructuredStorage.sol";
import {MinFirstAllocationStrategy} from "../common/lib/MinFirstAllocationStrategy.sol";

import {BeaconChainDepositor} from "./BeaconChainDepositor.sol";

contract StakingRouter is IStakingRouter, AccessControlEnumerable, BeaconChainDepositor {
    using UnstructuredStorage for bytes32;

    /// @dev events
    event StakingModuleAdded(uint24 indexed stakingModuleId, address stakingModule, string name, address createdBy);
    event StakingModuleTargetShareSet(uint24 indexed stakingModuleId, uint16 targetShare);
    event StakingModuleFeesSet(uint24 indexed stakingModuleId, uint16 treasuryFee, uint16 moduleFee);
    event StakingModuleStatusSet(uint24 indexed stakingModuleId, StakingModuleStatus status, address setBy);
    event WithdrawalCredentialsSet(bytes32 withdrawalCredentials);
    event ContractVersionSet(uint256 version);
    /**
     * Emitted when the StakingRouter received ETH
     */
    event StakingRouterETHReceived(uint256 amount);
    event StakingRouterETHDeposited(uint24 indexed stakingModuleId, uint256 amount);

    /// @dev errors
    error ErrorZeroAddress(string field);
    error ErrorBaseVersion();
    error ErrorValueOver100Percent(string field);
    error ErrorStakingModuleStatusNotChanged();
    error ErrorStakingModuleNotActive();
    error ErrorStakingModuleNotPaused();
    error ErrorEmptyWithdrawalsCredentials();
    error ErrorDirectETHTransfer();

    struct StakingModuleCache {
        address stakingModuleAddress;
        uint16 moduleFee;
        uint16 treasuryFee;
        uint16 targetShare;
        uint256 activeKeysCount;
        uint256 availableKeysCount;
    }

    bytes32 public constant MANAGE_WITHDRAWAL_CREDENTIALS_ROLE = keccak256("MANAGE_WITHDRAWAL_CREDENTIALS_ROLE");
    bytes32 public constant MODULE_PAUSE_ROLE = keccak256("MODULE_PAUSE_ROLE");
    bytes32 public constant MODULE_RESUME_ROLE = keccak256("MODULE_RESUME_ROLE");
    bytes32 public constant MODULE_MANAGE_ROLE = keccak256("MODULE_MANAGE_ROLE");

    /// Version of the initialized contract data
    /// NB: Contract versioning starts from 1.
    /// The version stored in CONTRACT_VERSION_POSITION equals to
    /// - 0 right after deployment when no initializer is invoked yet
    /// - N after calling initialize() during deployment from scratch, where N is the current contract version
    /// - N after upgrading contract from the previous version (after calling finalize_vN())
    bytes32 internal constant CONTRACT_VERSION_POSITION = keccak256("lido.StakingRouter.contractVersion");

    bytes32 internal constant LIDO_POSITION = keccak256("lido.StakingRouter.lido");

    /// @dev Credentials which allows the DAO to withdraw Ether on the 2.0 side
    bytes32 internal constant WITHDRAWAL_CREDENTIALS_POSITION = keccak256("lido.StakingRouter.withdrawalCredentials");

    /// @dev total count of staking modules
    bytes32 internal constant STAKING_MODULES_COUNT_POSITION = keccak256("lido.StakingRouter.stakingModulesCount");
    /// @dev id of the last added staking module. This counter grow on staking modules adding
    bytes32 internal constant LAST_STAKING_MODULE_ID_POSITION = keccak256("lido.StakingRouter.lastStakingModuleId");
    /// @dev mapping is used instead of array to allow to extend the StakingModule
    bytes32 internal constant STAKING_MODULES_MAPPING_POSITION = keccak256("lido.StakingRouter.stakingModules");
    /// @dev Position of the staking modules in the `_stakingModules` map, plus 1 because
    ///      index 0 means a value is not in the set.
    bytes32 internal constant STAKING_MODULE_INDICES_MAPPING_POSITION = keccak256("lido.StakingRouter.stakingModuleIndicesOneBased");

    uint256 internal constant FEE_PRECISION_POINTS = 10 ** 20; // 100 * 10 ** 18
    uint256 public constant TOTAL_BASIS_POINTS = 10000;

    constructor(address _depositContract) BeaconChainDepositor(_depositContract) {
        /// @dev lock version in implementation to avoid initialize() call
        ///      DEFAULT_ADMIN_ROLE will remain unset, i.e. no ability to add new members ro roles
        _setContractVersion(type(uint256).max);
    }

    /**
     * @dev proxy initialization
     * @param _admin Lido DAO Aragon agent contract address
     * @param _withdrawalCredentials Lido withdrawal vault contract address
     */
    function initialize(address _admin, address _lido, bytes32 _withdrawalCredentials) external {
        if (_admin == address(0)) revert ErrorZeroAddress("_admin");
        if (_lido == address(0)) revert ErrorZeroAddress("_lido");
        if (CONTRACT_VERSION_POSITION.getStorageUint256() != 0) revert ErrorBaseVersion();
        _setContractVersion(1);

        _setupRole(DEFAULT_ADMIN_ROLE, _admin);

        LIDO_POSITION.setStorageAddress(_lido);
        WITHDRAWAL_CREDENTIALS_POSITION.setStorageBytes32(_withdrawalCredentials);
        emit WithdrawalCredentialsSet(_withdrawalCredentials);
    }

    /// @dev prohibit direct transfer to contract
    receive() external payable {
        revert ErrorDirectETHTransfer();
    }

    /**
     * @notice Return the Lido contract address
     */
    function getLido() public view returns (ILido) {
        return ILido(LIDO_POSITION.getStorageAddress());
    }

    /**
     * @notice register a new module
     * @param _name name of module
     * @param _stakingModuleAddress target percent of total keys in protocol, in BP
     * @param _targetShare target total stake share
     * @param _moduleFee fee of the module taken from the consensus layer rewards
     * @param _treasuryFee treasury fee
     */
    function addModule(
        string calldata _name,
        address _stakingModuleAddress,
        uint16 _targetShare,
        uint16 _moduleFee,
        uint16 _treasuryFee
    ) external onlyRole(MODULE_MANAGE_ROLE) {
        if (_targetShare > TOTAL_BASIS_POINTS) revert ErrorValueOver100Percent("_targetShare");
        if (_moduleFee + _treasuryFee > TOTAL_BASIS_POINTS) revert ErrorValueOver100Percent("_moduleFee + _treasuryFee");

        uint256 newStakingModuleIndex = getStakingModulesCount();
        StakingModule storage newStakingModule = _getStakingModuleByIndex(newStakingModuleIndex);
        uint24 newStakingModuleId = uint24(LAST_STAKING_MODULE_ID_POSITION.getStorageUint256()) + 1;

        newStakingModule.id = newStakingModuleId;
        newStakingModule.name = _name;
        newStakingModule.stakingModuleAddress = _stakingModuleAddress;
        newStakingModule.targetShare = _targetShare;
        newStakingModule.treasuryFee = _treasuryFee;
        newStakingModule.moduleFee = _moduleFee;
        /// @dev since `enum` is `uint8` by nature, so the `status` is stored as `uint8` to avoid possible problems when upgrading.
        ///      But for human readability, we use `enum` as function parameter type.
        ///      More about conversion in the docs https://docs.soliditylang.org/en/v0.8.17/types.html#enums
        newStakingModule.status = uint8(StakingModuleStatus.Active);

        _setStakingModuleIndexById(newStakingModuleId, newStakingModuleIndex);
        LAST_STAKING_MODULE_ID_POSITION.setStorageUint256(newStakingModuleId);
        STAKING_MODULES_COUNT_POSITION.setStorageUint256(newStakingModuleIndex + 1);

        emit StakingModuleAdded(newStakingModuleId, _stakingModuleAddress, _name, msg.sender);
        emit StakingModuleTargetShareSet(newStakingModuleId, _targetShare);
        emit StakingModuleFeesSet(newStakingModuleId, _treasuryFee, _moduleFee);
    }

    function updateStakingModule(
        uint24 _stakingModuleId,
        uint16 _targetShare,
        uint16 _moduleFee,
        uint16 _treasuryFee
    ) external onlyRole(MODULE_MANAGE_ROLE) {
        if (_targetShare > TOTAL_BASIS_POINTS) revert ErrorValueOver100Percent("_targetShare");
        if (_moduleFee + _treasuryFee > TOTAL_BASIS_POINTS) revert ErrorValueOver100Percent("_moduleFee + _treasuryFee");

        uint256 stakingModuleIndex = _getStakingModuleIndexById(_stakingModuleId);
        StakingModule storage stakingModule = _getStakingModuleByIndex(stakingModuleIndex);

        stakingModule.targetShare = _targetShare;
        stakingModule.treasuryFee = _treasuryFee;
        stakingModule.moduleFee = _moduleFee;

        emit StakingModuleTargetShareSet(_stakingModuleId, _targetShare);
        emit StakingModuleFeesSet(_stakingModuleId, _treasuryFee, _moduleFee);
    }

    function getStakingModules() external view returns (StakingModule[] memory res) {
        uint256 modulesCount = getStakingModulesCount();
        res = new StakingModule[](modulesCount);
        for (uint256 i; i < modulesCount; ) {
            res[i] = _getStakingModuleByIndex(i);
            unchecked {
                ++i;
            }
        }
    }

    /**
     *  @dev Returns staking module by id
     */
    function getStakingModule(uint24 _stakingModuleId) external view returns (StakingModule memory) {
        return _getStakingModuleById(_stakingModuleId);
    }

    /**
     * @dev Returns total number of staking modules
     */
    function getStakingModulesCount() public view returns (uint256) {
        return STAKING_MODULES_COUNT_POSITION.getStorageUint256();
    }

    /**
     *  @dev Returns staking module by index
     */
    function getStakingModuleByIndex(uint256 _stakingModuleIdndex) external view returns (StakingModule memory) {
        return _getStakingModuleByIndex(_stakingModuleIdndex);
    }

    function getStakingModuleStatus(uint24 _stakingModuleId) public view returns (StakingModuleStatus) {
        return StakingModuleStatus(_getStakingModuleById(_stakingModuleId).status);
    }

    /**
     * @notice set the module status flag for participation in further deposits and/or reward distribution
     */
    function setStakingModuleStatus(uint24 _stakingModuleId, StakingModuleStatus _status) external onlyRole(MODULE_MANAGE_ROLE) {
        StakingModule storage stakingModule = _getStakingModuleById(_stakingModuleId);
        stakingModule.status = uint8(_status);
        emit StakingModuleStatusSet(_stakingModuleId, _status, msg.sender);
    }

    /**
     * @notice pause deposits for module
     * @param _stakingModuleId id of the staking module to be paused
     */
    function pauseStakingModule(uint24 _stakingModuleId) external onlyRole(MODULE_PAUSE_ROLE) {
        StakingModule storage stakingModule = _getStakingModuleById(_stakingModuleId);
        StakingModuleStatus _prevStatus = StakingModuleStatus(stakingModule.status);
        if (_prevStatus != StakingModuleStatus.Active) revert ErrorStakingModuleNotActive();
        stakingModule.status = uint8(StakingModuleStatus.DepositsPaused);
        emit StakingModuleStatusSet(_stakingModuleId, StakingModuleStatus.DepositsPaused, msg.sender);
    }

    /**
     * @notice resume deposits for module
     * @param _stakingModuleId id of the staking module to be unpaused
     */
    function resumeStakingModule(uint24 _stakingModuleId) external onlyRole(MODULE_RESUME_ROLE) {
        StakingModule storage stakingModule = _getStakingModuleById(_stakingModuleId);
        StakingModuleStatus _prevStatus = StakingModuleStatus(stakingModule.status);
        if (_prevStatus != StakingModuleStatus.DepositsPaused) revert ErrorStakingModuleNotPaused();
        stakingModule.status = uint8(StakingModuleStatus.Active);
        emit StakingModuleStatusSet(_stakingModuleId, StakingModuleStatus.Active, msg.sender);
    }

    function getStakingModuleIsStopped(uint24 _stakingModuleId) external view returns (bool) {
        return getStakingModuleStatus(_stakingModuleId) == StakingModuleStatus.Stopped;
    }

    function getStakingModuleIsDepositsPaused(uint24 _stakingModuleId) external view returns (bool) {
        return getStakingModuleStatus(_stakingModuleId) == StakingModuleStatus.DepositsPaused;
    }

    function getStakingModuleIsActive(uint24 _stakingModuleId) external view returns (bool) {
        return getStakingModuleStatus(_stakingModuleId) == StakingModuleStatus.Active;
    }

    function getStakingModuleKeysOpIndex(uint24 _stakingModuleId) external view returns (uint256) {
        return IStakingModule(_getStakingModuleAddressById(_stakingModuleId)).getValidatorsKeysNonce();
    }

    function getStakingModuleLastDepositBlock(uint24 _stakingModuleId) external view returns (uint256) {
        StakingModule storage module = _getStakingModuleById(_stakingModuleId);
        return module.lastDepositBlock;
    }

    function getStakingModuleActiveKeysCount(uint24 _stakingModuleId) external view returns (uint256 activeKeysCount) {
        (, activeKeysCount, ) = IStakingModule(_getStakingModuleAddressById(_stakingModuleId)).getValidatorsKeysStats();
    }

    /**
     * @dev calculate max count of depositable module keys based on the current Staking Router balance and buffered Ether amoutn
     *
     * @param _stakingModuleId id of the staking module to be deposited
     * @return max depositable keys count
     */
    function getStakingModuleMaxDepositableKeys(uint24 _stakingModuleId) external view returns (uint256) {
        uint256 _keysToAllocate = getLido().getBufferedEther() / DEPOSIT_SIZE;
        return _estimateStakingModuleMaxDepositableKeysByIndex(_getStakingModuleIndexById(_stakingModuleId), _keysToAllocate);
    }

    /**
     * @dev calculate max count of depositable module keys based on the total expected number of deposits
     *
     * @param _stakingModuleIndex module index
     * @param _keysToAllocate total number of deposits to be made
     * @return max depositable keys count
     */
    function _estimateStakingModuleMaxDepositableKeysByIndex(
        uint256 _stakingModuleIndex,
        uint256 _keysToAllocate
    ) internal view returns (uint256) {
        (, uint256[] memory newKeysAllocation, StakingModuleCache[] memory modulesCache) = _getKeysAllocation(_keysToAllocate);
        return newKeysAllocation[_stakingModuleIndex] - modulesCache[_stakingModuleIndex].activeKeysCount;
    }

    /**
     * @notice return shares table
     *
     * @return recipients recipients list
     * @return moduleFees fee of each recipient
     * @return totalFee total fee to mint for each module and treasury
     */
    function getStakingRewardsDistribution()
        external
        view
        returns (address[] memory recipients, uint96[] memory moduleFees, uint96 totalFee, uint256 precisionPoints)
    {
        (uint256 totalActiveKeys, StakingModuleCache[] memory modulesCache) = _loadNotStoppedStakingModulesCache();
        uint256 modulesCount = modulesCache.length;

        /// @dev return empty response if there are no modules or active keys yet
        if (modulesCount == 0 || totalActiveKeys == 0) {
            return (new address[](0), new uint96[](0), 0, FEE_PRECISION_POINTS);
        }

        precisionPoints = FEE_PRECISION_POINTS;
        recipients = new address[](modulesCount);
        moduleFees = new uint96[](modulesCount);

        uint256 rewardedModulesCount = 0;
        uint256 moduleKeysShare;

        for (uint256 i; i < modulesCount; ) {
            /// @dev skip modules which have no active keys
            if (modulesCache[i].activeKeysCount > 0) {
                moduleKeysShare = ((modulesCache[i].activeKeysCount * precisionPoints) / totalActiveKeys);

                recipients[i] = address(modulesCache[i].stakingModuleAddress);
                moduleFees[i] = uint96((moduleKeysShare * modulesCache[i].moduleFee) / TOTAL_BASIS_POINTS);

                totalFee += uint96((moduleKeysShare * modulesCache[i].treasuryFee) / TOTAL_BASIS_POINTS) + moduleFees[i];

                unchecked {
                    rewardedModulesCount++;
                }
            }
            unchecked {
                ++i;
            }
        }

        // sanity check
        if (totalFee >= precisionPoints) revert ErrorValueOver100Percent("totalFee");

        /// @dev shrink arrays
        if (rewardedModulesCount < modulesCount) {
            uint256 trim = modulesCount - rewardedModulesCount;
            assembly {
                mstore(recipients, sub(mload(recipients), trim))
                mstore(moduleFees, sub(mload(moduleFees), trim))
            }
        }
    }

    /// @notice returns new deposits allocation after the distribution of the `_keysToAllocate` keys
    function getKeysAllocation(uint256 _keysToAllocate) public view returns (uint256 allocated, uint256[] memory allocations) {
        (allocated, allocations, ) = _getKeysAllocation(_keysToAllocate);
    }

    /**
     * @dev Invokes a deposit call to the official Deposit contract
     * @param _maxDepositsCount max deposits count
     * @param _stakingModuleId id of the staking module to be deposited
     * @param _depositCalldata module calldata
     */
    function deposit(
        uint256 _maxDepositsCount,
        uint24 _stakingModuleId,
        bytes calldata _depositCalldata
    ) external payable returns (uint256 keysCount) {
        require(msg.sender == LIDO_POSITION.getStorageAddress(), "APP_AUTH_LIDO_FAILED");

        uint256 depositableEth = msg.value;
        if (depositableEth == 0) {
            _transferBalanceEthToLido();
            return 0;
        }

        bytes32 withdrawalCredentials = getWithdrawalCredentials();
        if (withdrawalCredentials == 0) revert ErrorEmptyWithdrawalsCredentials();

        uint256 stakingModuleIndex = _getStakingModuleIndexById(_stakingModuleId);
        StakingModule storage stakingModule = _getStakingModuleByIndex(stakingModuleIndex);
        require(StakingModuleStatus(stakingModule.status) == StakingModuleStatus.Active, "STAKING_MODULE_NOT_ACTIVE");

        uint256 maxDepositableKeys = _estimateStakingModuleMaxDepositableKeysByIndex(
            stakingModuleIndex,
            Math.min(depositableEth / DEPOSIT_SIZE, _maxDepositsCount)
        );

        if (maxDepositableKeys > 0) {
            bytes memory publicKeysBatch;
            bytes memory signaturesBatch;
            (keysCount, publicKeysBatch, signaturesBatch) = IStakingModule(stakingModule.stakingModuleAddress)
                .requestValidatorsKeysForDeposits(maxDepositableKeys, _depositCalldata);

            if (keysCount > 0) {
                _makeBeaconChainDeposits32ETH(keysCount, abi.encodePacked(withdrawalCredentials), publicKeysBatch, signaturesBatch);

                stakingModule.lastDepositAt = uint64(block.timestamp);
                stakingModule.lastDepositBlock = block.number;

                emit StakingRouterETHDeposited(_getStakingModuleIdByIndex(stakingModuleIndex), keysCount * DEPOSIT_SIZE);
            }
        }
        _transferBalanceEthToLido();
        // return keysCount;
    }

    /// @dev transfer all remaining balance to Lido contract
    function _transferBalanceEthToLido() internal {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            getLido().receiveStakingRouter{value: balance}();
        }
    }

    /**
     * @notice Set credentials to withdraw ETH on Consensus Layer side after the phase 2 is launched to `_withdrawalCredentials`
     * @dev Note that setWithdrawalCredentials discards all unused signing keys as the signatures are invalidated.
     * @param _withdrawalCredentials withdrawal credentials field as defined in the Ethereum PoS consensus specs
     */
    function setWithdrawalCredentials(bytes32 _withdrawalCredentials) external onlyRole(MANAGE_WITHDRAWAL_CREDENTIALS_ROLE) {
        WITHDRAWAL_CREDENTIALS_POSITION.setStorageBytes32(_withdrawalCredentials);

        //trim keys with old WC
        _trimUnusedKeys();

        emit WithdrawalCredentialsSet(_withdrawalCredentials);
    }

    /**
     * @notice Returns current credentials to withdraw ETH on Consensus Layer side after the phase 2 is launched
     */
    function getWithdrawalCredentials() public view returns (bytes32) {
        return WITHDRAWAL_CREDENTIALS_POSITION.getStorageBytes32();
    }

    function _trimUnusedKeys() internal {
        uint256 modulesCount = getStakingModulesCount();
        for (uint256 i; i < modulesCount; ) {
            IStakingModule(_getStakingModuleAddressByIndex(i)).invalidateReadyToDepositKeys();
            unchecked {
                ++i;
            }
        }
    }

    function _loadStakingModuleCache(
        uint256 _stakingModuleIndex
    ) internal view returns (StakingModuleStatus status, StakingModuleCache memory stakingModuleCache) {
        StakingModule storage stakingModuleData = _getStakingModuleByIndex(_stakingModuleIndex);
        stakingModuleCache.stakingModuleAddress = stakingModuleData.stakingModuleAddress;
        stakingModuleCache.moduleFee = stakingModuleData.moduleFee;
        stakingModuleCache.treasuryFee = stakingModuleData.treasuryFee;
        stakingModuleCache.targetShare = stakingModuleData.targetShare;
        status = StakingModuleStatus(stakingModuleData.status);
    }

    /**
     * @dev load not stopped modules list
     * @notice used for reward distribution
     * @return totalActiveKeys for not stopped modules
     * @return modulesCache array of StakingModuleCache struct
     */
    function _loadNotStoppedStakingModulesCache()
        internal
        view
        returns (uint256 totalActiveKeys, StakingModuleCache[] memory modulesCache)
    {
        uint256 modulesCount = getStakingModulesCount();
        modulesCache = new StakingModuleCache[](modulesCount);
        StakingModuleStatus status;
        for (uint256 i; i < modulesCount; ) {
            (status, modulesCache[i]) = _loadStakingModuleCache(i);

            /// @dev account only keys from not stopped modules (i.e. active and paused)
            if (status != StakingModuleStatus.Stopped) {
                (, modulesCache[i].activeKeysCount, modulesCache[i].availableKeysCount) = IStakingModule(
                    modulesCache[i].stakingModuleAddress
                ).getValidatorsKeysStats();
                totalActiveKeys += modulesCache[i].activeKeysCount;
            }
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @dev load active modules list
     * @notice used for deposits allocation
     * @return totalActiveKeys for active modules
     * @return modulesCache array of StakingModuleCache struct
     */
    function _loadActiveStakingModulesCache() internal view returns (uint256 totalActiveKeys, StakingModuleCache[] memory modulesCache) {
        uint256 modulesCount = getStakingModulesCount();
        modulesCache = new StakingModuleCache[](modulesCount);
        StakingModuleStatus status;

        for (uint256 i; i < modulesCount; ) {
            (status, modulesCache[i]) = _loadStakingModuleCache(i);

            /// @dev account only keys from active modules
            if (status == StakingModuleStatus.Active) {
                (, modulesCache[i].activeKeysCount, modulesCache[i].availableKeysCount) = IStakingModule(
                    modulesCache[i].stakingModuleAddress
                ).getValidatorsKeysStats();
                totalActiveKeys += modulesCache[i].activeKeysCount;
            }
            unchecked {
                ++i;
            }
        }
    }

    function _getKeysAllocation(
        uint256 _keysToAllocate
    ) internal view returns (uint256 allocated, uint256[] memory allocations, StakingModuleCache[] memory modulesCache) {
        // calculate total used keys for operators
        uint256 totalActiveKeys;

        (totalActiveKeys, modulesCache) = _loadActiveStakingModulesCache();

        uint256 modulesCount = modulesCache.length;
        allocations = new uint256[](modulesCount);
        if (modulesCount > 0) {
            /// @dev new estimated active keys count
            totalActiveKeys += _keysToAllocate;
            uint256[] memory capacities = new uint256[](modulesCount);
            uint256 targetKeys;

            for (uint256 i; i < modulesCount; ) {
                allocations[i] = modulesCache[i].activeKeysCount;
                targetKeys = (modulesCache[i].targetShare * totalActiveKeys) / TOTAL_BASIS_POINTS;
                capacities[i] = Math.min(targetKeys, modulesCache[i].activeKeysCount + modulesCache[i].availableKeysCount);
                unchecked {
                    ++i;
                }
            }

            allocated = MinFirstAllocationStrategy.allocate(allocations, capacities, _keysToAllocate);
        }
    }

    function _getStakingModuleIndexById(uint24 _stakingModuleId) internal view returns (uint256) {
        mapping(uint24 => uint256) storage _stakingModuleIndicesOneBased = _getStorageStakingIndicesMapping(
            STAKING_MODULE_INDICES_MAPPING_POSITION
        );
        uint256 indexOneBased = _stakingModuleIndicesOneBased[_stakingModuleId];
        require(indexOneBased > 0, "UNREGISTERED_STAKING_MODULE");
        return indexOneBased - 1;
    }

    function _setStakingModuleIndexById(uint24 _stakingModuleId, uint256 _stakingModuleIndex) internal {
        mapping(uint24 => uint256) storage _stakingModuleIndicesOneBased = _getStorageStakingIndicesMapping(
            STAKING_MODULE_INDICES_MAPPING_POSITION
        );
        _stakingModuleIndicesOneBased[_stakingModuleId] = _stakingModuleIndex + 1;
    }

    function _getStakingModuleIdByIndex(uint256 _stakingModuleIndex) internal view returns (uint24) {
        return _getStakingModuleByIndex(_stakingModuleIndex).id;
    }

    function _getStakingModuleById(uint24 _stakingModuleId) internal view returns (StakingModule storage) {
        return _getStakingModuleByIndex(_getStakingModuleIndexById(_stakingModuleId));
    }

    function _getStakingModuleByIndex(uint256 _stakingModuleIndex) internal view returns (StakingModule storage) {
        mapping(uint256 => StakingModule) storage _stakingModules = _getStorageStakingModulesMapping(STAKING_MODULES_MAPPING_POSITION);
        return _stakingModules[_stakingModuleIndex];
    }

    function _getStakingModuleAddressById(uint24 _stakingModuleId) internal view returns (address) {
        return _getStakingModuleById(_stakingModuleId).stakingModuleAddress;
    }

    function _getStakingModuleAddressByIndex(uint256 _stakingModuleIndex) internal view returns (address) {
        return _getStakingModuleByIndex(_stakingModuleIndex).stakingModuleAddress;
    }

    function _setContractVersion(uint256 version) internal {
        CONTRACT_VERSION_POSITION.setStorageUint256(version);
        emit ContractVersionSet(version);
    }

    function _getStorageStakingModulesMapping(bytes32 position) internal pure returns (mapping(uint256 => StakingModule) storage result) {
        assembly {
            result.slot := position
        }
    }

    function _getStorageStakingIndicesMapping(bytes32 position) internal pure returns (mapping(uint24 => uint256) storage result) {
        assembly {
            result.slot := position
        }
    }
}
