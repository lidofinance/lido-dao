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
    uint256 constant public WITHDRAWAL_CREDENTIALS_LENGTH = 32;
    uint256 constant public SIGNATURE_LENGTH = 96;

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
        uint256 initialUsedSigningKeys;
        uint256 assignedKeys;
        uint256 softCap;
    }

    mapping (uint256 => StakingModule) public modules;
    mapping (address => uint256) public modules_deposits;

    uint256 public modulesCount;    

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
     * @param _moduleAddress address of module 
     * @param _cap soft cap 
     */
    function addStakingModule(string memory _name, address _moduleAddress, uint16 _cap) external {
        StakingModule storage module = modules[modulesCount];
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
    function getTotalKeys() external view returns (uint256 totalKeys, uint256[] memory moduleKeys) {
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
    function calculateShares2Mint(uint256 _totalRewards) external 
    returns (
        uint256 shares2mint, 
        uint256 totalKeys,
        uint256[] memory moduleKeys) 
    {
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

    function distributeDeposits(uint256 _numDeposits) public returns(ModuleLookupCacheEntry[] memory) {
        ModuleLookupCacheEntry[] memory cache = getModulesDeposits(_numDeposits); //module-eth
        ModuleLookupCacheEntry memory entry;

        
        for(uint256 i=0; i< modulesCount; i++)  {
            entry = cache[i];

            if (entry.assignedKeys == 0)
                continue;

            IModule module = IModule(entry.moduleAddress);
            
            (bytes memory pubkeys, bytes memory signatures) = module.assignNextSigningKeys(entry.assignedKeys);
            emit KeysAssigned(pubkeys, signatures);
        }

        return cache;
    }

    function getModulesDeposits(uint256 _numDeposits) public view returns(ModuleLookupCacheEntry[] memory) {

        ModuleLookupCacheEntry[] memory cache = _loadModuleCache();
        ModuleLookupCacheEntry memory entry;

        uint256 assignedDeposits = 0;
        while(assignedDeposits < _numDeposits) {
            uint256 bestModuleIdx = modulesCount;

            uint256 smallestStake = 0;

            for(uint256 i=0; i < modulesCount; i++) {
                entry = cache[i];

                if (entry.totalUsedKeys == entry.totalKeys || entry.totalUsedKeys + entry.assignedKeys == entry.totalKeys) {
                    continue;
                }

                uint256 stake = entry.totalUsedKeys - entry.totalStoppedKeys;
                uint256 softCap = entry.softCap;
                if (softCap > 0 && entry.assignedKeys * TOTAL_BASIS_POINTS / _numDeposits  >= softCap) {
                    continue;
                }

                if (bestModuleIdx == modulesCount || stake < smallestStake) {
                    bestModuleIdx = i;
                    smallestStake = stake;
                }
            }

            //выход и по ключам и по эфиру
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
            entry.softCap = stakingModule.cap;
            entry.initialUsedSigningKeys = entry.totalUsedKeys;
        }

        return cache;
    }

    function deposit(bytes memory pubkeys, bytes memory signatures) external {
        require(pubkeys.length > 0, "INVALID_PUBKEYS");

        require(pubkeys.length % PUBKEY_LENGTH == 0, "REGISTRY_INCONSISTENT_PUBKEYS_LEN");
        require(signatures.length % SIGNATURE_LENGTH == 0, "REGISTRY_INCONSISTENT_SIG_LEN");

        uint256 numKeys = pubkeys.length / PUBKEY_LENGTH;
        require(numKeys == signatures.length / SIGNATURE_LENGTH, "REGISTRY_INCONSISTENT_SIG_COUNT");

        for (uint256 i = 0; i < numKeys; ++i) {
            bytes memory pubkey = BytesLib.slice(pubkeys, i * PUBKEY_LENGTH, PUBKEY_LENGTH);
            bytes memory signature = BytesLib.slice(signatures, i * SIGNATURE_LENGTH, SIGNATURE_LENGTH);
            _stake(pubkey, signature);
        }

        //update DEPOSITED_VALIDATORS_POSITION on LIDO
        ILido(lido).updateBufferedCounters(numKeys);
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
        uint256 depositAmount = value % DEPOSIT_AMOUNT_UNIT;
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