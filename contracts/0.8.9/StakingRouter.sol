// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import { AccessControlEnumerable } from '@openzeppelin/contracts-v4.4/access/AccessControlEnumerable.sol';

import { ILido } from './interfaces/ILido.sol';
import { IStakingRouter } from './interfaces/IStakingRouter.sol';
import { IStakingModule } from './interfaces/IStakingModule.sol';
import { IDepositContract } from './interfaces/IDepositContract.sol';

import { Math } from './lib/Math.sol';
import { BytesLib } from './lib/BytesLib.sol';
import { UnstructuredStorage } from './lib/UnstructuredStorage.sol';

contract StakingRouter is IStakingRouter, AccessControlEnumerable {
    using UnstructuredStorage for bytes32;

    event ModuleAdded();
    event ModulePaused();
    event ModuleUnpaused();
    event ModuleActiveStatus();
    event DistributedShares(uint256 modulesShares, uint256 treasuryShares, uint256 remainShares);
    event DistributedDeposits(address indexed moduleAddress, uint256 assignedKeys, uint64 timestamp);
    event WithdrawalCredentialsSet(bytes32 withdrawalCredentials);
    event ContractVersionSet(uint256 version);

    struct StakingModule {
        /// @notice name of module
        string name;
        /// @notice address of module
        IStakingModule moduleAddress;
        /// @notice treasury fee
        uint16 treasuryFee;
        /// @notice fee of the module
        uint16 moduleFee;
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

    IDepositContract public immutable DEPOSIT_CONTRACT;
    ILido public immutable LIDO;

    bytes32 public constant MANAGE_WITHDRAWAL_KEY_ROLE = keccak256('MANAGE_WITHDRAWAL_KEY_ROLE');
    bytes32 public constant MODULE_PAUSE_ROLE = keccak256('MODULE_PAUSE_ROLE');
    bytes32 public constant MODULE_CONTROL_ROLE = keccak256('MODULE_CONTROL_ROLE');
    bytes32 public constant DEPOSIT_ROLE = keccak256('DEPOSIT_ROLE');

    /// Version of the initialized contract data
    /// NB: Contract versioning starts from 1.
    /// The version stored in CONTRACT_VERSION_POSITION equals to
    /// - 0 right after deployment when no initializer is invoked yet
    /// - N after calling initialize() during deployment from scratch, where N is the current contract version
    /// - N after upgrading contract from the previous version (after calling finalize_vN())
    bytes32 internal constant CONTRACT_VERSION_POSITION = keccak256('lido.StakingRouter.contractVersion');

    /// @dev Credentials which allows the DAO to withdraw Ether on the 2.0 side
    bytes32 internal constant WITHDRAWAL_CREDENTIALS_POSITION = keccak256('lido.StakingRouter.withdrawalCredentials');

    uint256 public constant DEPOSIT_SIZE = 32 ether;

    uint256 internal constant DEPOSIT_AMOUNT_UNIT = 1000000000 wei;
    uint256 internal constant TOTAL_BASIS_POINTS = 10000;

    uint256 public constant PUBKEY_LENGTH = 48;
    uint256 public constant SIGNATURE_LENGTH = 96;

    /// @dev list of the staking modules
    StakingModule[] internal _stakingModules;

    /// @dev Position of the stakin modules in the `_stakingModules` array, plus 1 because
    ///      index 0 means a value is not in the set.
    mapping(address => uint256) internal _stakingModuleIndicesOneBased;

    constructor(address _depositContract, address _lido) {
        require(_lido != address(0), 'LIDO_ZERO_ADDRESS');
        require(_depositContract != address(0), 'DEPOSIT_CONTRACT_ZERO_ADDRESS');

        LIDO = ILido(_lido);
        DEPOSIT_CONTRACT = IDepositContract(_depositContract);
    }

    function initialize(address _admin) external {
        require(_admin != address(0), 'ADMIN_ZERO_ADDRESS');
        require(CONTRACT_VERSION_POSITION.getStorageUint256() == 0, 'BASE_VERSION_MUST_BE_ZERO');

        _setupRole(DEFAULT_ADMIN_ROLE, _admin);

        CONTRACT_VERSION_POSITION.setStorageUint256(1);
        emit ContractVersionSet(1);
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
        require(_targetShare <= TOTAL_BASIS_POINTS, 'VALUE_OVER_100_PERCENT');
        require(_treasuryFee <= TOTAL_BASIS_POINTS, 'VALUE_OVER_100_PERCENT');

        _stakingModules.push();
        StakingModule storage module = _stakingModules[_stakingModules.length - 1];
        _stakingModuleIndicesOneBased[_moduleAddress] = _stakingModules.length;

        module.name = _name;
        module.moduleAddress = IStakingModule(_moduleAddress);
        module.targetShare = _targetShare;
        module.treasuryFee = _treasuryFee;
        module.moduleFee = _moduleFee;
        module.paused = false;
        module.active = true;
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
        require(!module.paused, 'module_is_paused');

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
            moduleActiveKeys[i] = getActiveKeysCount(_stakingModules[i].moduleAddress);
            totalActiveKeys += moduleActiveKeys[i];
        }
    }

    function getActiveKeysCount(IStakingModule stakingModule) public view returns (uint256) {
        require(_stakingModuleIndicesOneBased[address(stakingModule)] != 0, 'MODULE_NOT_FOUND');

        uint256 usedKeysCount = stakingModule.getTotalUsedKeys();
        uint256 stoppedKeysCount = stakingModule.getTotalStoppedKeys();
        return usedKeysCount - stoppedKeysCount;
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
        returns (
            address[] memory recipients,
            uint256[] memory modulesShares,
            uint256[] memory moduleFee,
            uint256[] memory treasuryFee
        )
    {
        uint256 _modulesCount = _stakingModules.length;
        assert(_modulesCount != 0);

        // +1 for treasury
        recipients = new address[](_modulesCount);
        modulesShares = new uint256[](_modulesCount);
        moduleFee = new uint256[](_modulesCount);
        treasuryFee = new uint256[](_modulesCount);

        uint256 idx = 0;
        uint256 treasuryShares = 0;

        (uint256 totalActiveKeys, uint256[] memory moduleActiveKeys) = getTotalActiveKeys();

        require(totalActiveKeys > 0, 'NO_KEYS');

        for (uint256 i = 0; i < _modulesCount; ++i) {
            StakingModule memory stakingModule = _stakingModules[i];
            IStakingModule module = IStakingModule(stakingModule.moduleAddress);

            recipients[idx] = address(stakingModule.moduleAddress);
            modulesShares[idx] = ((moduleActiveKeys[i] * TOTAL_BASIS_POINTS) / totalActiveKeys);
            moduleFee[idx] = module.getFee();
            treasuryFee[idx] = stakingModule.treasuryFee;

            ++idx;
        }

        return (recipients, modulesShares, moduleFee, treasuryFee);
    }

    function getAllocatedDepositsDistribution(uint256 _totalActiveKeysCount) public view returns (uint256[] memory depositsAllocation) {
        depositsAllocation = new uint256[](_stakingModules.length);

        for (uint256 i = 0; i < depositsAllocation.length; ++i) {
            StakingModuleKeysInfo memory stakingModuleKeysInfo = _getStakingModuleKeysInfo(_stakingModules[i].moduleAddress);
            uint256 targetKeysAllocation = (_totalActiveKeysCount * _stakingModules[i].targetShare) / TOTAL_BASIS_POINTS;

            if (_stakingModules[i].paused || stakingModuleKeysInfo.activeKeysCount >= targetKeysAllocation) {
                continue;
            }
            uint256 availableKeys = stakingModuleKeysInfo.totalKeysCount - stakingModuleKeysInfo.usedKeysCount;
            depositsAllocation[i] = Math.min(targetKeysAllocation - stakingModuleKeysInfo.activeKeysCount, availableKeys);
        }
    }

    function getAllocatedDepositsCount(address _stakingModule, uint256 _totalActiveKeys)
        external
        view
        onlyRegisteredStakingModule(_stakingModule)
        returns (uint256)
    {
        return _getAllocatedDepositsCount(_stakingModule, _totalActiveKeys);
    }

    function _getAllocatedDepositsCount(address _stakingModule, uint256 totalActiveKeys) internal view returns (uint256) {
        StakingModule storage stakingModule = _stakingModules[_stakingModuleIndicesOneBased[_stakingModule]];
        if (stakingModule.paused) {
            return 0;
        }
        StakingModuleKeysInfo memory keysInfo = _getStakingModuleKeysInfo(stakingModule.moduleAddress);
        uint256 targetKeysAllocation = (totalActiveKeys * stakingModule.targetShare) / TOTAL_BASIS_POINTS;
        if (keysInfo.activeKeysCount > targetKeysAllocation) {
            return 0;
        }
        return Math.min(targetKeysAllocation - keysInfo.activeKeysCount, keysInfo.availableKeysCount);
    }

    struct StakingModuleKeysInfo {
        uint256 totalKeysCount;
        uint256 usedKeysCount;
        uint256 stoppedKeysCount;
        uint256 activeKeysCount;
        uint256 availableKeysCount;
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
    ) external onlyRole(DEPOSIT_ROLE) onlyRegisteredStakingModule(stakingModule) onlyNotPausedStakingModule(stakingModule) {
        (uint256 activeKeysCount, ) = getTotalActiveKeys();

        uint256 maxSigningKeysCount = _getAllocatedDepositsCount(
            stakingModule,
            activeKeysCount + Math.min(maxDepositsCount, _getStakingModuleAvailableKeys(stakingModule))
        );

        require(maxSigningKeysCount != 0, 'EMPTY_DEPOSIT');

        IStakingModule module = IStakingModule(stakingModule);
        (bytes memory pubkeys, bytes memory signatures) = module.prepNextSigningKeys(maxSigningKeysCount, depositCalldata);

        //bytes memory pubkeys, bytes memory signatures
        require(pubkeys.length > 0, 'INVALID_PUBKEYS');

        require(pubkeys.length % PUBKEY_LENGTH == 0, 'REGISTRY_INCONSISTENT_PUBKEYS_LEN');
        require(signatures.length % SIGNATURE_LENGTH == 0, 'REGISTRY_INCONSISTENT_SIG_LEN');

        uint256 depositsCount = pubkeys.length / PUBKEY_LENGTH;
        require(depositsCount == signatures.length / SIGNATURE_LENGTH, 'REGISTRY_INCONSISTENT_SIG_COUNT');

        for (uint256 i = 0; i < depositsCount; ++i) {
            bytes memory pubkey = BytesLib.slice(pubkeys, i * PUBKEY_LENGTH, PUBKEY_LENGTH);
            bytes memory signature = BytesLib.slice(signatures, i * SIGNATURE_LENGTH, SIGNATURE_LENGTH);
            _stake(pubkey, signature);
        }

        LIDO.updateBufferedCounters(depositsCount);

        uint256 stakingModuleIndex = _stakingModuleIndicesOneBased[stakingModule];
        _stakingModules[stakingModuleIndex].lastDepositAt = uint64(block.timestamp);
        _stakingModules[stakingModuleIndex].lastDepositBlock = block.number;
    }

    /**
     * @dev Invokes a deposit call to the official Deposit contract
     * @param _pubkey Validator to stake for
     * @param _signature Signature of the deposit call
     */
    function _stake(bytes memory _pubkey, bytes memory _signature) internal {
        bytes32 withdrawalCredentials = getWithdrawalCredentials();
        require(withdrawalCredentials != 0, 'EMPTY_WITHDRAWAL_CREDENTIALS');

        uint256 value = DEPOSIT_SIZE;

        // The following computations and Merkle tree-ization will make official Deposit contract happy
        uint256 depositsAmount = value / DEPOSIT_AMOUNT_UNIT;
        assert(depositsAmount * DEPOSIT_AMOUNT_UNIT == value); // properly rounded

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
                sha256(abi.encodePacked(_toLittleEndian64(depositsAmount), signatureRoot))
            )
        );

        uint256 targetBalance = address(this).balance - value;

        getDepositContract().deposit{ value: value }(_pubkey, abi.encodePacked(withdrawalCredentials), _signature, depositDataRoot);
        require(address(this).balance == targetBalance, 'EXPECTING_DEPOSIT_TO_HAPPEN');
    }

    function _trimUnusedKeys() internal {
        uint256 _modulesCount = getModulesCount();
        if (_modulesCount > 0) {
            for (uint256 i = 0; i < _modulesCount; ++i) {
                StakingModule memory stakingModule = _stakingModules[i];
                IStakingModule module = IStakingModule(stakingModule.moduleAddress);

                module.trimUnusedKeys();
            }
        }
    }

    /**
     * @notice Gets deposit contract handle
     */
    function getDepositContract() public view returns (IDepositContract) {
        return DEPOSIT_CONTRACT;
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

    function _getStakingModuleKeysInfo(IStakingModule stakingModule) internal view returns (StakingModuleKeysInfo memory keysInfo) {
        keysInfo.totalKeysCount = stakingModule.getTotalKeys();
        keysInfo.usedKeysCount = stakingModule.getTotalUsedKeys();
        keysInfo.stoppedKeysCount = stakingModule.getTotalStoppedKeys();
        keysInfo.activeKeysCount = keysInfo.usedKeysCount - keysInfo.stoppedKeysCount;
        keysInfo.availableKeysCount = keysInfo.totalKeysCount - keysInfo.usedKeysCount;
    }

    function _getStakingModuleAvailableKeys(address stakingModule_) internal view returns (uint256) {
        IStakingModule stakingModule = IStakingModule(stakingModule_);
        return stakingModule.getTotalKeys() - stakingModule.getTotalUsedKeys();
    }

    modifier onlyRegisteredStakingModule(address stakingModule) {
        require(_stakingModuleIndicesOneBased[stakingModule] != 0, 'UNREGISTERED_STAKING_MODULE');
        _;
    }

    modifier onlyNotPausedStakingModule(address stakingModule) {
        require(!_stakingModules[_stakingModuleIndicesOneBased[stakingModule]].paused, 'STAKING_MODULE_PAUSED');
        _;
    }
}
