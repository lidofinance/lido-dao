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

import {BeaconChainDepositor} from "./BeaconChainDepositor.sol";

contract StakingRouter is IStakingRouter, AccessControlEnumerable, BeaconChainDepositor {
    using UnstructuredStorage for bytes32;

    event StakingModuleAdded(address indexed creator, address indexed stakingModule, string name);
    event StakingModuleTargetSharesSet(address indexed stakingModule, uint16 targetShare);
    event StakingModuleFeesSet(address indexed stakingModule, uint16 treasuryFee, uint16 moduleFee);
    event StakingModulePaused(address indexed stakingModule, address indexed actor);
    event StakingModuleUnpaused(address indexed stakingModule, address indexed actor);
    event StakingModuleActiveStatusChanged(address indexed stakingModule, bool isActive, address indexed actor);
    event StakingModuleDeposit(uint64 lastDepositAt, uint256 lastDepositBlock);
    event DistributedShares(uint256 modulesShares, uint256 treasuryShares, uint256 remainShares);
    event DistributedDeposits(address indexed stakingModuleAddress, uint256 assignedKeys, uint64 timestamp);
    event WithdrawalCredentialsSet(bytes32 withdrawalCredentials);
    event ContractVersionSet(uint256 version);
    /**
     * Emitted when the vault received ETH
     */
    event ETHReceived(uint256 amount);

    struct StakingModule {
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

    /// @dev mapping is used instead of array to allow to extend the StakingModule
    mapping(uint256 => StakingModule) private _stakingModulesMap;

    /// @dev Position of the staking modules in the `_stakingModules` map, plus 1 because
    ///      index 0 means a value is not in the set.
    mapping(address => uint256) private _stakingModuleIndicesOneBased;

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

        _stakingModulesMap[_stakingModulesCount] = StakingModule({
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

        _stakingModuleIndicesOneBased[_stakingModuleAddress] = ++_stakingModulesCount;

        emit StakingModuleAdded(msg.sender, _stakingModuleAddress, _name);
        emit StakingModuleTargetSharesSet(_stakingModuleAddress, _targetShare);
        emit StakingModuleFeesSet(_stakingModuleAddress, _treasuryFee, _moduleFee);
    }

    function updateStakingModule(
        address _stakingModuleAddress,
        uint16 _targetShare,
        uint16 _moduleFee,
        uint16 _treasuryFee
    ) external onlyRole(MODULE_CONTROL_ROLE) {
        if (_targetShare > TOTAL_BASIS_POINTS) revert ErrorValueOver100Percent("_targetShare");
        if (_treasuryFee > TOTAL_BASIS_POINTS) revert ErrorValueOver100Percent("_treasuryFee");
        if (_moduleFee > TOTAL_BASIS_POINTS) revert ErrorValueOver100Percent("_moduleFee");

        uint256 stakingModuleIndex = _stakingModuleIndicesOneBased[_stakingModuleAddress];

        _stakingModulesMap[stakingModuleIndex].targetShare = _targetShare;
        _stakingModulesMap[stakingModuleIndex].treasuryFee = _treasuryFee;
        _stakingModulesMap[stakingModuleIndex].moduleFee = _moduleFee;

        emit StakingModuleTargetSharesSet(_stakingModuleAddress, _targetShare);
        emit StakingModuleFeesSet(_stakingModuleAddress, _treasuryFee, _moduleFee);
    }

    function getStakingModule(address _stakingModule) external view returns (StakingModule memory) {
        return _getStakingModuleByAddress(_stakingModule);
    }

    /**
     * @notice Returns total number of node operators
     */
    function getStakingModulesCount() public view returns (uint256) {
        return _stakingModulesCount;
    }

    /**
     * @notice pause deposits for module
     * @param stakingModule address of module
     */
    function pauseStakingModule(address stakingModule) external onlyRole(MODULE_PAUSE_ROLE) {
        StakingModule storage module = _getStakingModuleByAddress(stakingModule);
        if (module.paused) revert ErrorStakingModuleIsPaused();

        module.paused = true;

        emit StakingModulePaused(stakingModule, msg.sender);
    }

    /**
     * @notice unpause deposits for module
     * @param stakingModule address of module
     */
    function unpauseStakingModule(address stakingModule) external onlyRole(MODULE_CONTROL_ROLE) {
        StakingModule storage module = _getStakingModuleByAddress(stakingModule);
        if (!module.paused) revert ErrorStakingModuleIsNotPaused();

        module.paused = false;

        emit StakingModuleUnpaused(stakingModule, msg.sender);
    }

    /**
     * @notice set the module activity flag for participation in further reward distribution
     */
    function setStakingModuleActive(address stakingModule, bool _active) external onlyRole(MODULE_CONTROL_ROLE) {
        StakingModule storage module = _getStakingModuleByAddress(stakingModule);
        module.active = _active;

        emit StakingModuleActiveStatusChanged(stakingModule, _active, msg.sender);
    }

    function getStakingModuleIsPaused(address stakingModule) external view returns (bool) {
        StakingModule storage module = _getStakingModuleByAddress(stakingModule);
        return module.paused;
    }

    function getStakingModuleKeysOpIndex(address stakingModule) external view returns (uint256) {
        return IStakingModule(stakingModule).getKeysOpIndex();
    }

    function getStakingModuleLastDepositBlock(address stakingModule) external view returns (uint256) {
        StakingModule storage module = _getStakingModuleByAddress(stakingModule);
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
            moduleActiveKeys[i] = _getActiveKeysCount(_getStakingModuleAddressByIndex(i));
            totalActiveKeys += moduleActiveKeys[i];
        }
    }

    function getActiveKeysCount(address _stakingModule)
        public
        view
        onlyRegisteredStakingModule(_stakingModule)
        returns (uint256)
    {
        return _getActiveKeysCount(_stakingModule);
    }

    function _getActiveKeysCount(address _stakingModule) internal view returns (uint256) {
        uint256 usedKeysCount = IStakingModule(_stakingModule).getTotalUsedKeys();
        uint256 stoppedKeysCount = IStakingModule(_stakingModule).getTotalStoppedKeys();
        return usedKeysCount - stoppedKeysCount;
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

    function getAllocatedDepositsDistribution(uint256 _totalActiveKeysCount)
        public
        view
        returns (uint256[] memory depositsAllocation)
    {
        uint256 stakingModulesCount = getStakingModulesCount();
        depositsAllocation = new uint256[](stakingModulesCount);

        for (uint256 i = 0; i < stakingModulesCount; ++i) {
            StakingModuleCache memory stakingModuleCache = _loadStakingModuleCache(_getStakingModuleAddressByIndex(i));
            uint256 targetKeysAllocation = (_totalActiveKeysCount * stakingModuleCache.targetShare) /
                TOTAL_BASIS_POINTS;

            if (stakingModuleCache.paused || stakingModuleCache.activeKeysCount >= targetKeysAllocation) {
                continue;
            }
            uint256 availableKeys = stakingModuleCache.totalKeysCount - stakingModuleCache.usedKeysCount;
            depositsAllocation[i] = Math.min(targetKeysAllocation - stakingModuleCache.activeKeysCount, availableKeys);
        }
    }

    function getAllocatedDepositsCount(address _stakingModule, uint256 _totalActiveKeys)
        external
        view
        onlyRegisteredStakingModule(_stakingModule)
        returns (uint256)
    {
        StakingModuleCache memory stakingModuleCache = _loadStakingModuleCache(_stakingModule);
        return _getAllocatedDepositsCount(stakingModuleCache, _totalActiveKeys);
    }

    /**
     * @dev Invokes a deposit call to the official Deposit contract
     * @param _maxDepositsCount max deposits count
     * @param _stakingModule module address
     * @param _depositCalldata module calldata
     */
    function deposit(
        uint256 _maxDepositsCount,
        address _stakingModule,
        bytes calldata _depositCalldata
    )
        external
        onlyRole(DEPOSIT_ROLE)
        onlyRegisteredStakingModule(_stakingModule)
        onlyNotPausedStakingModule(_stakingModule)
    {
        /// @todo make more optimal calc of totalActiveKeysCount (eliminate double calls of module.getTotalUsedKeys() and
        ///       module.getTotalStoppedKeys() inside getTotalActiveKeys() and _loadStakingModuleCache() methods)
        (uint256 totalActiveKeys, ) = getTotalActiveKeys();

        StakingModuleCache memory stakingModuleCache = _loadStakingModuleCache(_stakingModule);

        uint256 maxSigningKeysCount = _getAllocatedDepositsCount(
            stakingModuleCache,
            totalActiveKeys + Math.min(_maxDepositsCount, stakingModuleCache.availableKeysCount)
        );

        if (maxSigningKeysCount == 0) revert ErrorZerroMaxSigningKeysCount();

        (uint256 keysCount, bytes memory publicKeysBatch, bytes memory signaturesBatch) = IStakingModule(_stakingModule)
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

        LIDO.updateBufferedCounters(keysCount);

        StakingModule storage stakingModule = _getStakingModuleByAddress(_stakingModule);

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

    function _getAllocatedDepositsCount(StakingModuleCache memory _stakingModule, uint256 totalActiveKeys)
        internal
        pure
        returns (uint256)
    {
        if (_stakingModule.paused) {
            return 0;
        }
        uint256 targetKeysAllocation = (totalActiveKeys * _stakingModule.targetShare) / TOTAL_BASIS_POINTS;
        if (_stakingModule.activeKeysCount > targetKeysAllocation) {
            return 0;
        }
        return Math.min(targetKeysAllocation - _stakingModule.activeKeysCount, _stakingModule.availableKeysCount);
    }

    function _trimUnusedKeys() internal {
        uint256 stakingModulesCount = getStakingModulesCount();
        for (uint256 i = 0; i < stakingModulesCount; ++i) {
            StakingModule storage stakingModule = _getStakingModuleByIndex(i);
            IStakingModule(stakingModule.stakingModuleAddress).trimUnusedKeys();
        }
    }

    function _loadStakingModuleCache(address _stakingModule)
        internal
        view
        returns (StakingModuleCache memory stakingModuleCache)
    {
        StakingModule storage stakingModuleData = _getStakingModuleByAddress(_stakingModule);
        stakingModuleCache.paused = stakingModuleData.paused;
        stakingModuleCache.targetShare = stakingModuleData.targetShare;

        IStakingModule stakingModule = IStakingModule(stakingModuleData.stakingModuleAddress);
        stakingModuleCache.totalKeysCount = stakingModule.getTotalKeys();
        stakingModuleCache.usedKeysCount = stakingModule.getTotalUsedKeys();
        stakingModuleCache.stoppedKeysCount = stakingModule.getTotalStoppedKeys();
        stakingModuleCache.activeKeysCount = stakingModuleCache.usedKeysCount - stakingModuleCache.stoppedKeysCount;
        stakingModuleCache.availableKeysCount = stakingModuleCache.totalKeysCount - stakingModuleCache.usedKeysCount;
    }

    function _getStakingModuleAddressByIndex(uint256 _stakingModuleIndex) private view returns (address) {
        return _getStakingModuleByIndex(_stakingModuleIndex).stakingModuleAddress;
    }

    function _getStakingModuleIndexByAddress(address _stakingModule) private view returns (uint256) {
        return _stakingModuleIndicesOneBased[_stakingModule];
    }

    function _getStakingModuleByAddress(address _stakingModule) private view returns (StakingModule storage) {
        return _stakingModulesMap[_stakingModuleIndicesOneBased[_stakingModule] - 1];
    }

    function _getStakingModuleByIndex(uint256 _stakingModuleIndex) private view returns (StakingModule storage) {
        return _stakingModulesMap[_stakingModuleIndex];
    }

    modifier onlyRegisteredStakingModule(address _stakingModule) {
        require(_stakingModuleIndicesOneBased[_stakingModule] != 0, "UNREGISTERED_STAKING_MODULE");
        _;
    }

    modifier onlyNotPausedStakingModule(address _stakingModule) {
        StakingModule storage stakingModule = _getStakingModuleByAddress(_stakingModule);
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
