// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {AccessControlEnumerable} from "@openzeppelin/contracts-v4.4/access/AccessControlEnumerable.sol";

import {IStakingRouter} from "./interfaces/IStakingRouter.sol";
import {IStakingModule} from "./interfaces/IStakingModule.sol";

import {Math} from "./lib/Math.sol";
import {UnstructuredStorage} from "./lib/UnstructuredStorage.sol";
import {MinFirstAllocationStrategy} from "./lib/MinFirstAllocationStrategy.sol";

import {BeaconChainDepositor} from "./BeaconChainDepositor.sol";

contract StakingRouter is IStakingRouter, AccessControlEnumerable, BeaconChainDepositor {
    using UnstructuredStorage for bytes32;

    /// @dev events
    event StakingModuleAdded(uint24 indexed stakingModuleId, address stakingModule, string name, address createdBy);
    event StakingModuleTargetShareSet(uint24 indexed stakingModuleId, uint16 targetShare);
    event StakingModuleFeesSet(uint24 indexed stakingModuleId, uint16 treasuryFee, uint16 moduleFee);
    event StakingModuleStatusChanged(
        uint24 indexed stakingModuleId,
        StakingModuleStatus fromStatus,
        StakingModuleStatus toStatus,
        address changedBy
    );
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
    error ErrorStakingModuleIsPaused();
    error ErrorStakingModuleIsNotPaused();
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
    bytes32 public constant STAKING_ROUTER_DEPOSIT_ROLE = keccak256("STAKING_ROUTER_DEPOSIT_ROLE");

    /// Version of the initialized contract data
    /// NB: Contract versioning starts from 1.
    /// The version stored in CONTRACT_VERSION_POSITION equals to
    /// - 0 right after deployment when no initializer is invoked yet
    /// - N after calling initialize() during deployment from scratch, where N is the current contract version
    /// - N after upgrading contract from the previous version (after calling finalize_vN())
    bytes32 internal constant CONTRACT_VERSION_POSITION = keccak256("lido.StakingRouter.contractVersion");

    /// @dev Credentials which allows the DAO to withdraw Ether on the 2.0 side
    bytes32 internal constant WITHDRAWAL_CREDENTIALS_POSITION = keccak256("lido.StakingRouter.withdrawalCredentials");

    uint256 public constant TOTAL_BASIS_POINTS = 10000;

    /// @dev total count of staking modules
    uint256 private _stakingModulesCount;

    /// @dev id of the last added staking module. This counter grow on staking modules adding
    uint24 private _lastStakingModuleId;

    /// @dev mapping is used instead of array to allow to extend the StakingModule
    mapping(uint256 => StakingModule) private _stakingModules;

    /// @dev Position of the staking modules in the `_stakingModules` map, plus 1 because
    ///      index 0 means a value is not in the set.
    mapping(uint24 => uint256) private _stakingModuleIndicesOneBased;

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
    function initialize(address _admin, bytes32 _withdrawalCredentials) external {
        if (_admin == address(0)) revert ErrorZeroAddress("_admin");
        if (CONTRACT_VERSION_POSITION.getStorageUint256() != 0) revert ErrorBaseVersion();
        _setContractVersion(1);

        _setupRole(DEFAULT_ADMIN_ROLE, _admin);

        WITHDRAWAL_CREDENTIALS_POSITION.setStorageBytes32(_withdrawalCredentials);
        emit WithdrawalCredentialsSet(_withdrawalCredentials);
    }

    /// @dev prohibit direct transfer to contract
    receive() external payable {
        revert ErrorDirectETHTransfer();
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

        uint24 newStakingModuleId = _lastStakingModuleId + 1;
        uint256 newStakingModuleIndex = _stakingModulesCount;
        StakingModule storage newStakingModule = _stakingModules[newStakingModuleIndex];

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

        _stakingModuleIndicesOneBased[newStakingModuleId] = newStakingModuleIndex + 1;

        _lastStakingModuleId = newStakingModuleId;
        _stakingModulesCount = newStakingModuleIndex + 1;

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

        _stakingModules[stakingModuleIndex].targetShare = _targetShare;
        _stakingModules[stakingModuleIndex].treasuryFee = _treasuryFee;
        _stakingModules[stakingModuleIndex].moduleFee = _moduleFee;

        emit StakingModuleTargetShareSet(_stakingModuleId, _targetShare);
        emit StakingModuleFeesSet(_stakingModuleId, _treasuryFee, _moduleFee);
    }

    function getStakingModules() external view returns (StakingModule[] memory res) {
        uint256 _modulesCount = getStakingModulesCount();
        res = new StakingModule[](_modulesCount);
        for (uint256 i = 0; i < _modulesCount; ++i) {
            res[i] = _getStakingModuleByIndex(i);
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
        return _stakingModulesCount;
    }

    /**
     *  @dev Returns staking module by index
     */
    function getStakingModuleByIndex(uint256 _stakingModuleIdndex) external view returns (StakingModule memory) {
        return _getStakingModuleByIndex(_stakingModuleIdndex);
    }

    function getStakingModuleStatus(uint24 _stakingModuleId) external view returns (StakingModuleStatus) {
        return _getStakingModuleStatusByIndex(_getStakingModuleIndexById(_stakingModuleId));
    }

    /**
     * @notice set the module status flag for participation in further deposits and/or reward distribution
     */
    function changeStakingModuleStatus(uint24 _stakingModuleId, StakingModuleStatus _status) external onlyRole(MODULE_MANAGE_ROLE) {
        uint _stakingModuleIndex = _getStakingModuleIndexById(_stakingModuleId);
        StakingModuleStatus _prevStatus = _getStakingModuleStatusByIndex(_stakingModuleIndex);
        if (_prevStatus == _status) revert ErrorStakingModuleStatusNotChanged();
        _changeStakingModuleStatusByIndex(_stakingModuleIndex, _status);
        emit StakingModuleStatusChanged(_stakingModuleId, _prevStatus, _status, msg.sender);
    }

    function checkStakingModuleStatus(uint24 _stakingModuleId, StakingModuleStatus _status) public view returns (bool) {
        return _checkStakingModuleStatusByIndex(_getStakingModuleIndexById(_stakingModuleId), _status);
    }

    function _getStakingModuleStatusByIndex(uint256 _stakingModuleIndex) internal view returns (StakingModuleStatus) {
        return StakingModuleStatus(_stakingModules[_stakingModuleIndex].status);
    }

    function _changeStakingModuleStatusByIndex(uint256 _stakingModuleIndex, StakingModuleStatus _status) internal {
        _stakingModules[_stakingModuleIndex].status = uint8(_status);
    }

    function _checkStakingModuleStatusByIndex(uint256 _stakingModuleIndex, StakingModuleStatus _status) internal view returns (bool) {
        return _getStakingModuleStatusByIndex(_stakingModuleIndex) == _status;
    }

    /**
     * @notice pause deposits for module
     * @param _stakingModuleId id of the staking module to be paused
     */
    function pauseStakingModule(uint24 _stakingModuleId) external onlyRole(MODULE_PAUSE_ROLE) {
        uint _stakingModuleIndex = _getStakingModuleIndexById(_stakingModuleId);
        if (!_checkStakingModuleStatusByIndex(_stakingModuleIndex, StakingModuleStatus.Active)) revert ErrorStakingModuleIsPaused();

        _changeStakingModuleStatusByIndex(_stakingModuleIndex, StakingModuleStatus.DepositsPaused);
        emit StakingModuleStatusChanged(_stakingModuleId, StakingModuleStatus.Active, StakingModuleStatus.DepositsPaused, msg.sender);
    }

    /**
     * @notice resume deposits for module
     * @param _stakingModuleId id of the staking module to be unpaused
     */
    function resumeStakingModule(uint24 _stakingModuleId) external onlyRole(MODULE_RESUME_ROLE) {
        uint _stakingModuleIndex = _getStakingModuleIndexById(_stakingModuleId);
        if (!_checkStakingModuleStatusByIndex(_stakingModuleIndex, StakingModuleStatus.DepositsPaused))
            revert ErrorStakingModuleIsNotPaused();

        _changeStakingModuleStatusByIndex(_stakingModuleIndex, StakingModuleStatus.Active);
        emit StakingModuleStatusChanged(_stakingModuleId, StakingModuleStatus.DepositsPaused, StakingModuleStatus.Active, msg.sender);
    }

    function getStakingModuleIsStopped(uint24 _stakingModuleId) external view returns (bool) {
        return checkStakingModuleStatus(_stakingModuleId, StakingModuleStatus.Stopped);
    }

    function getStakingModuleIsDepositsPaused(uint24 _stakingModuleId) external view returns (bool) {
        return checkStakingModuleStatus(_stakingModuleId, StakingModuleStatus.DepositsPaused);
    }

    function getStakingModuleIsActive(uint24 _stakingModuleId) external view returns (bool) {
        return checkStakingModuleStatus(_stakingModuleId, StakingModuleStatus.Active);
    }

    function getStakingModuleKeysOpIndex(uint24 _stakingModuleId) external view returns (uint256) {
        return IStakingModule(_getStakingModuleAddressById(_stakingModuleId)).getKeysOpIndex();
    }

    function getStakingModuleLastDepositBlock(uint24 _stakingModuleId) external view returns (uint256) {
        StakingModule storage module = _getStakingModuleById(_stakingModuleId);
        return module.lastDepositBlock;
    }

    function getStakingModuleActiveKeysCount(
        uint24 _stakingModuleId
    ) external view onlyRegisteredStakingModule(_stakingModuleId) returns (uint256) {
        return IStakingModule(_getStakingModuleAddressById(_stakingModuleId)).getActiveKeysCount();
    }

    /**
     * @dev calculate max count of depositable module keys based on the total prospective number of deposits
     *
     * @param _stakingModuleId id of the staking module to be deposited
     * @param _totalDepositsCount total number of deposits to be made
     * @return max depositable keys count
     */
    function estimateStakingModuleMaxDepositableKeys(
        uint24 _stakingModuleId,
        uint256 _totalDepositsCount
    ) external view onlyRegisteredStakingModule(_stakingModuleId) returns (uint256) {
        return _estimateStakingModuleMaxDepositableKeysByIndex(_getStakingModuleIndexById(_stakingModuleId), _totalDepositsCount);
    }

    /**
     * @dev see {StakingRouter-estimateStakingModuleMaxDepositableKeys}
     *
     * @param _stakingModuleIndex module index
     * @param _totalDepositsCount total number of deposits to be made
     * @return max depositable keys count
     */
    function _estimateStakingModuleMaxDepositableKeysByIndex(
        uint256 _stakingModuleIndex,
        uint256 _totalDepositsCount
    ) internal view returns (uint256) {
        (, uint256[] memory newKeysAllocation, StakingModuleCache[] memory modulesCache) = _getKeysAllocation(_totalDepositsCount);
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
        returns (address[] memory recipients, uint16[] memory moduleFees, uint16 totalFee)
    {
        (uint256 totalActiveKeys, StakingModuleCache[] memory modulesCache) = _loadNotStoppedStakingModulesCache();
        uint256 modulesCount = modulesCache.length;

        /// @dev return empty response if there are no modules or active keys
        if (modulesCount == 0 || totalActiveKeys == 0) {
            return (new address[](0), new uint16[](0), 0);
        }

        recipients = new address[](modulesCount);
        moduleFees = new uint16[](modulesCount);

        uint256 rewardedModulesCount = 0;
        uint256 moduleKeysShare;
        for (uint256 i; i < modulesCount; ++i) {
            /// @dev skip modules which have no active keys
            if (modulesCache[i].activeKeysCount > 0) {
                moduleKeysShare = ((modulesCache[i].activeKeysCount * TOTAL_BASIS_POINTS) / totalActiveKeys);

                recipients[i] = address(modulesCache[i].stakingModuleAddress);
                moduleFees[i] = uint16((moduleKeysShare * modulesCache[i].moduleFee) / TOTAL_BASIS_POINTS);

                totalFee += uint16((moduleKeysShare * modulesCache[i].treasuryFee) / TOTAL_BASIS_POINTS) + moduleFees[i];
                unchecked {
                    rewardedModulesCount++;
                }
            }
        }
        // sanity check
        if (totalFee >= TOTAL_BASIS_POINTS) revert ErrorValueOver100Percent("totalFee");

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
    )
        external
        payable
        onlyRole(STAKING_ROUTER_DEPOSIT_ROLE)
        onlyRegisteredStakingModule(_stakingModuleId)
        onlyActiveStakingModule(_stakingModuleId)
        returns (uint256)
    {
        if (msg.value > 0) {
            emit StakingRouterETHReceived(msg.value);
        }

        bytes32 withdrawalCredentials = getWithdrawalCredentials();
        if (withdrawalCredentials == 0) revert ErrorEmptyWithdrawalsCredentials();

        uint256 stakingModuleIndex = _getStakingModuleIndexById(_stakingModuleId);
        uint256 maxDepositableKeys = _estimateStakingModuleMaxDepositableKeysByIndex(
            stakingModuleIndex,
            Math.min(address(this).balance / DEPOSIT_SIZE, _maxDepositsCount)
        );

        if (maxDepositableKeys == 0) return 0;

        (uint256 keysCount, bytes memory publicKeysBatch, bytes memory signaturesBatch) = IStakingModule(
            _getStakingModuleAddressByIndex(stakingModuleIndex)
        ).prepNextSigningKeys(maxDepositableKeys, _depositCalldata);

        if (keysCount == 0) return 0;

        _makeBeaconChainDeposits32ETH(keysCount, abi.encodePacked(withdrawalCredentials), publicKeysBatch, signaturesBatch);

        StakingModule storage stakingModule = _getStakingModuleByIndex(stakingModuleIndex);
        stakingModule.lastDepositAt = uint64(block.timestamp);
        stakingModule.lastDepositBlock = block.number;

        emit StakingRouterETHDeposited(_getStakingModuleIdByIndex(stakingModuleIndex), keysCount * DEPOSIT_SIZE);

        return keysCount;
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
        uint256 _modulesCount = getStakingModulesCount();
        for (uint256 i = 0; i < _modulesCount; ++i) {
            IStakingModule(_getStakingModuleAddressByIndex(i)).trimUnusedKeys();
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
    function _loadNotStoppedStakingModulesCache() internal view returns (uint totalActiveKeys, StakingModuleCache[] memory modulesCache) {
        uint256 modulesCount = _stakingModulesCount;
        modulesCache = new StakingModuleCache[](modulesCount);
        StakingModuleStatus status;
        for (uint256 i; i < modulesCount; ++i) {
            (status, modulesCache[i]) = _loadStakingModuleCache(i);

            /// @dev account only keys from not stopped modules (i.e. active and paused)
            if (status != StakingModuleStatus.Stopped) {
                (modulesCache[i].activeKeysCount, modulesCache[i].availableKeysCount) = IStakingModule(modulesCache[i].stakingModuleAddress)
                    .getKeysUsageData();
                totalActiveKeys += modulesCache[i].activeKeysCount;
            }
        }
    }

    /**
     * @dev load active modules list
     * @notice used for deposits allocation
     * @return totalActiveKeys for active modules
     * @return modulesCache array of StakingModuleCache struct
     */
    function _loadActiveStakingModulesCache() internal view returns (uint totalActiveKeys, StakingModuleCache[] memory modulesCache) {
        uint256 modulesCount = _stakingModulesCount;
        modulesCache = new StakingModuleCache[](modulesCount);
        StakingModuleStatus status;
        for (uint256 i; i < modulesCount; ++i) {
            (status, modulesCache[i]) = _loadStakingModuleCache(i);

            /// @dev account only keys from active modules
            if (status == StakingModuleStatus.Active) {
                (modulesCache[i].activeKeysCount, modulesCache[i].availableKeysCount) = IStakingModule(modulesCache[i].stakingModuleAddress)
                    .getKeysUsageData();
                totalActiveKeys += modulesCache[i].activeKeysCount;
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
        /// @dev new estimated active keys count
        totalActiveKeys += _keysToAllocate;
        if (modulesCount > 0 && totalActiveKeys > 0) {
            uint256[] memory capacities = new uint256[](modulesCount);
            uint256 targetKeys;

            for (uint256 i = 0; i < modulesCount; ++i) {
                allocations[i] = modulesCache[i].activeKeysCount;
                targetKeys = (modulesCache[i].targetShare * totalActiveKeys) / TOTAL_BASIS_POINTS;
                capacities[i] = Math.min(targetKeys, modulesCache[i].activeKeysCount + modulesCache[i].availableKeysCount);
            }

            allocated = MinFirstAllocationStrategy.allocate(allocations, capacities, _keysToAllocate);
        }
    }

    function _getStakingModuleAddressById(uint24 _stakingModuleId) private view returns (address) {
        return _getStakingModuleById(_stakingModuleId).stakingModuleAddress;
    }

    function _getStakingModuleAddressByIndex(uint256 _stakingModuleIndex) private view returns (address) {
        return _stakingModules[_stakingModuleIndex].stakingModuleAddress;
    }

    function _getStakingModuleIndexById(uint24 _stakingModuleId) private view returns (uint256) {
        return _stakingModuleIndicesOneBased[_stakingModuleId] - 1;
    }

    function _getStakingModuleIdByIndex(uint256 _index) private view returns (uint24) {
        return _stakingModules[_index].id;
    }

    function _getStakingModuleById(uint24 _stakingModuleId) private view returns (StakingModule storage) {
        return _stakingModules[_stakingModuleIndicesOneBased[_stakingModuleId] - 1];
    }

    function _getStakingModuleByIndex(uint256 _index) private view returns (StakingModule storage) {
        return _stakingModules[_index];
    }

    modifier onlyRegisteredStakingModule(uint24 _stakingModuleId) {
        require(_stakingModuleIndicesOneBased[_stakingModuleId] != 0, "UNREGISTERED_STAKING_MODULE");
        _;
    }

    modifier onlyActiveStakingModule(uint24 _stakingModuleId) {
        require(checkStakingModuleStatus(_stakingModuleId, StakingModuleStatus.Active), "STAKING_MODULE_NOT_ACTIVE");
        _;
    }

    function _setContractVersion(uint256 version) internal {
        CONTRACT_VERSION_POSITION.setStorageUint256(version);
        emit ContractVersionSet(version);
    }
}
