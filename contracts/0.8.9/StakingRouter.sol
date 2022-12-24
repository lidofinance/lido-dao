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
    event StakingModuleDeposit(uint64 lastDepositAt, uint256 lastDepositBlock);
    event DistributedShares(uint256 modulesShares, uint256 treasuryShares, uint256 remainShares);
    event DistributedDeposits(uint24 indexed stakingModuleId, uint256 assignedKeys, uint64 timestamp);
    event WithdrawalCredentialsSet(bytes32 withdrawalCredentials);
    event ContractVersionSet(uint256 version);
    /**
     * Emitted when the StakingRouter received ETH
     */
    event StakingRouterETHReceived(uint256 amount);

    struct StakingModule {
        /// @notice unique id of the module
        uint24 id;
        /// @notice name of module
        string name;
        /// @notice address of module
        address stakingModuleAddress;
        /// @notice rewarf fee of the module
        uint16 moduleFee;
        /// @notice treasury fee
        uint16 treasuryFee;
        /// @notice target percent of total keys in protocol, in BP
        uint16 targetShare;
        /// @notice module status if module can not accept the deposits or can participate in further reward distribution
        uint8 status;
        // /// @notice flag if module can not accept the deposits
        // bool paused;
        // /// @notice flag if module can participate in further reward distribution
        // bool active;
        /// @notice block.timestamp of the last deposit of the module
        uint64 lastDepositAt;
        /// @notice block.number of the last deposit of the module
        uint256 lastDepositBlock;
    }

    struct StakingModuleCache {
        uint8 status;
        uint16 targetShare;
        uint256 totalKeysCount;
        uint256 usedKeysCount;
        uint256 stoppedKeysCount;
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
        uint256 stakingModulesCount = getStakingModulesCount();
        res = new StakingModule[](stakingModulesCount);
        for (uint256 i = 0; i < stakingModulesCount; ++i) {
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
        uint _stakingModuleIndex = _getStakingModuleIndexById(_stakingModuleId);
        StakingModuleStatus _prevStatus = _getStakingModuleStatusByIndex(_stakingModuleIndex);
        if (_prevStatus == _status) revert ErrorStakingModuleStatusNotChanged();
        _setStakingModuleStatusByIndex(_stakingModuleIndex, _status);
        emit StakingModuleStatusChanged(_stakingModuleId, msg.sender, _prevStatus, _status);
    }

    function _getStakingModuleStatusByIndex(uint256 _stakingModuleIndex) internal view returns (StakingModuleStatus) {
        return StakingModuleStatus(_stakingModules[_stakingModuleIndex].status);
    }

    function _setStakingModuleStatusByIndex(uint256 _stakingModuleIndex, StakingModuleStatus _status) internal {
        _stakingModules[_stakingModuleIndex].status = uint8(_status);
    }

    /**
     * @notice pause deposits for module
     * @param _stakingModuleId id of the staking module to be paused
     */
    function pauseStakingModule(uint24 _stakingModuleId) external onlyRole(MODULE_PAUSE_ROLE) {
        uint _stakingModuleIndex = _getStakingModuleIndexById(_stakingModuleId);
        if (_getStakingModuleStatusByIndex(_stakingModuleIndex) != StakingModuleStatus.Active) revert ErrorStakingModuleIsPaused();

        _setStakingModuleStatusByIndex(_stakingModuleIndex, StakingModuleStatus.DepositsPaused);
        // emit StakingModulePaused(_stakingModuleId, msg.sender);
        emit StakingModuleStatusChanged(_stakingModuleId, msg.sender, StakingModuleStatus.Active, StakingModuleStatus.DepositsPaused);
    }

    /**
     * @notice unpause deposits for module
     * @param _stakingModuleId id of the staking module to be unpaused
     */
    function unpauseStakingModule(uint24 _stakingModuleId) external onlyRole(MODULE_RESUME_ROLE) {
        uint _stakingModuleIndex = _getStakingModuleIndexById(_stakingModuleId);
        if (_getStakingModuleStatusByIndex(_stakingModuleIndex) != StakingModuleStatus.DepositsPaused)
            revert ErrorStakingModuleIsNotPaused();

        _setStakingModuleStatusByIndex(_stakingModuleIndex, StakingModuleStatus.Active);
        // emit StakingModuleUnpaused(_stakingModuleId, msg.sender);
        emit StakingModuleStatusChanged(_stakingModuleId, msg.sender, StakingModuleStatus.DepositsPaused, StakingModuleStatus.Active);
    }

    function getStakingModuleIsStopped(uint24 _stakingModuleId) public view returns (bool) {
        return getStakingModuleStatus(_stakingModuleId) == StakingModuleStatus.Stopped;
    }

    function getStakingModuleIsDepositsPaused(uint24 _stakingModuleId) external view returns (bool) {
        return getStakingModuleStatus(_stakingModuleId) == StakingModuleStatus.DepositsPaused;
    }

    function getStakingModuleIsActive(uint24 _stakingModuleId) public view returns (bool) {
        return getStakingModuleStatus(_stakingModuleId) == StakingModuleStatus.Active;
    }

    function getStakingModuleKeysOpIndex(uint24 _stakingModuleId) external view returns (uint256) {
        return IStakingModule(_getStakingModuleAddressById(_stakingModuleId)).getKeysOpIndex();
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
        // calculate total used keys for operators
        uint256 modulesCount = getStakingModulesCount();
        moduleActiveKeys = new uint256[](modulesCount);
        for (uint256 i = 0; i < modulesCount; ++i) {
            /// @dev skip stopped modules
            if (_getStakingModuleStatusByIndex(i) != StakingModuleStatus.Stopped) {
                moduleActiveKeys[i] = _getActiveKeysCount(_getStakingModuleIdByIndex(i));
                totalActiveKeys += moduleActiveKeys[i];
            }
        }
    }

    function getTotalActiveKeysForDeposit() public view returns (uint256 totalActiveKeys, uint256[] memory moduleActiveKeys) {
        // calculate total used keys for operators
        uint256 modulesCount = getStakingModulesCount();
        moduleActiveKeys = new uint256[](modulesCount);
        for (uint256 i = 0; i < modulesCount; ++i) {
            /// @dev skip stopped modules
            if (_getStakingModuleStatusByIndex(i) != StakingModuleStatus.Stopped) {
                moduleActiveKeys[i] = _getActiveKeysCount(_getStakingModuleIdByIndex(i));
                totalActiveKeys += moduleActiveKeys[i];
            }
        }
    }

    function getActiveKeysCount(uint24 _stakingModuleId) public view onlyRegisteredStakingModule(_stakingModuleId) returns (uint256) {
        return _getActiveKeysCount(_stakingModuleId);
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
        (uint256 totalActiveKeys, uint256[] memory moduleActiveKeys) = getTotalActiveKeys();
        uint256 modulesCount = moduleActiveKeys.length;

        /// @dev return empty response if there are no modules or active keys
        if (modulesCount == 0 || totalActiveKeys == 0) {
            return (new address[](0), new uint16[](0), 0);
        }

        recipients = new address[](modulesCount);
        moduleFees = new uint16[](modulesCount);
        totalFee = 0;

        StakingModule memory stakingModule;
        uint256 rewardedModulesCount = 0;
        uint256 moduleKeysShare;
        for (uint256 i = 0; i < modulesCount; ++i) {
            stakingModule = _getStakingModuleByIndex(i);
            /// @dev stopped modules do not participate in distribution
            if (StakingModuleStatus(stakingModule.status) != StakingModuleStatus.Stopped) {
                moduleKeysShare = ((moduleActiveKeys[i] * TOTAL_BASIS_POINTS) / totalActiveKeys);

                recipients[i] = address(stakingModule.stakingModuleAddress);
                moduleFees[i] = uint16((moduleKeysShare * stakingModule.moduleFee) / TOTAL_BASIS_POINTS);

                totalFee += uint16((moduleKeysShare * stakingModule.treasuryFee) / TOTAL_BASIS_POINTS) + moduleFees[i];
                unchecked {
                    _rewardedModulesCount++;
                }
            }
        }

        // shrink array
        if (countBalanced < opIds.length) {
            uint256 trim = opIds.length - countBalanced;
            assembly {
                mstore(opsKeys, sub(mload(opsKeys), trim))
            }
        }

        return (recipients, moduleFees, totalFee);
    }

    /// @notice returns new deposits allocation after the distribution of the `_keysToAllocate` keys
    function getKeysAllocation(uint256 _keysToAllocate) public view returns (uint256 allocated, uint256[] memory allocations) {
        (uint256 totalActiveKeys, ) = getTotalActiveKeys();
        (allocated, allocations) = _getKeysAllocation(totalActiveKeys, _keysToAllocate);
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
        {
            _maxDepositsCount = Math.min(address(this).balance / DEPOSIT_SIZE, _maxDepositsCount);
            (uint256 totalActiveKeys, uint256[] memory stakingModulesActiveKeys) = getTotalActiveKeys();
            uint256 stakingModuleIndex = _getStakingModuleIndexById(_stakingModuleId);
            (, uint256[] memory newKeysAllocation) = _getKeysAllocation(totalActiveKeys, _maxDepositsCount);
            maxSigningKeysCount = newKeysAllocation[stakingModuleIndex] - stakingModulesActiveKeys[stakingModuleIndex];
        }

        if (maxSigningKeysCount == 0) revert ErrorZeroMaxSigningKeysCount();

        StakingModule storage stakingModule = _getStakingModuleById(_stakingModuleId);
        (uint256 keysCount, bytes memory publicKeysBatch, bytes memory signaturesBatch) = IStakingModule(stakingModule.stakingModuleAddress)
            .prepNextSigningKeys(maxSigningKeysCount, _depositCalldata);

        if (keysCount == 0) revert ErrorNoKeys();

        BatchedSigningKeys.validatePublicKeysBatch(publicKeysBatch, keysCount);
        BatchedSigningKeys.validateSignaturesBatch(signaturesBatch, keysCount);

        if (getWithdrawalCredentials() == 0) revert ErrorEmptyWithdrawalsCredentials();

        bytes memory encodedWithdrawalCredentials = abi.encodePacked(getWithdrawalCredentials());

        for (uint256 i = 0; i < keysCount; ++i) {
            bytes memory publicKey = BatchedSigningKeys.readPublicKey(publicKeysBatch, i);
            bytes memory signature = BatchedSigningKeys.readSignature(signaturesBatch, i);
            _makeBeaconChainDeposit(encodedWithdrawalCredentials, publicKey, signature, DEPOSIT_SIZE);
        }

        stakingModule.lastDepositAt = uint64(block.timestamp);
        stakingModule.lastDepositBlock = block.number;

        return keysCount;
    }

    /**
     * @notice Set credentials to withdraw ETH on ETH 2.0 side after the phase 2 is launched to `_withdrawalCredentials`
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
     * @notice Returns current credentials to withdraw ETH on ETH 2.0 side after the phase 2 is launched
     */
    function getWithdrawalCredentials() public view returns (bytes32) {
        return WITHDRAWAL_CREDENTIALS_POSITION.getStorageBytes32();
    }

    function _trimUnusedKeys() internal {
        uint256 stakingModulesCount = getStakingModulesCount();
        for (uint256 i = 0; i < stakingModulesCount; ++i) {
            IStakingModule(_getStakingModuleAddressByIndex(i)).trimUnusedKeys();
        }
    }

    function _loadStakingModuleCache(uint256 _stakingModuleIndex) internal view returns (StakingModuleCache memory stakingModuleCache) {
        StakingModule storage stakingModuleData = _getStakingModuleByIndex(_stakingModuleIndex);
        stakingModuleCache.status = stakingModuleData.status;
        stakingModuleCache.targetShare = stakingModuleData.targetShare;

        IStakingModule stakingModule = IStakingModule(stakingModuleData.stakingModuleAddress);
        (uint256 totalKeysCount, uint256 usedKeysCount, uint256 stoppedKeysCount) = stakingModule.getSigningKeysStats();
        stakingModuleCache.totalKeysCount = totalKeysCount;
        stakingModuleCache.usedKeysCount = usedKeysCount;
        stakingModuleCache.stoppedKeysCount = stoppedKeysCount;
        stakingModuleCache.activeKeysCount = stakingModuleCache.usedKeysCount - stakingModuleCache.stoppedKeysCount;
        stakingModuleCache.availableKeysCount = stakingModuleCache.totalKeysCount - stakingModuleCache.usedKeysCount;
    }

    function _getKeysAllocation(
        uint256 _activeKeysCount,
        uint256 _keysToAllocate
    ) public view returns (uint256 allocated, uint256[] memory allocations) {
        uint256 stakingModulesCount = getStakingModulesCount();
        allocations = new uint256[](stakingModulesCount);
        uint256[] memory capacities = new uint256[](stakingModulesCount);
        uint256 _totalActiveKeysCount = _activeKeysCount + _keysToAllocate;

        for (uint256 i = 0; i < stakingModulesCount; ++i) {
            StakingModuleCache memory stakingModuleCache = _loadStakingModuleCache(i);
            allocations[i] = stakingModuleCache.activeKeysCount;

            uint256 targetKeys = (stakingModuleCache.targetShare * _totalActiveKeysCount) / TOTAL_BASIS_POINTS;
            capacities[i] = Math.min(targetKeys, stakingModuleCache.activeKeysCount + stakingModuleCache.availableKeysCount);
        }

        allocated = MinFirstAllocationStrategy.allocate(allocations, capacities, _keysToAllocate);
    }

    function _getKeysAllocationForDeposit(
        uint256 _activeKeysCount,
        uint256 _keysToAllocate
    ) public view returns (uint256 allocated, uint256[] memory allocations) {
        uint256 stakingModulesCount = getStakingModulesCount();
        allocations = new uint256[](stakingModulesCount);
        uint256[] memory capacities = new uint256[](stakingModulesCount);
        uint256 _totalActiveKeysCount = _activeKeysCount + _keysToAllocate;

        for (uint256 i = 0; i < stakingModulesCount; ++i) {
            StakingModuleCache memory stakingModuleCache = _loadStakingModuleCache(i);
            allocations[i] = stakingModuleCache.activeKeysCount;

            uint256 targetKeys = (stakingModuleCache.targetShare * _totalActiveKeysCount) / TOTAL_BASIS_POINTS;
            capacities[i] = Math.min(targetKeys, stakingModuleCache.activeKeysCount + stakingModuleCache.availableKeysCount);
        }

        allocated = MinFirstAllocationStrategy.allocate(allocations, capacities, _keysToAllocate);
    }

    function _getActiveKeysCount(uint24 _stakingModuleIndex) internal view returns (uint256) {
        IStakingModule stakingModule = IStakingModule(_getStakingModuleAddressByIndex(_stakingModuleIndex));
        (, uint256 usedSigningKeys, uint256 stoppedSigningKeys) = stakingModule.getSigningKeysStats();
        return usedSigningKeys - stoppedSigningKeys;
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
        require(getStakingModuleIsActive(_stakingModuleId), "STAKING_MODULE_NOT_ACTIVE");
        _;
    }

    error ErrorZeroAddress(string field);
    error ErrorBaseVersion();
    error ErrorNoKeys();
    // error ErrorNoStakingModules();
    error ErrorZeroMaxSigningKeysCount();
    error ErrorValueOver100Percent(string field);
    error ErrorStakingModuleStatusNotChanged();
    error ErrorStakingModuleIsPaused();
    // error ErrorStakingModuleIsNotActive();
    error ErrorStakingModuleIsNotPaused();
    error UnregisteredStakingModule();
    error ErrorEmptyWithdrawalsCredentials();
}
