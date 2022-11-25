// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>
//
// SPDX-License-Identifier: GPL-3.0
//
pragma solidity 0.8.9;

import "hardhat/console.sol";
import "./IModule.sol";
import "./interfaces/IDepositContract.sol";
import "./lib/BytesLib.sol";

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
    function updateBufferedCounters(uint256 numKeys) external;
}


contract StakingRouter {
    //////for test
    event KeysAssigned(bytes pubkeys, bytes signatures);
    //////

    event DepositsUnpaused();

    error InvalidType();

    address public immutable lido;
    address public immutable deposit_contract;
    address public dsm;

    uint256 constant public DEPOSIT_SIZE = 32 ether;

    uint256 internal constant DEPOSIT_AMOUNT_UNIT = 1000000000 wei;
    uint256 internal constant TOTAL_BASIS_POINTS = 10000;

    uint256 constant public PUBKEY_LENGTH = 48;
    uint256 constant public SIGNATURE_LENGTH = 96;
    uint256 constant public WITHDRAWAL_CREDENTIALS_LENGTH = 32;

    uint256 constant public MAX_TIME = 86400;

    struct StakingModule{
        string name;
        address moduleAddress;
        uint16 cap; //in basic points, e.g 500 - 5%
        bool paused;
    }

    struct ModuleLookupCacheEntry {
        // Makes no sense to pack types since reading memory is as fast as any op
        uint256 id;
        address moduleAddress;
        uint256 totalKeys;
        uint256 totalUsedKeys;
        uint256 totalStoppedKeys;
        uint256 totalExitedKeys;
        uint256 initialUsedSigningKeys;
        uint256 assignedKeys;
        uint256 cap;
        bool paused;
    }

    mapping (uint => StakingModule) internal modules;
    mapping (address => uint) internal modules_ids;
    uint internal modulesCount;

    //stake allocation module_index -> amount
    mapping (uint => uint) public allocation;
    uint internal totalAllocation;

    uint public lastDistribute;
    uint public timePeriod = 86400;

    constructor(address _lido, address _deposit_contract) {
        lido = _lido;
        deposit_contract = _deposit_contract;
        
    }

    function getModule(uint256 _id) external view
        returns (
            address moduleAddress,
            uint16 cap,
            bool paused
        )
    {
        //@todo check exists

        StakingModule memory entry = modules[_id];

        moduleAddress = entry.moduleAddress;
        cap = entry.cap;
        paused = entry.paused;
    }

    /**
      * @notice Returns total number of node operators
      */
    function getModulesCount() public view returns (uint256) {
        return modulesCount;
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
     * @param _moduleAddress address of module 
     * @param _cap soft cap 
     */
    function addStakingModule(string memory _name, address _moduleAddress, uint16 _cap) external {
        StakingModule storage module = modules[modulesCount];
        modules_ids[_moduleAddress] = modulesCount;

        module.name = _name;
        module.moduleAddress = _moduleAddress;
        module.cap = _cap;
        module.paused = false;
        modulesCount++;
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
     * Only callable by the owner.
     */
    function unpauseModule(uint256 _moduleIndex) external {
        require(msg.sender == dsm, "invalid_caller");

        StakingModule storage module = modules[_moduleIndex];
        if (module.paused) {
            module.paused = false;
            emit DepositsUnpaused();
        }
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
        for (uint256 i=0; i < modulesCount; ++i) {
            StakingModule memory module = modules[i];
            moduleKeys[i] = IModule(module.moduleAddress).getTotalKeys();
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
    function calculateShares2Mint(uint256 _totalRewards) external returns (
        uint256 shares2mint, 
        uint256 totalKeys,
        uint256[] memory moduleKeys
        ) {
        assert(modulesCount != 0);

        // calculate total used keys for operators
        moduleKeys = new uint256[](modulesCount);
        for (uint256 i=0; i < modulesCount; ++i) {
            StakingModule memory module = modules[i];
            moduleKeys[i] = IModule(module.moduleAddress).getTotalKeys();
            totalKeys += moduleKeys[i];
        }

        //calculate total fee to mint
        uint256 totalFee = 0;
        for (uint256 i=0; i < modulesCount; ++i) {
            StakingModule memory stakingModule = modules[i];
            IModule module = IModule(stakingModule.moduleAddress);

            uint256 moduleFeeBasisPoints = module.getFee();
            
            uint256 rewards = _totalRewards * moduleKeys[i] / totalKeys;

            uint256 opRewards = rewards * moduleFeeBasisPoints / TOTAL_BASIS_POINTS;

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
        
        shares2mint = ( totalFee * prevTotalShares ) / (totalSupply - totalFee);

        return (shares2mint, totalKeys, moduleKeys);
    }

    /**
    *  @dev External function to distribute reward to node operators
    *  @param _totalShares amount of shares to distribute
    *  @param _totalKeys total keys in modules
    *  @return distributed actual amount of shares that was transferred to modules as a rewards
    */
    function distributeShares(uint256 _totalShares, uint256 _totalKeys, uint256[] memory moduleKeys) external returns (uint256 distributed) {
        assert(_totalKeys > 0);
        require(address(lido) == msg.sender, "INVALID_CALLER");

        //distribute shares to modules
        distributed = 0;
        for (uint256 i=0; i < modulesCount; ++i) {
            StakingModule memory stakingModule = modules[i];
            IModule module = IModule(stakingModule.moduleAddress);

            // uint256 moduleTotalKeys = module.getTotalKeys();
            uint256 rewardsShares   = _totalShares * moduleKeys[i] / _totalKeys;

            //transfer from SR to recipient
            ILido(lido).transferShares(address(module), rewardsShares);

            distributed += rewardsShares;
        }

        // transfer remaining shares
        if (_totalShares - distributed > 0) {
            ILido(lido).transferShares(modules[0].moduleAddress, _totalShares - distributed);
        }
    } 

    function distributeDeposits() public {
    //    uint256 buffered = _getBufferedEther();
    //     if (buffered >= DEPOSIT_SIZE) {
    //         uint256 unaccounted = _getUnaccountedEther();
    //         uint256 numDeposits = buffered.div(DEPOSIT_SIZE);
    //         _markAsUnbuffered(_ETH2Deposit(numDeposits < _maxDeposits ? numDeposits : _maxDeposits));
    //         assert(_getUnaccountedEther() == unaccounted);
    //     }

        lastDistribute = block.timestamp;

        uint256 buffered = address(this).balance;
        uint256 numDeposits = buffered / DEPOSIT_SIZE;

        require(numDeposits > 0);

        ModuleLookupCacheEntry[] memory cache = getAllocation(numDeposits); //module-eth
        ModuleLookupCacheEntry memory entry;

        for(uint256 i=0; i< modulesCount; i++)  {
            entry = cache[i];
            allocation[i] = cache[i].assignedKeys;
        }
    }

    function getAllocation(uint256 _numDeposits) public view returns(ModuleLookupCacheEntry[] memory) {
        ModuleLookupCacheEntry[] memory cache = _loadModuleCache();
        ModuleLookupCacheEntry memory entry;

        (uint256 totalKeys, ) = getTotalKeys();

        uint256 assignedDeposits = 0;
        while(assignedDeposits < _numDeposits) {
            uint256 bestModuleIdx = modulesCount;
            uint256 smallestStake = 0;

            for(uint256 i=0; i < modulesCount; i++) {
                entry = cache[i];

                if (entry.totalUsedKeys == entry.totalKeys || entry.totalUsedKeys + entry.assignedKeys == entry.totalKeys) {
                    continue;
                }

                if (entry.paused) {
                    continue;
                }

                uint256 stake = entry.totalUsedKeys - entry.totalStoppedKeys - entry.totalExitedKeys;
                uint256 softCap = entry.cap;

                if (softCap > 0 && (entry.totalUsedKeys + entry.assignedKeys) * TOTAL_BASIS_POINTS / totalKeys  >= softCap) {
                    continue;
                }

                if (bestModuleIdx == modulesCount || stake < smallestStake) {
                    bestModuleIdx = i;
                    smallestStake = stake;
                }
            }

            if (bestModuleIdx == modulesCount)  // not found
                break;

            entry = cache[bestModuleIdx];
            // assert(entry.usedSigningKeys < UINT64_MAX);

            ++entry.assignedKeys;
            ++assignedDeposits;
        }

        require(assignedDeposits == _numDeposits, "INVALID_ASSIGNED_KEYS");

        return cache;
    }

    function _loadModuleCache() internal view returns (ModuleLookupCacheEntry[] memory cache) { 
        cache = new ModuleLookupCacheEntry[](modulesCount);
        if (0 == cache.length)
            return cache;

        uint256 idx = 0;
        for (uint256 i = 0; i < modulesCount; ++i) {
            StakingModule memory stakingModule = modules[i];
            IModule module = IModule(stakingModule.moduleAddress);

            ModuleLookupCacheEntry memory entry = cache[idx++];
            entry.id = i;
            entry.moduleAddress = stakingModule.moduleAddress;
            entry.totalKeys = module.getTotalKeys();
            entry.totalUsedKeys = module.getTotalUsedKeys();
            entry.totalStoppedKeys = module.getTotalStoppedKeys();
            entry.totalExitedKeys = module.getTotalExitedKeys();
            entry.cap = stakingModule.cap;
            entry.initialUsedSigningKeys = entry.totalUsedKeys;
            entry.paused = stakingModule.paused;
        }

        return cache;
    }

    /**
     * @dev Invokes a deposit call to the official Deposit contract
     * @param pubkeys Validators to stake for
     * @param signatures Signaturse of the deposit call
     */
    function deposit(bytes memory pubkeys, bytes memory signatures) external returns(uint256) {
        require(pubkeys.length > 0, "INVALID_PUBKEYS");

        require(pubkeys.length % PUBKEY_LENGTH == 0, "REGISTRY_INCONSISTENT_PUBKEYS_LEN");
        require(signatures.length % SIGNATURE_LENGTH == 0, "REGISTRY_INCONSISTENT_SIG_LEN");

        uint256 numKeys = pubkeys.length / PUBKEY_LENGTH;
        require(numKeys == signatures.length / SIGNATURE_LENGTH, "REGISTRY_INCONSISTENT_SIG_COUNT");


        uint moduleId = modules_ids[msg.sender];
        uint alloc = allocation[moduleId];
        IModule module = IModule(msg.sender);


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

        require( left > MAX_TIME / 2, "time threshold");

        
        uint unlocked = left * TOTAL_BASIS_POINTS / MAX_TIME;

        console.log('numKeys', numKeys);

        uint amount = 0;
        uint unlocked_amount = 0;
        for (uint i=0; i< modulesCount; i++) {
            if (i == moduleId) continue;

            unlocked_amount = (allocation[i] * unlocked ) / TOTAL_BASIS_POINTS;

            if (amount + unlocked_amount < numKeys) {
                amount += unlocked_amount;
                allocation[i] -= unlocked_amount;
            } else {
                uint a = numKeys - amount;
                amount += a;
                allocation[i] -= a;
            }
        }

        console.log('amount', amount);

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
        bytes32 withdrawalCredentials = getWithdrawalCredentials();
        require(withdrawalCredentials != 0, "EMPTY_WITHDRAWAL_CREDENTIALS");

        uint256 value = DEPOSIT_SIZE;

        // The following computations and Merkle tree-ization will make official Deposit contract happy
        uint256 depositAmount = value / DEPOSIT_AMOUNT_UNIT;
        assert(depositAmount * DEPOSIT_AMOUNT_UNIT == value);    // properly rounded

        // Compute deposit data root (`DepositData` hash tree root) according to deposit_contract.sol
        bytes32 pubkeyRoot = sha256(_pad64(_pubkey));
        bytes32 signatureRoot = sha256(
            abi.encodePacked(
                sha256(BytesLib.slice(_signature, 0, 64)),
                sha256(_pad64(BytesLib.slice(_signature, 64, SIGNATURE_LENGTH - 64 )))
            )
        );

        bytes32 depositDataRoot = sha256(
            abi.encodePacked(
                sha256(abi.encodePacked(pubkeyRoot, withdrawalCredentials)),
                sha256(abi.encodePacked(_toLittleEndian64(depositAmount), signatureRoot))
            )
        );

        uint256 targetBalance = address(this).balance - value;

        getDepositContract().deposit{value: value}(
            _pubkey, abi.encodePacked(withdrawalCredentials), _signature, depositDataRoot);
        require(address(this).balance == targetBalance, "EXPECTING_DEPOSIT_TO_HAPPEN");
    }

    function trimUnusedKeys() external {
        if (modulesCount > 0 ) {
             for (uint256 i = 0; i < modulesCount; ++i) {
                StakingModule memory stakingModule = modules[i];
                IModule module = IModule(stakingModule.moduleAddress);

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
    * @notice Returns current credentials to withdraw ETH on ETH 2.0 side after the phase 2 is launched
    */
    function getWithdrawalCredentials() public view returns (bytes32) {
        return ILido(lido).getWithdrawalCredentials();
    }

    /**
    * @dev Padding memory array with zeroes up to 64 bytes on the right
    * @param _b Memory array of size 32 .. 64
    */
    function _pad64(bytes memory _b) internal pure returns (bytes memory) {
        assert(_b.length >= 32 && _b.length <= 64);
        if (64 == _b.length)
            return _b;

        bytes memory zero32 = new bytes(32);
        assembly { mstore(add(zero32, 0x20), 0) }

        if (32 == _b.length)
            return BytesLib.concat(_b, zero32);
        else
            return BytesLib.concat(_b, BytesLib.slice(zero32, 0, uint256(64) - _b.length));
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

        assert(0 == temp_value);    // fully converted
        result <<= (24 * 8);
    }
}