// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>
//
// SPDX-License-Identifier: GPL-3.0
//
pragma solidity 0.8.9;

import './IStakingModule.sol';
import './interfaces/IDepositContract.sol';
import './lib/BytesLib.sol';
import './lib/UnstructuredStorage.sol';

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

    function updateBufferedCounters(uint256 numKeys) external;

    function getTreasury() external view returns (address);
}

contract StakingRouterLinear {
    using UnstructuredStorage for bytes32;

    event ModuleAdded();
    event ModulePaused();
    event ModuleUnpaused();
    event ModuleActiveStatus();
    event DistributedShares(uint256 modulesShares, uint256 treasuryShares, uint256 remainShares);
    event DistributedDposits(uint256 moduleIndex, address indexed moduleAddress, uint256 assignedKeys, uint256 timestamp);

    error InvalidType();

    struct StakingModule {
        /// @notice name of module
        string name;
        /// @notice address of module
        address moduleAddress;
        /// @notice treasury fee
        uint16 treasuryFee;
        /// @notice target percent of total keys in protocol, in BP
        uint16 cap;
        /// @notice flag if module can not accept the deposits
        bool paused;
        /// @notice flag if module can participate in further reward distribution
        bool active;
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
        /// @notice total amount of exited keys in the module
        uint256 totalExitedKeys;
        /// @notice the number of keys that have been allocated to this module
        uint256 assignedKeys;
        /// @notice treasury fee in BP
        uint16 treasuryFee;
        /// @notice target percent of total keys in protocol, in BP
        uint16 cap;
        /// @notice flag if module can not accept the deposits
        bool paused;
        /// @notice flag if module can participate in further reward distribution
        bool active;
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
    bytes32 internal constant CONTRACT_VERSION_POSITION = keccak256('lido.WithdrawalQueue.contractVersion');

    uint256 public constant DEPOSIT_SIZE = 32 ether;

    uint256 internal constant DEPOSIT_AMOUNT_UNIT = 1000000000 wei;
    uint256 internal constant TOTAL_BASIS_POINTS = 10000;

    uint256 public constant PUBKEY_LENGTH = 48;
    uint256 public constant SIGNATURE_LENGTH = 96;

    uint256 public constant MAX_TIME = 86400;

    mapping(uint => StakingModule) internal modules;
    mapping(address => uint) internal modules_ids;
    uint internal modulesCount;

    //stake allocation module_index -> amount
    mapping(uint => uint) public allocation;
    uint internal totalAllocation;

    uint public lastDistribute;
    uint public timePeriod = 86400;

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

        StakingModule storage module = modules[modulesCount];
        modules_ids[_moduleAddress] = modulesCount;

        module.name = _name;
        module.moduleAddress = _moduleAddress;
        module.cap = _cap;
        module.treasuryFee = _treasuryFee;
        module.paused = false;
        module.active = true;
        modulesCount++;
    }

    function getModule(
        uint256 _id
    ) external view returns (address moduleAddress, string memory name, uint16 cap, uint16 treasuryFee, bool paused, bool active) {
        //@todo check exists

        StakingModule memory entry = modules[_id];

        moduleAddress = entry.moduleAddress;
        name = entry.name;
        cap = entry.cap;
        treasuryFee = entry.treasuryFee;
        paused = entry.paused;
        active = entry.active;
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
     * @return totalKeys total keys which used for calculation
     * @return moduleKeys array of amount module keys
     */
    function getTotalKeys() public view returns (uint256 totalKeys, uint256[] memory moduleKeys) {
        // calculate total used keys for operators
        moduleKeys = new uint256[](modulesCount);
        for (uint256 i = 0; i < modulesCount; ++i) {
            StakingModule memory module = modules[i];
            moduleKeys[i] = IStakingModule(module.moduleAddress).getTotalKeys();
            totalKeys += moduleKeys[i];
        }
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
            moduleKeys[i] = IStakingModule(module.moduleAddress).getTotalKeys();
            totalKeys += moduleKeys[i];
        }

        //calculate total fee to mint
        uint256 totalFee = 0;
        for (uint256 i = 0; i < modulesCount; ++i) {
            StakingModule memory stakingModule = modules[i];
            IStakingModule module = IStakingModule(stakingModule.moduleAddress);

            uint256 moduleFeeBasisPoints = module.getFee() + stakingModule.treasuryFee;

            uint256 rewards = (_totalRewards * moduleKeys[i]) / totalKeys;

            uint256 opRewards = (rewards * moduleFeeBasisPoints) / TOTAL_BASIS_POINTS;

            totalFee += opRewards;
        }

        // Now we want to mint new shares to the fee recipient, so that the total cost of the
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
    function distributeShares(
        uint256 _totalShares,
        uint256 _totalKeys,
        uint256[] memory _moduleKeys
    ) external returns (uint256 distributed) {
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

            IStakingModule module = IStakingModule(stakingModule.moduleAddress);

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
        lastDistribute = block.timestamp;

        uint256 buffered = address(this).balance;
        uint256 numDeposits = buffered / DEPOSIT_SIZE;

        require(numDeposits > 0);

        ModuleLookupCacheEntry[] memory cache = getAllocation(numDeposits); //module-eth
        ModuleLookupCacheEntry memory entry;

        for (uint256 i = 0; i < modulesCount; i++) {
            entry = cache[i];
            allocation[i] = cache[i].assignedKeys;
        }
    }

    /**
     * @dev This function returns the allocation table of the specified number of keys (deposits) between modules, depending on restrictions/pauses.
     *      Priority is given to models with the lowest number of used keys
     * @param _numDeposits the number of keys to distribute between modules
     * @return modules with assignedKeys variable which store the number of keys allocation
     */
    function getAllocation(uint256 _numDeposits) public view returns (ModuleLookupCacheEntry[] memory) {
        ModuleLookupCacheEntry[] memory cache = _loadModuleCache();
        ModuleLookupCacheEntry memory entry;

        (uint256 totalKeys, ) = getTotalKeys();

        uint256 assignedDeposits = 0;
        while (assignedDeposits < _numDeposits) {
            uint256 bestModuleIdx = modulesCount;
            uint256 smallestStake = 0;

            for (uint256 i = 0; i < modulesCount; i++) {
                entry = cache[i];

                if (entry.totalUsedKeys == entry.totalKeys || entry.totalUsedKeys + entry.assignedKeys == entry.totalKeys) {
                    continue;
                }

                if (entry.paused) {
                    continue;
                }

                uint256 stake = entry.totalUsedKeys - entry.totalStoppedKeys - entry.totalExitedKeys;
                uint256 softCap = entry.cap;

                if (softCap > 0 && ((entry.totalUsedKeys + entry.assignedKeys) * TOTAL_BASIS_POINTS) / totalKeys >= softCap) {
                    continue;
                }

                if (bestModuleIdx == modulesCount || stake < smallestStake) {
                    bestModuleIdx = i;
                    smallestStake = stake;
                }
            }

            if (bestModuleIdx == modulesCount)
                // not found
                break;

            entry = cache[bestModuleIdx];
            // assert(entry.usedSigningKeys < UINT64_MAX);

            ++entry.assignedKeys;
            ++assignedDeposits;
        }

        require(assignedDeposits == _numDeposits, 'INVALID_ASSIGNED_KEYS');

        return cache;
    }

    function _loadModuleCache() internal view returns (ModuleLookupCacheEntry[] memory cache) {
        cache = new ModuleLookupCacheEntry[](modulesCount);
        if (0 == cache.length) return cache;

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
            entry.totalExitedKeys = module.getTotalExitedKeys();
            entry.cap = stakingModule.cap;
            entry.paused = stakingModule.paused;
        }

        return cache;
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

        uint256 numKeys = pubkeys.length / PUBKEY_LENGTH;
        require(numKeys == signatures.length / SIGNATURE_LENGTH, 'REGISTRY_INCONSISTENT_SIG_COUNT');

        uint moduleId = modules_ids[msg.sender];
        uint alloc = allocation[moduleId];
        IStakingModule module = IStakingModule(msg.sender);

        if (alloc >= numKeys) {
            for (uint256 i = 0; i < numKeys; ++i) {
                bytes memory pubkey = BytesLib.slice(pubkeys, i * PUBKEY_LENGTH, PUBKEY_LENGTH);
                bytes memory signature = BytesLib.slice(signatures, i * SIGNATURE_LENGTH, SIGNATURE_LENGTH);
                _stake(pubkey, signature);
            }

            allocation[moduleId] -= numKeys;

            ILido(lido).updateBufferedCounters(numKeys);

            return numKeys;
        }

        uint currentTimestamp = block.timestamp;
        uint left = currentTimestamp - lastDistribute;

        require(left > MAX_TIME / 2, 'time threshold');

        uint unlocked = (left * TOTAL_BASIS_POINTS) / MAX_TIME;

        uint amount = 0;
        uint unlocked_amount = 0;
        for (uint i = 0; i < modulesCount; i++) {
            if (i == moduleId) continue;

            unlocked_amount = (allocation[i] * unlocked) / TOTAL_BASIS_POINTS;

            if (amount + unlocked_amount < numKeys) {
                amount += unlocked_amount;
                allocation[i] -= unlocked_amount;
            } else {
                uint a = numKeys - amount;
                amount += a;
                allocation[i] -= a;
            }
        }

        for (uint256 i = 0; i < numKeys; ++i) {
            bytes memory pubkey = BytesLib.slice(pubkeys, i * PUBKEY_LENGTH, PUBKEY_LENGTH);
            bytes memory signature = BytesLib.slice(signatures, i * SIGNATURE_LENGTH, SIGNATURE_LENGTH);
            _stake(pubkey, signature);
        }

        //update DEPOSITED_VALIDATORS_POSITION on LIDO
        ILido(lido).updateBufferedCounters(numKeys);

        return numKeys;
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
}
