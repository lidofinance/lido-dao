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

    event ModuleAdded();
    event ModulePaused();
    event ModuleUnpaused();
    event ModuleActiveStatus();
    event DistributedShares(uint256 modulesShares, uint256 treasuryShares, uint256 remainShares);
    event DistributedDeposits(address indexed moduleAddress, uint256 assignedKeys, uint64 timestamp);
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
        IStakingModule moduleAddress;
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

    /// @dev list of the staking modules
    StakingModule[] internal _stakingModules;

    /// @dev Position of the stakin modules in the `_stakingModules` array, plus 1 because
    ///      index 0 means a value is not in the set.
    mapping(address => uint256) internal _stakingModuleIndicesOneBased;

    constructor(address _depositContract, address _lido) BeaconChainDepositor(_depositContract) {
        require(_lido != address(0), "LIDO_ZERO_ADDRESS");
        LIDO = ILido(_lido);
    }

    function initialize(address _admin) external {
        require(_admin != address(0), "ADMIN_ZERO_ADDRESS");
        require(CONTRACT_VERSION_POSITION.getStorageUint256() == 0, "BASE_VERSION_MUST_BE_ZERO");

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
     * @param _moduleAddress target percent of total keys in protocol, in BP
     * @param _targetShare target total stake share
     * @param _moduleFee fee of the module taken from the consensus layer rewards
     * @param _treasuryFee treasury fee
     */
    function addModule(
        string memory _name,
        address _moduleAddress,
        uint16 _targetShare,
        uint16 _moduleFee,
        uint16 _treasuryFee
    ) external onlyRole(MODULE_PAUSE_ROLE) {
        require(_targetShare <= TOTAL_BASIS_POINTS, "VALUE_OVER_100_PERCENT");
        require(_treasuryFee <= TOTAL_BASIS_POINTS, "VALUE_OVER_100_PERCENT");

        _stakingModules.push(
            StakingModule({
                name: _name,
                moduleAddress: IStakingModule(_moduleAddress),
                targetShare: _targetShare,
                treasuryFee: _treasuryFee,
                moduleFee: _moduleFee,
                paused: false,
                active: true,
                lastDepositAt: 0,
                lastDepositBlock: 0
            })
        );
        _stakingModuleIndicesOneBased[_moduleAddress] = _stakingModules.length;
    }

    function getModule(uint256 moduleId) external view returns (StakingModule memory) {
        return _stakingModules[moduleId];
    }

    /**
     * @notice Returns total number of node operators
     */
    function getModulesCount() public view returns (uint256) {
        return _stakingModules.length;
    }

    /**
     * @notice pause deposits for module
     * @param stakingModule address of module
     */
    function pauseStakingModule(address stakingModule) external onlyRole(MODULE_PAUSE_ROLE) {
        StakingModule storage module = _getModuleByAddress(stakingModule);
        require(!module.paused, "module_is_paused");

        module.paused = true;
    }

    /**
     * @notice unpause deposits for module
     * @param stakingModule address of module
     */
    function unpauseStakingModule(address stakingModule) external onlyRole(MODULE_CONTROL_ROLE) {
        StakingModule storage module = _getModuleByAddress(stakingModule);
        if (module.paused) {
            module.paused = false;
        }
    }

    /**
     * @notice set the module activity flag for participation in further reward distribution
     */
    function setStakingModuleActive(address stakingModule, bool _active) external onlyRole(MODULE_CONTROL_ROLE) {
        StakingModule storage module = _getModuleByAddress(stakingModule);
        module.active = _active;
    }

    function getStakingModuleIsPaused(address stakingModule) external view returns (bool) {
        StakingModule storage module = _getModuleByAddress(stakingModule);
        return module.paused;
    }

    function getStakingModuleKeysOpIndex(address stakingModule) external view returns (uint256) {
        return IStakingModule(stakingModule).getKeysOpIndex();
    }

    function getStakingModuleLastDepositBlock(address stakingModule) external view returns (uint256) {
        StakingModule storage module = _getModuleByAddress(stakingModule);
        return module.lastDepositBlock;
    }

    function _getModuleByAddress(address _moduleAddress) internal view returns (StakingModule storage) {
        return _stakingModules[_stakingModuleIndicesOneBased[_moduleAddress]];
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
        uint256 _modulesCount = getModulesCount();
        moduleActiveKeys = new uint256[](_modulesCount);
        for (uint256 i = 0; i < _modulesCount; ++i) {
            moduleActiveKeys[i] = _getActiveKeysCount(_stakingModules[i].moduleAddress);
            totalActiveKeys += moduleActiveKeys[i];
        }
    }

    function getActiveKeysCount(address _stakingModule)
        public
        view
        onlyRegisteredStakingModule(_stakingModule)
        returns (uint256)
    {
        return _getActiveKeysCount(IStakingModule(_stakingModule));
    }

    function _getActiveKeysCount(IStakingModule _stakingModule) internal view returns (uint256) {
        uint256 usedKeysCount = _stakingModule.getTotalUsedKeys();
        uint256 stoppedKeysCount = _stakingModule.getTotalStoppedKeys();
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
        uint256 _modulesCount = _stakingModules.length;
        assert(_modulesCount != 0);

        // +1 for treasury
        recipients = new address[](_modulesCount);
        moduleShares = new uint256[](_modulesCount);

        totalShare = 0;

        (uint256 totalActiveKeys, uint256[] memory moduleActiveKeys) = getTotalActiveKeys();

        require(totalActiveKeys > 0, "NO_KEYS");

        StakingModule memory stakingModule;
        uint256 moduleShare;
        for (uint256 i = 0; i < _modulesCount; ++i) {
            stakingModule = _stakingModules[i];
            moduleShare = ((moduleActiveKeys[i] * TOTAL_BASIS_POINTS) / totalActiveKeys);

            uint256 moduleRewards = ((moduleShare * stakingModule.moduleFee) / TOTAL_BASIS_POINTS);

            totalShare += moduleRewards;

            recipients[i] = address(stakingModule.moduleAddress);
            moduleShares[i] = moduleRewards - (moduleShare * stakingModule.treasuryFee / TOTAL_BASIS_POINTS);
        }

        return (recipients, moduleShares, totalShare);
    }

    function getAllocatedDepositsDistribution(uint256 _totalActiveKeysCount)
        public
        view
        returns (uint256[] memory depositsAllocation)
    {
        depositsAllocation = new uint256[](_stakingModules.length);

        for (uint256 i = 0; i < depositsAllocation.length; ++i) {
            StakingModuleCache memory stakingModuleCache = _loadStakingModuleCache(i);
            uint256 targetKeysAllocation = (_totalActiveKeysCount * _stakingModules[i].targetShare) /
                TOTAL_BASIS_POINTS;

            if (_stakingModules[i].paused || stakingModuleCache.activeKeysCount >= targetKeysAllocation) {
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
        uint256 stakingModuleIndex = _stakingModuleIndicesOneBased[_stakingModule];
        StakingModuleCache memory stakingModuleCache = _loadStakingModuleCache(stakingModuleIndex);
        return _getAllocatedDepositsCount(stakingModuleCache, _totalActiveKeys);
    }

    /**
     * @dev Invokes a deposit call to the official Deposit contract
     * @param maxDepositsCount max deposits count
     * @param stakingModule module address
     * @param depositCalldata module calldata
     */
    function deposit(
        uint256 maxDepositsCount,
        address stakingModule,
        bytes calldata depositCalldata
    )
        external
        onlyRole(DEPOSIT_ROLE)
        onlyRegisteredStakingModule(stakingModule)
        onlyNotPausedStakingModule(stakingModule)
    {
        /// @todo make more optimal calc of totalActiveKeysCount (eliminate double calls of module.getTotalUsedKeys() and
        ///       module.getTotalStoppedKeys() inside getTotalActiveKeys() and _loadStakingModuleCache() methods)
        (uint256 totalActiveKeys, ) = getTotalActiveKeys();

        uint256 stakingModuleIndex = _stakingModuleIndicesOneBased[stakingModule];
        StakingModuleCache memory stakingModuleCache = _loadStakingModuleCache(stakingModuleIndex);

        uint256 maxSigningKeysCount = _getAllocatedDepositsCount(
            stakingModuleCache,
            totalActiveKeys + Math.min(maxDepositsCount, stakingModuleCache.availableKeysCount)
        );

        require(maxSigningKeysCount != 0, "ZERO_MAX_SIGNING_KEYS_COUNT");

        (uint256 keysCount, bytes memory publicKeysBatch, bytes memory signaturesBatch) = IStakingModule(stakingModule)
            .prepNextSigningKeys(maxSigningKeysCount, depositCalldata);

        require(keysCount > 0, "NO_SIGNING_KEYS");

        BatchedSigningKeys.validatePublicKeysBatch(publicKeysBatch, keysCount);
        BatchedSigningKeys.validateSignaturesBatch(signaturesBatch, keysCount);

        require(getWithdrawalCredentials() != 0, "EMPTY_WITHDRAWALS_CREDENTIALS");
        bytes memory encodedWithdrawalCredentials = abi.encodePacked(getWithdrawalCredentials());

        for (uint256 i = 0; i < keysCount; ++i) {
            bytes memory publicKey = BatchedSigningKeys.readPublicKey(publicKeysBatch, i);
            bytes memory signature = BatchedSigningKeys.readSignature(signaturesBatch, i);
            _makeBeaconChainDeposit(encodedWithdrawalCredentials, publicKey, signature, DEPOSIT_SIZE);
        }

        LIDO.updateBufferedCounters(keysCount);

        _stakingModules[stakingModuleIndex].lastDepositAt = uint64(block.timestamp);
        _stakingModules[stakingModuleIndex].lastDepositBlock = block.number;
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
        for (uint256 i = 0; i < _stakingModules.length; ++i) {
            StakingModule memory stakingModule = _stakingModules[i];
            IStakingModule(stakingModule.moduleAddress).trimUnusedKeys();
        }
    }

    function _loadStakingModuleCache(uint256 _stakingModuleIndex)
        internal
        view
        returns (StakingModuleCache memory stakingModuleCache)
    {
        stakingModuleCache.paused = _stakingModules[_stakingModuleIndex].paused;
        stakingModuleCache.targetShare = _stakingModules[_stakingModuleIndex].targetShare;

        IStakingModule stakingModule = IStakingModule(_stakingModules[_stakingModuleIndex].moduleAddress);
        stakingModuleCache.totalKeysCount = stakingModule.getTotalKeys();
        stakingModuleCache.usedKeysCount = stakingModule.getTotalUsedKeys();
        stakingModuleCache.stoppedKeysCount = stakingModule.getTotalStoppedKeys();
        stakingModuleCache.activeKeysCount = stakingModuleCache.usedKeysCount - stakingModuleCache.stoppedKeysCount;
        stakingModuleCache.availableKeysCount = stakingModuleCache.totalKeysCount - stakingModuleCache.usedKeysCount;
    }

    modifier onlyRegisteredStakingModule(address stakingModule) {
        require(_stakingModuleIndicesOneBased[stakingModule] != 0, "UNREGISTERED_STAKING_MODULE");
        _;
    }

    modifier onlyNotPausedStakingModule(address stakingModule) {
        require(!_stakingModules[_stakingModuleIndicesOneBased[stakingModule]].paused, "STAKING_MODULE_PAUSED");
        _;
    }
}
