// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>
//
// SPDX-License-Identifier: GPL-3.0
//
pragma solidity 0.8.9;

import "hardhat/console.sol";
import "./IModule.sol";

import "hardhat/console.sol";

interface ILido {
    function totalSupply() external view returns (uint256);
    function getTotalShares() external view returns (uint256);
    function mintShares(uint256 _shares2mint) external;
    function transferModuleShares(address _recipient, uint256 _sharesAmount) external returns (uint256);
}


contract StakingRouter {
    //////for test
    event KeysAssigned(bytes pubkeys, bytes signatures);
    //////

    error InvalidType();

    address public immutable lido;

    uint256 internal constant TOTAL_BASIS_POINTS = 10000;

    // uint256 internal constant UINT64_MAX = uint256(uint64(-1));

    struct StakingModule{
        string name;
        address moduleAddress;
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

    mapping (uint => StakingModule) public modules;
    uint256 public modulesCount;
    

    constructor(address _lido) {
        lido = _lido;

    }

    /**
     *
     * Register a new module
     * 
     */
    function addStakingModule(string memory _name, address _pluginAddress) external {

        StakingModule storage module = modules[modulesCount];
        module.name = _name;
        module.moduleAddress = _pluginAddress;
        modulesCount++;
    }

    /**
     *
     * Distribute rewards
     * 
     * _totalRewards 
     */
    function distributeRewards(uint256 _totalRewards) external {


        // calculate total used keys for operators
        uint256 totalKeys = 0;
        for (uint256 i=0; i < modulesCount; ++i) {
            StakingModule memory module = modules[i];
            totalKeys += IModule(module.moduleAddress).getTotalKeys();
        }


        //calculate total fee to mint
        uint256 totalFee = 0;
        for (uint256 i=0; i < modulesCount; ++i) {
            StakingModule memory stakingModule = modules[i];
            IModule module = IModule(stakingModule.moduleAddress);

            uint256 moduleFeeBasisPoints = module.getFee();
            uint256 moduleTotalKeys       = module.getTotalKeys();
            
            uint256 rewards = _totalRewards * moduleTotalKeys / totalKeys;

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
        
        uint256 shares2mint = ( totalFee * prevTotalShares ) / (totalSupply - totalFee);

        ILido(lido).mintShares(shares2mint);

        //distribute shares to modules
        for (uint256 i=0; i < modulesCount; ++i) {
            StakingModule memory stakingModule = modules[i];
            IModule module = IModule(stakingModule.moduleAddress);

            uint256 moduleTotalKeys = module.getTotalKeys();
            uint256 rewardsShares   = shares2mint * moduleTotalKeys / totalKeys;

            ILido(lido).transferModuleShares(
                stakingModule.moduleAddress,
                rewardsShares
            );
        }


        //get recipient -> shares map for distribution
        // (uint256 treasuryShares, address[] memory recipients, uint256[] memory shares) = distributeShares(shares2mint, totalKeys, moduleUsedKeys);

        //distribute to treasury
        // ILido(lido).transferShares(treasuryAddress, treasuryShares);

        //calc % module
        //transfer to module -> claim
        //rocketpool ??


        //remain shares
        // uint256 toTreasury = shares2mint - treasuryShares - distributed;
        // ILido(lido).transferShares(treasuryAddress, treasuryShares);
    } 

    function eth2deposit(uint256 _numDeposits) public returns(ModuleLookupCacheEntry[] memory) {
        ModuleLookupCacheEntry[] memory cache = getModuleDeposits(_numDeposits);
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

    function getModuleDeposits(uint256 _numDeposits) public view returns(ModuleLookupCacheEntry[] memory) {

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

                //check soft cap
            
                //check module quota

                uint256 softCap = entry.softCap;
                if (softCap > 0 && entry.assignedKeys * TOTAL_BASIS_POINTS / _numDeposits  >= softCap) {
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
            entry.softCap = module.getSoftCap();
            entry.initialUsedSigningKeys = entry.totalUsedKeys;
        }

        return cache;
    }

    // function getNextModule() public returns (StakingModule memory) {
    //     for (uint256 i=0; i < modulesCount; ++i) {
    //         StakingModule storage module = modules[i];
    //         module.currentWeight += module.weight;
    //     }

    //     uint256 cw = 0;
    //     uint256 index = 0;

    //     for (uint256 i=0; i < modulesCount; ++i) {
    //         StakingModule memory module = modules[i];
    //         if (cw < module.currentWeight) {
    //             cw = module.currentWeight;
    //             index = i;
    //         }
    //     }

    //     nextModule = index;

    //     updateWeight(index);
    //     StakingModule memory module = modules[index];
    //     return module;
    // }

    // function updateWeight(uint256 index) public {
    //     for (uint256 i=0; i < modulesCount; ++i) {
    //         if (i == index) {
    //             StakingModule storage module = modules[i];

    //             module.currentWeight -= getTotalWeight();
            
    //         }
    //     }
    // }

    // function getTotalWeight() public view returns(uint256) {
    //     uint256 totalWeight = 0;
    //     for (uint256 i=0; i < modulesCount; ++i) {
    //         StakingModule memory module = modules[i];
    //         totalWeight += module.weight;
    //     }
    //     return totalWeight;
    // }

    // function getNextWRRModule() public returns (StakingModule memory) {
        // while (true) {
        //     b.i = (b.i + 1) % b.n
        //     if b.i == 0 {
        //         b.cw = b.cw - b.gcd
        //         if b.cw <= 0 {
        //             b.cw = b.max
        //             if b.cw == 0 {
        //                 return nil
        //             }
        //         }
        //     }

        //     if b.items[b.i].Weight >= b.cw {
        //         return b.items[b.i]
        //     }
        // }
    // }

    // function gcd(uint256 a, uint256 b) public returns(uint256){
    //     if (b == 0) {
    //         return a;
    //     }
    //     return gcd(b, a % b);
    // }
    

    



    // function getOperatorsRewardsDistribution(uint256 _totalRewardShares) external view
    //     returns (
    //         address[] memory recipients,
    //         uint256[] memory shares
    //     )
    // {
    //     // get solo deposited eth
    //     // ILIDO(lido).balanceOf(solo)
    //     // 


    //      // calculate shares for Pro/Solo           
    //     sharesRewardsPro = _totalRewardShares * getProFee() / 100
    //     sharesRewardsSolo = _totalRewardShares * getSoloFee() / 100

        // if keys remains add to PRO, or we can implement largest-remainder method (Hare–Niemeyer method)
        // sharesRemains = _totalRewardShares - sharesRewardsPro - sharesRewardsSolo
        // if (sharesRemains > 0 ) {
        //     sharesRewardsPro += sharesRemains
        // }

    //     (address[] memory recipientsPro, uint256[] memory sharesPro) = NodeOperator(PRO).getRewardsDistribution(sharesRewardsPro);
    //     (address[] memory recipientsSolo, uint256[] memory sharesSolo) = NodeOperator(SOLO).getRewardsDistribution(sharesRewardsSolo);

    //     recipients = new address[](recipientsPro.length + recipientsSolo.length);
    //     shares = new uint256[](sharesPro.length + sharesSolo.length);

    //     uint256 idx = 0;
    //     for (uint256 i = 0; i < recipientsPro.length; ++i) {
    //         recipients[idx] = recipientsPro[idx]
    //         shares[idx] = sharesPro[idx]
    //         ++idx;
    //     }
    //     for (uint256 i = 0; i < recipientsSolo.length; ++i) {
    //         recipients[idx] = recipientsSolo[idx]
    //         shares[idx] = sharesSolo[idx]
    //         ++idx;
    //     }

    //     return (recipients, shares);
    // }

    // function getOperatorsKeys(uint256 _numDeposits) public returns (bytes memory pubkeys, bytes memory signatures) {

        

    //     // calculate numDeposits for Pro/Solo           
    //     numDepositKeysPro = _numDeposits * getProFee() / 100
    //     numDepositKeysSolo = _numDeposits * getSoloFee() / 100

    //     // if keys remains add to PRO, or we can implement largest-remainder method (Hare–Niemeyer method)
    //     keysRemains = _numDeposits - numDepositKeysPro - numDepositKeysSolo
    //     if (keysRemains > 0 ) {
    //         numDepositKeysPro += keysRemains
    //     }

    //     require(_numDeposits == numDepositKeysPro + numDepositKeysSolo)

    //     (bytes memory pubkeysPro, bytes memory signaturesPro) = NodeOperator(PRO).assignNextSigningKeys(numDepositKeysPro);
    //     (bytes memory pubkeysSolo, bytes memory signaturesSolo) = NodeOperator(SOLO).assignNextSigningKeys(numDepositKeysSolo);

    //     //combine keys 
    //     pubkeys = BytesLib.concat(pubkeysPro, pubkeysSolo)
    //     signatures = BytesLib.concat(signaturesPro, signaturesSolo)

    //     return (pubkeys, signatures)
    // }

    // /**
    // * @dev Performs deposits to the ETH 2.0 side
    // * @param _numDeposits Number of deposits to perform
    // * @return actually deposited Ether amount
    // */
    // function ETH2Deposit(uint256 _numDeposits) external returns (uint256) {
    //     (bytes memory pubkeys, bytes memory signatures) = getOperatorsKeys(_numDeposits);

    //     if (pubkeys.length == 0) {
    //         return 0;
    //     }

    //     require(pubkeys.length.mod(PUBKEY_LENGTH) == 0, "REGISTRY_INCONSISTENT_PUBKEYS_LEN");
    //     require(signatures.length.mod(SIGNATURE_LENGTH) == 0, "REGISTRY_INCONSISTENT_SIG_LEN");

    //     uint256 numKeys = pubkeys.length.div(PUBKEY_LENGTH);
    //     require(numKeys == signatures.length.div(SIGNATURE_LENGTH), "REGISTRY_INCONSISTENT_SIG_COUNT");

    //     for (uint256 i = 0; i < numKeys; ++i) {
    //         bytes memory pubkey = BytesLib.slice(pubkeys, i * PUBKEY_LENGTH, PUBKEY_LENGTH);
    //         bytes memory signature = BytesLib.slice(signatures, i * SIGNATURE_LENGTH, SIGNATURE_LENGTH);
    //         _stake(pubkey, signature);
    //     }

    //     //Lido.setDepositedValidators(numKeys)
    //     DEPOSITED_VALIDATORS_POSITION.setStorageUint256(
    //         DEPOSITED_VALIDATORS_POSITION.getStorageUint256().add(numKeys)
    //     );

    //     return numKeys.mul(DEPOSIT_SIZE);
    // }

    // function setProFee(uint16 _operatorsFeeBasisPoints) {
    //     _setBPValue(PRO_OPERATORS_FEE, _treasuryFeeBasisPoints);
    // }

    // function getProFee() public view returns (uint16 operatorsFeeBasisPoints){
    //     operatorsFeeBasisPoints = uint16(PRO_OPERATORS_FEE.getStorageUint256());
    // }

    // function setSoloFee(uint16 _operatorsFeeBasisPoints) {
    //     _setBPValue(SOLO_OPERATORS_FEE, _treasuryFeeBasisPoints);
    // }

    // function getSoloFee()  public view returns (uint16 operatorsFeeBasisPoints){
    //     operatorsFeeBasisPoints = uint16(SOLO_OPERATORS_FEE.getStorageUint256());
    // }

    // /**
    // * @dev Write a value nominated in basis points
    // */
    // function _setBPValue(bytes32 _slot, uint16 _value) internal {
    //     require(_value <= TOTAL_BASIS_POINTS, "VALUE_OVER_100_PERCENT");
    //     _slot.setStorageUint256(uint256(_value));
    // }


}