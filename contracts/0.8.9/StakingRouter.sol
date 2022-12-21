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
import {DepositsAllocatorStrategyMinActiveKeysFirst} from "./lib/DepositsAllocatorStrategyMinActiveKeysFirst.sol";

import {BeaconChainDepositor} from "./BeaconChainDepositor.sol";

contract StakingRouter is IStakingRouter, AccessControlEnumerable, BeaconChainDepositor {
    using UnstructuredStorage for bytes32;

    event StakingModuleAdded(
        address indexed creator,
        uint256 indexed stakingModuleId,
        address indexed stakingModule,
        string name
    );
    event StakingModuleTargetSharesSet(uint24 indexed stakingModuleId, uint16 targetShare);
    event StakingModuleFeesSet(uint24 indexed stakingModuleId, uint16 treasuryFee, uint16 moduleFee);
    event StakingModulePaused(uint24 indexed stakingModuleId, address indexed actor);
    event StakingModuleUnpaused(uint24 indexed stakingModuleId, address indexed actor);
    event StakingModuleActiveStatusChanged(uint24 indexed stakingModuleId, bool isActive, address indexed actor);
    event StakingModuleDeposit(uint64 lastDepositAt, uint256 lastDepositBlock);
    event DistributedShares(uint256 modulesShares, uint256 treasuryShares, uint256 remainShares);
    event DistributedDeposits(uint24 indexed stakingModuleId, uint256 assignedKeys, uint64 timestamp);
    event WithdrawalCredentialsSet(bytes32 withdrawalCredentials);
    event ContractVersionSet(uint256 version);
    /**
     * Emitted when the vault received ETH
     */
    event ETHReceived(uint256 amount);

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
        /// @notice flag if module can not accept the deposits
        bool paused;
        /// @notice flag if module can participate in further reward distribution
        bool active;
        /// @notice block.timestamp of the last deposit of the module
        uint64 lastDepositAt;
        /// @notice block.number of the last deposit of the module
        uint256 lastDepositBlock;
    }

    struct StakingModuleCache {
        bool paused;
        uint16 targetShare;
        uint256 totalKeysCount;
        uint256 usedKeysCount;
        uint256 stoppedKeysCount;
        uint256 activeKeysCount;
        uint256 availableKeysCount;
    }

    ILido public immutable LIDO;

    bytes32 public constant MANAGE_WITHDRAWAL_KEY_ROLE = keccak256("MANAGE_WITHDRAWAL_KEY_ROLE");
    bytes32 public constant MODULE_PAUSE_ROLE = keccak256("MODULE_PAUSE_ROLE");
    bytes32 public constant MODULE_CONTROL_ROLE = keccak256("MODULE_CONTROL_ROLE");
    bytes32 public constant DEPOSIT_ROLE = keccak256("DEPOSIT_ROLE");

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

    uint256 internal constant TOTAL_BASIS_POINTS = 10000;

    /// @dev total count of staking modules
    uint256 private _stakingModulesCount;

    /// @dev id of the last added staking module. This counter grow on staking modules adding
    uint24 private _lastStakingModuleId;

    /// @dev mapping is used instead of array to allow to extend the StakingModule
    mapping(uint256 => StakingModule) private _stakingModules;

    /// @dev Position of the staking modules in the `_stakingModules` map, plus 1 because
    ///      index 0 means a value is not in the set.
    mapping(uint24 => uint256) private _stakingModuleIndicesOneBased;

    constructor(address _depositContract, address _lido) BeaconChainDepositor(_depositContract) {
        if (_lido == address(0)) revert ErrorZeroAddress("_lido");
        LIDO = ILido(_lido);
    }

    function initialize(address _admin) external {
        if (_admin == address(0)) revert ErrorZeroAddress("_admin");
        if (CONTRACT_VERSION_POSITION.getStorageUint256() != 0) revert ErrorBaseVersion();

        _setupRole(DEFAULT_ADMIN_ROLE, _admin);

        CONTRACT_VERSION_POSITION.setStorageUint256(1);
        emit ContractVersionSet(1);
    }

    receive() external payable {
        emit ETHReceived(msg.value);
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
    ) external onlyRole(MODULE_CONTROL_ROLE) {
        if (_targetShare > TOTAL_BASIS_POINTS) revert ErrorValueOver100Percent("_targetShare");
        if (_treasuryFee > TOTAL_BASIS_POINTS) revert ErrorValueOver100Percent("_treasuryFee");
        if (_moduleFee > TOTAL_BASIS_POINTS) revert ErrorValueOver100Percent("_moduleFee");

        uint24 stakingModuleId = _lastStakingModuleId++;
        _stakingModules[_stakingModulesCount] = StakingModule({
            id: stakingModuleId,
            name: _name,
            stakingModuleAddress: _stakingModuleAddress,
            targetShare: _targetShare,
            treasuryFee: _treasuryFee,
            moduleFee: _moduleFee,
            paused: false,
            active: true,
            lastDepositAt: 0,
            lastDepositBlock: 0
        });

        _stakingModuleIndicesOneBased[_lastStakingModuleId] = ++_stakingModulesCount;

        emit StakingModuleAdded(msg.sender, stakingModuleId, _stakingModuleAddress, _name);
        emit StakingModuleTargetSharesSet(stakingModuleId, _targetShare);
        emit StakingModuleFeesSet(stakingModuleId, _treasuryFee, _moduleFee);
    }

    function updateStakingModule(
        uint24 _stakingModuleId,
        uint16 _targetShare,
        uint16 _moduleFee,
        uint16 _treasuryFee
    ) external onlyRole(MODULE_CONTROL_ROLE) {
        if (_targetShare > TOTAL_BASIS_POINTS) revert ErrorValueOver100Percent("_targetShare");
        if (_treasuryFee > TOTAL_BASIS_POINTS) revert ErrorValueOver100Percent("_treasuryFee");
        if (_moduleFee > TOTAL_BASIS_POINTS) revert ErrorValueOver100Percent("_moduleFee");

        uint256 stakingModuleIndex = _stakingModuleIndicesOneBased[_lastStakingModuleId];

        _stakingModules[stakingModuleIndex].targetShare = _targetShare;
        _stakingModules[stakingModuleIndex].treasuryFee = _treasuryFee;
        _stakingModules[stakingModuleIndex].moduleFee = _moduleFee;

        emit StakingModuleTargetSharesSet(_stakingModuleId, _targetShare);
        emit StakingModuleFeesSet(_stakingModuleId, _treasuryFee, _moduleFee);
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

    /**
     * @notice pause deposits for module
     * @param _stakingModuleId id of the staking module to be paused
     */
    function pauseStakingModule(uint24 _stakingModuleId) external onlyRole(MODULE_PAUSE_ROLE) {
        StakingModule storage module = _getStakingModuleById(_stakingModuleId);
        if (module.paused) revert ErrorStakingModuleIsPaused();

        module.paused = true;

        emit StakingModulePaused(_stakingModuleId, msg.sender);
    }

    /**
     * @notice unpause deposits for module
     * @param _stakingModuleId id of the staking module to be unpaused
     */
    function unpauseStakingModule(uint24 _stakingModuleId) external onlyRole(MODULE_CONTROL_ROLE) {
        StakingModule storage module = _getStakingModuleById(_stakingModuleId);
        if (!module.paused) revert ErrorStakingModuleIsNotPaused();

        module.paused = false;

        emit StakingModuleUnpaused(_stakingModuleId, msg.sender);
    }

    /**
     * @notice set the module activity flag for participation in further reward distribution
     */
    function setStakingModuleActive(uint24 _stakingModuleId, bool _active) external onlyRole(MODULE_CONTROL_ROLE) {
        StakingModule storage module = _getStakingModuleById(_stakingModuleId);
        module.active = _active;

        emit StakingModuleActiveStatusChanged(_stakingModuleId, _active, msg.sender);
    }

    function getStakingModuleIsPaused(uint24 _stakingModuleId) external view returns (bool) {
        StakingModule storage module = _getStakingModuleById(_stakingModuleId);
        return module.paused;
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
        uint256 _modulesCount = getStakingModulesCount();
        moduleActiveKeys = new uint256[](_modulesCount);
        for (uint256 i = 0; i < _modulesCount; ++i) {
            moduleActiveKeys[i] = _getActiveKeysCount(_getStakingModuleIdByIndex(i));
            totalActiveKeys += moduleActiveKeys[i];
        }
    }

    function getActiveKeysCount(uint24 _stakingModuleId)
        public
        view
        onlyRegisteredStakingModule(_stakingModuleId)
        returns (uint256)
    {
        return _getActiveKeysCount(_stakingModuleId);
    }

    /**
     * @notice return shares table
     *
     * @return recipients recipients list
     * @return moduleShares shares of each recipient
     * @return totalShare total share to mint for each module and treasury
     */
    function getSharesTable()
        external
        view
        returns (
            address[] memory recipients,
            uint256[] memory moduleShares,
            uint256 totalShare
        )
    {
        uint256 _modulesCount = getStakingModulesCount();
        if (_modulesCount == 0) revert ErrorNoStakingModules();

        // +1 for treasury
        recipients = new address[](_modulesCount);
        moduleShares = new uint256[](_modulesCount);

        totalShare = 0;

        (uint256 totalActiveKeys, uint256[] memory moduleActiveKeys) = getTotalActiveKeys();

        if (totalActiveKeys == 0) revert ErrorNoKeys();

        StakingModule memory stakingModule;
        uint256 moduleShare;
        for (uint256 i = 0; i < _modulesCount; ++i) {
            stakingModule = _getStakingModuleByIndex(i);
            moduleShare = ((moduleActiveKeys[i] * TOTAL_BASIS_POINTS) / totalActiveKeys);

            recipients[i] = address(stakingModule.stakingModuleAddress);
            moduleShares[i] = ((moduleShare * stakingModule.moduleFee) / TOTAL_BASIS_POINTS);

            totalShare += (moduleShare * stakingModule.treasuryFee) / TOTAL_BASIS_POINTS + moduleShares[i];
        }

        return (recipients, moduleShares, totalShare);
    }

    function getAllocatedDepositsDistribution(uint256 _totalActiveKeys)
        public
        view
        returns (uint256[] memory, uint256)
    {
        uint256 stakingModulesCount = getStakingModulesCount();
        DepositsAllocatorStrategyMinActiveKeysFirst.AllocationCandidate[]
            memory candidates = new DepositsAllocatorStrategyMinActiveKeysFirst.AllocationCandidate[](
                stakingModulesCount
            );

        for (uint256 i = 0; i < candidates.length; ++i) {
            StakingModuleCache memory stakingModuleCache = _loadStakingModuleCache(_getStakingModuleIdByIndex(i));
            if (stakingModuleCache.paused) {
                continue;
            }
            candidates[i].activeKeysCount = stakingModuleCache.activeKeysCount;
            uint256 targetKeys = (stakingModuleCache.targetShare * _totalActiveKeys) / TOTAL_BASIS_POINTS;
            if (targetKeys <= candidates[i].activeKeysCount) {
                continue;
            }
            candidates[i].availableKeysCount = targetKeys > stakingModuleCache.availableKeysCount
                ? stakingModuleCache.availableKeysCount - candidates[i].activeKeysCount
                : targetKeys - candidates[i].activeKeysCount;
        }
        return DepositsAllocatorStrategyMinActiveKeysFirst.allocate(candidates, _totalActiveKeys);
    }

    function getAllocatedDepositsCount(uint24 _stakingModuleId, uint256 _totalActiveKeys)
        public
        view
        onlyRegisteredStakingModule(_stakingModuleId)
        returns (uint256)
    {
        (uint256[] memory keysDistribution, ) = getAllocatedDepositsDistribution(_totalActiveKeys);
        uint256 stakingModuleIndex = _getStakingModuleIndexById(_stakingModuleId);
        return keysDistribution[stakingModuleIndex];
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
        onlyRole(DEPOSIT_ROLE)
        onlyRegisteredStakingModule(_stakingModuleId)
        onlyNotPausedStakingModule(_stakingModuleId)
    {
        /// @todo make more optimal calc of totalActiveKeysCount (eliminate double calls of module.getTotalUsedKeys() and
        ///       module.getTotalStoppedKeys() inside getTotalActiveKeys() and _loadStakingModuleCache() methods)
        (uint256 totalActiveKeys, ) = getTotalActiveKeys();

        uint256 maxSigningKeysCount = getAllocatedDepositsCount(_stakingModuleId, totalActiveKeys + _maxDepositsCount);

        if (maxSigningKeysCount == 0) revert ErrorZerroMaxSigningKeysCount();

        StakingModule storage stakingModule = _getStakingModuleById(_stakingModuleId);
        (uint256 keysCount, bytes memory publicKeysBatch, bytes memory signaturesBatch) = IStakingModule(
            stakingModule.stakingModuleAddress
        ).prepNextSigningKeys(maxSigningKeysCount, _depositCalldata);

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

        LIDO.updateBufferedCounters(keysCount);

        stakingModule.lastDepositAt = uint64(block.timestamp);
        stakingModule.lastDepositBlock = block.number;
    }

    /**
     * @notice Set credentials to withdraw ETH on ETH 2.0 side after the phase 2 is launched to `_withdrawalCredentials`
     * @dev Note that setWithdrawalCredentials discards all unused signing keys as the signatures are invalidated.
     * @param _withdrawalCredentials withdrawal credentials field as defined in the Ethereum PoS consensus specs
     */
    function setWithdrawalCredentials(bytes32 _withdrawalCredentials) external onlyRole(MANAGE_WITHDRAWAL_KEY_ROLE) {
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

    function _loadStakingModuleCache(uint24 _stakingModuleId)
        internal
        view
        returns (StakingModuleCache memory stakingModuleCache)
    {
        StakingModule storage stakingModuleData = _getStakingModuleById(_stakingModuleId);
        stakingModuleCache.paused = stakingModuleData.paused;
        stakingModuleCache.targetShare = stakingModuleData.targetShare;

        IStakingModule stakingModule = IStakingModule(stakingModuleData.stakingModuleAddress);
        stakingModuleCache.totalKeysCount = stakingModule.getTotalKeys();
        stakingModuleCache.usedKeysCount = stakingModule.getTotalUsedKeys();
        stakingModuleCache.stoppedKeysCount = stakingModule.getTotalStoppedKeys();
        stakingModuleCache.activeKeysCount = stakingModuleCache.usedKeysCount - stakingModuleCache.stoppedKeysCount;
        stakingModuleCache.availableKeysCount = stakingModuleCache.totalKeysCount - stakingModuleCache.usedKeysCount;
    }

    function _getActiveKeysCount(uint24 _stakingModuleId) internal view returns (uint256) {
        IStakingModule stakingModule = IStakingModule(_getStakingModuleAddressById(_stakingModuleId));
        return stakingModule.getTotalUsedKeys() - stakingModule.getTotalStoppedKeys();
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

    modifier onlyNotPausedStakingModule(uint24 _stakingModuleId) {
        StakingModule storage stakingModule = _getStakingModuleById(_stakingModuleId);
        require(!stakingModule.paused, "STAKING_MODULE_PAUSED");
        _;
    }

    error ErrorZeroAddress(string field);
    error ErrorBaseVersion();
    error ErrorNoKeys();
    error ErrorNoStakingModules();
    error ErrorZerroMaxSigningKeysCount();
    error ErrorValueOver100Percent(string field);
    error ErrorStakingModuleIsPaused();
    error ErrorStakingModuleIsNotPaused();
    error UnregisteredStakingModule();
    error ErrorEmptyWithdrawalsCredentials();
}
