// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {AccessControlEnumerable} from "@openzeppelin/contracts-v4.4/access/AccessControlEnumerable.sol";

import {ILido} from "./interfaces/ILido.sol";
import {IStakingRouter} from "./interfaces/IStakingRouter.sol";
import {IStakingModule} from "./interfaces/IStakingModule.sol";
import {IDepositContract} from "./interfaces/IDepositContract.sol";

import {Math} from "./lib/Math.sol";
import {BatchedSigningKeys} from "./lib/BatchedSigningKeys.sol";
import {UnstructuredStorage} from "./lib/UnstructuredStorage.sol";
import {MinFirstAllocationStrategy} from "./lib/MinFirstAllocationStrategy.sol";

import {BeaconChainDepositor} from "./BeaconChainDepositor.sol";

contract StakingRouter is IStakingRouter, AccessControlEnumerable, BeaconChainDepositor {
    using UnstructuredStorage for bytes32;

    event StakingModuleAdded(address indexed creator, uint24 indexed stakingModuleId, address indexed stakingModule, string name);
    event StakingModuleTargetSharesSet(uint24 indexed stakingModuleId, uint16 targetShare);
    event StakingModuleFeesSet(uint24 indexed stakingModuleId, uint16 treasuryFee, uint16 moduleFee);
    event StakingModuleStatusChanged(
        uint24 indexed stakingModuleId,
        address indexed actor,
        StakingModuleStatus fromStatus,
        StakingModuleStatus toStatus
    );
    event WithdrawalCredentialsSet(bytes32 withdrawalCredentials);
    event ContractVersionSet(uint256 version);
    /**
     * Emitted when the StakingRouter received ETH
     */
    event StakingRouterETHReceived(uint256 amount);

    struct StakingModuleCache {
        address stakingModuleAddress;
        uint16 moduleFee;
        uint16 treasuryFee;
        uint16 targetShare;
        uint8 status;
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

    uint256 public constant DEPOSIT_SIZE = 32 ether;

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

    constructor(address _depositContract) BeaconChainDepositor(_depositContract) {}

    function initialize(address _admin, bytes32 _withdrawalCredentials) external {
        if (_admin == address(0)) revert ErrorZeroAddress("_admin");
        if (CONTRACT_VERSION_POSITION.getStorageUint256() != 0) revert ErrorBaseVersion();

        _setupRole(DEFAULT_ADMIN_ROLE, _admin);

        CONTRACT_VERSION_POSITION.setStorageUint256(1);
        WITHDRAWAL_CREDENTIALS_POSITION.setStorageBytes32(_withdrawalCredentials);

        emit ContractVersionSet(1);
        emit WithdrawalCredentialsSet(_withdrawalCredentials);
    }

    receive() external payable {
        emit StakingRouterETHReceived(msg.value);
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
        string memory _name,
        address _stakingModuleAddress,
        uint16 _targetShare,
        uint16 _moduleFee,
        uint16 _treasuryFee
    ) external onlyRole(MODULE_MANAGE_ROLE) {
        if (_targetShare > TOTAL_BASIS_POINTS) revert ErrorValueOver100Percent("_targetShare");
        if (_treasuryFee > TOTAL_BASIS_POINTS) revert ErrorValueOver100Percent("_treasuryFee");
        if (_moduleFee > TOTAL_BASIS_POINTS) revert ErrorValueOver100Percent("_moduleFee");

        uint24 newStakingModuleId = _lastStakingModuleId + 1;
        uint256 newStakingModuleIndex = _stakingModulesCount;
        StakingModule storage newStakingModule = _stakingModules[newStakingModuleIndex];

        newStakingModule.id = newStakingModuleId;
        newStakingModule.name = _name;
        newStakingModule.stakingModuleAddress = _stakingModuleAddress;
        newStakingModule.targetShare = _targetShare;
        newStakingModule.treasuryFee = _treasuryFee;
        newStakingModule.moduleFee = _moduleFee;
        newStakingModule.status = uint8(StakingModuleStatus.Active);

        _stakingModuleIndicesOneBased[newStakingModuleId] = newStakingModuleIndex + 1;

        _lastStakingModuleId = newStakingModuleId;
        _stakingModulesCount = newStakingModuleIndex + 1;

        emit StakingModuleAdded(msg.sender, newStakingModuleId, _stakingModuleAddress, _name);
        emit StakingModuleTargetSharesSet(newStakingModuleId, _targetShare);
        emit StakingModuleFeesSet(newStakingModuleId, _treasuryFee, _moduleFee);
    }

    function updateStakingModule(
        uint24 _stakingModuleId,
        uint16 _targetShare,
        uint16 _moduleFee,
        uint16 _treasuryFee
    ) external onlyRole(MODULE_MANAGE_ROLE) {
        if (_targetShare > TOTAL_BASIS_POINTS) revert ErrorValueOver100Percent("_targetShare");
        if (_treasuryFee > TOTAL_BASIS_POINTS) revert ErrorValueOver100Percent("_treasuryFee");
        if (_moduleFee > TOTAL_BASIS_POINTS) revert ErrorValueOver100Percent("_moduleFee");

        uint256 stakingModuleIndex = _getStakingModuleIndexById(_stakingModuleId);

        _stakingModules[stakingModuleIndex].targetShare = _targetShare;
        _stakingModules[stakingModuleIndex].treasuryFee = _treasuryFee;
        _stakingModules[stakingModuleIndex].moduleFee = _moduleFee;

        emit StakingModuleTargetSharesSet(_stakingModuleId, _targetShare);
        emit StakingModuleFeesSet(_stakingModuleId, _treasuryFee, _moduleFee);
    }

    function getStakingModules() external view returns (StakingModule[] memory res) {
        uint256 _modulesCount = getStakingModulesCount();
        res = new StakingModule[](_modulesCount);
        for (uint256 i = 0; i < _modulesCount; ++i) {
            res[i] = _getStakingModuleByIndex(i);
        }
    }

    function getStakingModule(uint24 _stakingModuleId) external view returns (StakingModule memory) {
        return _getStakingModuleById(_stakingModuleId);
    }

    /**
     * @notice Returns total number of node operators
     */
    function getStakingModulesCount() public view returns (uint256) {
        return _stakingModulesCount;
    }

    function getStakingModuleStatus(uint24 _stakingModuleId) public view returns (StakingModuleStatus) {
        return _getStakingModuleStatusByIndex(_getStakingModuleIndexById(_stakingModuleId));
    }

    /**
     * @notice set the module status flag for participation in further deposits and/or reward distribution
     */
    function setStakingModuleStatus(uint24 _stakingModuleId, StakingModuleStatus _status) external onlyRole(MODULE_MANAGE_ROLE) {
        uint256 _stakingModuleIndex = _getStakingModuleIndexById(_stakingModuleId);
        StakingModuleStatus _prevStatus = _getStakingModuleStatusByIndex(_stakingModuleIndex);
        if (_prevStatus == _status) revert ErrorStakingModuleStatusNotChanged();
        _setStakingModuleStatusByIndex(_stakingModuleIndex, _status);
        emit StakingModuleStatusChanged(_stakingModuleId, msg.sender, _prevStatus, _status);
    }

    function checkStakingModuleStatus(uint24 _stakingModuleId, StakingModuleStatus _status) public view returns (bool) {
        return _checkStakingModuleStatusByIndex(_getStakingModuleIndexById(_stakingModuleId), _status);
    }

    function _getStakingModuleStatusByIndex(uint256 _stakingModuleIndex) internal view returns (StakingModuleStatus) {
        return StakingModuleStatus(_stakingModules[_stakingModuleIndex].status);
    }

    function _setStakingModuleStatusByIndex(uint256 _stakingModuleIndex, StakingModuleStatus _status) internal {
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
        uint256 _stakingModuleIndex = _getStakingModuleIndexById(_stakingModuleId);
        if (!_checkStakingModuleStatusByIndex(_stakingModuleIndex, StakingModuleStatus.Active)) revert ErrorStakingModuleIsPaused();

        _setStakingModuleStatusByIndex(_stakingModuleIndex, StakingModuleStatus.DepositsPaused);
        // emit StakingModulePaused(_stakingModuleId, msg.sender);
        emit StakingModuleStatusChanged(_stakingModuleId, msg.sender, StakingModuleStatus.Active, StakingModuleStatus.DepositsPaused);
    }

    /**
     * @notice unpause deposits for module
     * @param _stakingModuleId id of the staking module to be unpaused
     */
    function unpauseStakingModule(uint24 _stakingModuleId) external onlyRole(MODULE_RESUME_ROLE) {
        uint256 _stakingModuleIndex = _getStakingModuleIndexById(_stakingModuleId);
        if (!_checkStakingModuleStatusByIndex(_stakingModuleIndex, StakingModuleStatus.DepositsPaused))
            revert ErrorStakingModuleIsNotPaused();

        _setStakingModuleStatusByIndex(_stakingModuleIndex, StakingModuleStatus.Active);
        // emit StakingModuleUnpaused(_stakingModuleId, msg.sender);
        emit StakingModuleStatusChanged(_stakingModuleId, msg.sender, StakingModuleStatus.DepositsPaused, StakingModuleStatus.Active);
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
        return IStakingModule(_getStakingModuleAddressById(_stakingModuleId)).getValidatorsKeysNonce();
    }

    function getStakingModuleLastDepositBlock(uint24 _stakingModuleId) external view returns (uint256) {
        StakingModule storage module = _getStakingModuleById(_stakingModuleId);
        return module.lastDepositBlock;
    }

    /**
     * @notice get total keys which can used for rewards and center distribution
     *         active keys = used keys - stopped keys
     *
     * @return totalActiveKeys total keys which used for calculation
     * @return moduleActiveKeys array of amount module keys
     */
    function getTotalActiveKeys() public view returns (uint256 totalActiveKeys, uint256[] memory moduleActiveKeys) {
        StakingModuleCache[] memory _modulesCache;

        (totalActiveKeys, _modulesCache) = _loadAllStakingModulesCache(false);
        uint256 _modulesCount = _modulesCache.length;
        if (_modulesCount == 0 || totalActiveKeys == 0) {
            return (0, new uint256[](0));
        }
        // calculate total active keys for operators
        moduleActiveKeys = new uint256[](_modulesCount);
        for (uint256 i = 0; i < _modulesCount; ++i) {
            moduleActiveKeys[i] = _modulesCache[i].activeKeysCount;
        }
    }

    function getModuleActiveKeysCount(uint24 _stakingModuleId)
        external
        view
        onlyRegisteredStakingModule(_stakingModuleId)
        returns (uint256)
    {
        (uint64 exitedValidatorsCount, uint64 depositedValidatorsCount, , ) = IStakingModule(_getStakingModuleAddressById(_stakingModuleId))
            .getValidatorsStats();
        return depositedValidatorsCount - exitedValidatorsCount;
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
        returns (
            address[] memory recipients,
            uint16[] memory moduleFees,
            uint16 totalFee
        )
    {
        (uint256 _totalActiveKeys, StakingModuleCache[] memory _modulesCache) = _loadAllStakingModulesCache(true);
        uint256 _modulesCount = _modulesCache.length;

        /// @dev return empty response if there are no modules or active keys
        if (_modulesCount == 0 || _totalActiveKeys == 0) {
            return (new address[](0), new uint16[](0), 0);
        }

        recipients = new address[](_modulesCount);
        moduleFees = new uint16[](_modulesCount);
        totalFee = 0;

        uint256 rewardedModulesCount = 0;
        uint256 moduleKeysShare;
        for (uint256 i = 0; i < _modulesCount; ++i) {
            /// @dev skip modules which have no active keys
            if (_modulesCache[i].activeKeysCount > 0) {
                moduleKeysShare = ((_modulesCache[i].activeKeysCount * TOTAL_BASIS_POINTS) / _totalActiveKeys);

                recipients[i] = address(_modulesCache[i].stakingModuleAddress);
                moduleFees[i] = uint16((moduleKeysShare * _modulesCache[i].moduleFee) / TOTAL_BASIS_POINTS);

                totalFee += uint16((moduleKeysShare * _modulesCache[i].treasuryFee) / TOTAL_BASIS_POINTS) + moduleFees[i];
                unchecked {
                    rewardedModulesCount++;
                }
            }
        }

        /// @dev shrink arrays
        if (rewardedModulesCount < _modulesCount) {
            uint256 trim = _modulesCount - rewardedModulesCount;
            assembly {
                mstore(recipients, sub(mload(recipients), trim))
                mstore(moduleFees, sub(mload(moduleFees), trim))
            }
        }
    }

    /// @notice returns new deposits allocation after the distribution of the `_keysToAllocate` keys
    function getKeysAllocation(uint256 _keysToAllocate) public view returns (uint256 allocated, uint256[] memory allocations) {
        (allocated, allocations, ) = _getKeysAllocation(_keysToAllocate, false);
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
        onlyRole(STAKING_ROUTER_DEPOSIT_ROLE)
        onlyRegisteredStakingModule(_stakingModuleId)
        onlyActiveStakingModule(_stakingModuleId)
        returns (uint256)
    {
        /// @todo make more optimal calc of totalActiveKeysCount (eliminate double calls of module.getTotalUsedKeys() and
        ///       module.getTotalStoppedKeys() inside getTotalActiveKeys() and _loadStakingModuleCache() methods)

        uint256 maxSigningKeysCount;
        uint256 stakingModuleIndex;
        StakingModuleCache[] memory _modulesCache;
        {
            uint256[] memory newKeysAllocation;
            _maxDepositsCount = Math.min(address(this).balance / DEPOSIT_SIZE, _maxDepositsCount);
            (, newKeysAllocation, _modulesCache) = _getKeysAllocation(_maxDepositsCount, false);

            stakingModuleIndex = _getStakingModuleIndexById(_stakingModuleId);
            maxSigningKeysCount = newKeysAllocation[stakingModuleIndex] - _modulesCache[stakingModuleIndex].activeKeysCount;
        }

        if (maxSigningKeysCount == 0) return 0;

        (uint256 keysCount, bytes memory publicKeysBatch, bytes memory signaturesBatch) = IStakingModule(
            _modulesCache[stakingModuleIndex].stakingModuleAddress
        ).enqueueApprovedValidatorsKeys(uint64(maxSigningKeysCount), _depositCalldata);

        if (keysCount == 0) return 0;

        BatchedSigningKeys.validatePublicKeysBatch(publicKeysBatch, keysCount);
        BatchedSigningKeys.validateSignaturesBatch(signaturesBatch, keysCount);

        if (getWithdrawalCredentials() == 0) revert ErrorEmptyWithdrawalsCredentials();

        bytes memory encodedWithdrawalCredentials = abi.encodePacked(getWithdrawalCredentials());

        for (uint256 i = 0; i < keysCount; ++i) {
            bytes memory publicKey = BatchedSigningKeys.readPublicKey(publicKeysBatch, i);
            bytes memory signature = BatchedSigningKeys.readSignature(signaturesBatch, i);
            _makeBeaconChainDeposit(encodedWithdrawalCredentials, publicKey, signature, DEPOSIT_SIZE);
        }

        StakingModule storage stakingModule = _getStakingModuleByIndex(stakingModuleIndex);
        stakingModule.lastDepositAt = uint64(block.timestamp);
        stakingModule.lastDepositBlock = block.number;

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
            IStakingModule(_getStakingModuleAddressByIndex(i)).trimUnusedValidatorsKeys();
        }
    }

    function _loadStakingModuleCache(uint256 _stakingModuleIndex) internal view returns (StakingModuleCache memory stakingModuleCache) {
        StakingModule memory stakingModuleData = _getStakingModuleByIndex(_stakingModuleIndex);
        stakingModuleCache.stakingModuleAddress = stakingModuleData.stakingModuleAddress;
        stakingModuleCache.moduleFee = stakingModuleData.moduleFee;
        stakingModuleCache.treasuryFee = stakingModuleData.treasuryFee;
        stakingModuleCache.targetShare = stakingModuleData.targetShare;
        stakingModuleCache.status = stakingModuleData.status;

        IStakingModule stakingModule = IStakingModule(stakingModuleData.stakingModuleAddress);
        (uint64 exitedKeysCount, uint64 depositedKeysCount, uint64 approvedValidatorsKeysCount, ) = stakingModule.getValidatorsStats();
        stakingModuleCache.activeKeysCount = depositedKeysCount - exitedKeysCount;
        stakingModuleCache.availableKeysCount = approvedValidatorsKeysCount - depositedKeysCount;
    }

    /**
     * @notice get all active and avail keys which can be used for rewards and center distribution
     *         active keys = used keys - stopped keys
     *
     * @return totalActiveKeys
     * @return modulesCache array of StakingModulesKeysCache struct
     */
    function _loadAllStakingModulesCache(bool _isRewardDistribution)
        internal
        view
        returns (uint256 totalActiveKeys, StakingModuleCache[] memory modulesCache)
    {
        uint256 _modulesCount = getStakingModulesCount();
        StakingModuleStatus _status;
        modulesCache = new StakingModuleCache[](_modulesCount);
        for (uint256 i = 0; i < _modulesCount; ++i) {
            modulesCache[i] = _loadStakingModuleCache(i);
            _status = StakingModuleStatus(modulesCache[i].status);

            /// @dev in general case, the distribution of active keys per modules
            ///      is different for `deposit` and for `rewardDistribution` calls
            ///      `_isRewardDistribution=true`: skip only stopped modules
            ///      `_isRewardDistribution=false`: assuming it 'deposit' call, i.e. only active modules can deposit (skip paused and stoped)
            if (_isRewardDistribution ? _status != StakingModuleStatus.Stopped : _status == StakingModuleStatus.Active) {
                totalActiveKeys += modulesCache[i].activeKeysCount;
            } else {
                modulesCache[i].activeKeysCount = 0;
                modulesCache[i].availableKeysCount = 0;
            }
        }
    }

    function _getKeysAllocation(uint256 _keysToAllocate, bool _isRewardDistribution)
        internal
        view
        returns (
            uint256 allocated,
            uint256[] memory allocations,
            StakingModuleCache[] memory _modulesCache
        )
    {
        // calculate total used keys for operators
        uint256 _totalActiveKeys;
        (_totalActiveKeys, _modulesCache) = _loadAllStakingModulesCache(_isRewardDistribution);

        uint256 _modulesCount = _modulesCache.length;
        allocations = new uint256[](_modulesCount);
        /// @dev new estimated active keys count
        _totalActiveKeys += _keysToAllocate;
        if (_modulesCount > 0 && _totalActiveKeys > 0) {
            uint256[] memory capacities = new uint256[](_modulesCount);
            uint256 targetKeys;

            for (uint256 i = 0; i < _modulesCount; ++i) {
                allocations[i] = _modulesCache[i].activeKeysCount;
                targetKeys = (_modulesCache[i].targetShare * _totalActiveKeys) / TOTAL_BASIS_POINTS;
                capacities[i] = Math.min(targetKeys, _modulesCache[i].activeKeysCount + _modulesCache[i].availableKeysCount);
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

    error ErrorZeroAddress(string field);
    error ErrorBaseVersion();
    error ErrorValueOver100Percent(string field);
    error ErrorStakingModuleStatusNotChanged();
    error ErrorStakingModuleIsPaused();
    error ErrorStakingModuleIsNotPaused();
    error ErrorEmptyWithdrawalsCredentials();
}
