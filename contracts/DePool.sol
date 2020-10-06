pragma solidity 0.4.24;

import "@aragon/os/contracts/apps/AragonApp.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "@aragon/os/contracts/lib/math/SafeMath64.sol";
import "@aragon/os/contracts/common/IsContract.sol";
import "solidity-bytes-utils/contracts/BytesLib.sol";

import "./interfaces/IDePool.sol";
import "./interfaces/ISTETH.sol";
import "./interfaces/IStakingProvidersRegistry.sol";
import "./interfaces/IValidatorRegistration.sol";

import "./lib/Pausable.sol";


/**
  * @title Liquid staking pool implementation
  *
  * See the comment of `IDePool`.
  *
  * NOTE: the code below assumes moderate amount of staking providers, e.g. up to 50.
  */
contract DePool is IDePool, IsContract, Pausable, AragonApp {
    using SafeMath for uint256;
    using SafeMath64 for uint64;
    using UnstructuredStorage for bytes32;

    /// ACL
    bytes32 constant public PAUSE_ROLE = keccak256("PAUSE_ROLE");
    bytes32 constant public MANAGE_FEE = keccak256("MANAGE_FEE");
    bytes32 constant public MANAGE_WITHDRAWAL_KEY = keccak256("MANAGE_WITHDRAWAL_KEY");
    bytes32 constant public SET_ORACLE = keccak256("SET_ORACLE");
    bytes32 constant public SET_DEPOSIT_ITERATION_LIMIT = keccak256("SET_DEPOSIT_ITERATION_LIMIT");

    uint256 constant public PUBKEY_LENGTH = 48;
    uint256 constant public WITHDRAWAL_CREDENTIALS_LENGTH = 32;
    uint256 constant public SIGNATURE_LENGTH = 96;

    uint256 constant public DEPOSIT_SIZE = 32 ether;

    uint256 internal constant MIN_DEPOSIT_AMOUNT = 1 ether;     // validator_registration.vy
    uint256 internal constant DEPOSIT_AMOUNT_UNIT = 1000000000 wei;     // validator_registration.vy

    bytes32 internal constant FEE_VALUE_POSITION = keccak256("depools.DePool.fee");
    bytes32 internal constant TREASURY_FEE_VALUE_POSITION = keccak256("depools.DePool.treasuryFee");
    bytes32 internal constant INSURANCE_FEE_VALUE_POSITION = keccak256("depools.DePool.insuranceFee");
    bytes32 internal constant SP_FEE_VALUE_POSITION = keccak256("depools.DePool.SPFee");

    bytes32 internal constant TOKEN_VALUE_POSITION = keccak256("depools.DePool.token");
    bytes32 internal constant VALIDATOR_REGISTRATION_VALUE_POSITION = keccak256("depools.DePool.validatorRegistration");
    bytes32 internal constant ORACLE_VALUE_POSITION = keccak256("depools.DePool.oracle");
    bytes32 internal constant SP_REGISTRY_VALUE_POSITION = keccak256("depools.DePool.spRegistry");

    /// @dev A base value for tracking earned rewards
    bytes32 internal constant REWARD_BASE_VALUE_POSITION = keccak256("depools.DePool.rewardBase");

    /// @dev amount of Ether (on the current Ethereum side) buffered on this smart contract balance
    bytes32 internal constant BUFFERED_ETHER_VALUE_POSITION = keccak256("depools.DePool.bufferedEther");
    /// @dev amount of Ether (on the current Ethereum side) deposited to the validator_registration.vy contract
    bytes32 internal constant DEPOSITED_ETHER_VALUE_POSITION = keccak256("depools.DePool.depositedEther");
    /// @dev amount of Ether (on the Ethereum 2.0 side) managed by the system
    bytes32 internal constant REMOTE_ETHER2_VALUE_POSITION = keccak256("depools.DePool.remoteEther2");

    /// @dev last epoch reported by the oracle
    bytes32 internal constant LAST_ORACLE_EPOCH_VALUE_POSITION = keccak256("depools.DePool.lastOracleEpoch");

    /// @dev maximum number of Ethereum 2.0 validators registered in a single transaction
    bytes32 internal constant DEPOSIT_ITERATION_LIMIT_VALUE_POSITION = keccak256("depools.DePool.depositIterationLimit");


    /// @dev Credentials which allows the DAO to withdraw Ether on the 2.0 side
    bytes private withdrawalCredentials;


    // Memory cache entry used in the _ETH2Deposit function
    struct DepositLookupCacheEntry {
        // Makes no sense to pack types since reading memory is as fast as any op
        uint256 id;
        uint256 stakingLimit;
        uint256 stoppedValidators;
        uint256 totalSigningKeys;
        uint256 usedSigningKeys;
        uint256 initialUsedSigningKeys; // for write-back control
    }


    function initialize(ISTETH _token, IValidatorRegistration validatorRegistration, address _oracle,
                        IStakingProvidersRegistry _sps, uint256 _depositIterationLimit)
        public onlyInit
    {
        _setToken(_token);
        _setValidatorRegistrationContract(validatorRegistration);
        _setOracle(_oracle);
        _setSPs(_sps);
        _setDepositIterationLimit(_depositIterationLimit);

        initialized();
    }


    /**
      * @notice Adds eth to the pool
      */
    function() external payable {
        _submit(0);
    }

    /**
      * @notice Adds eth to the pool with optional _referral parameter
      * @return StETH Amount of StETH generated
      */
    function submit(address _referral) external payable returns (uint256 StETH) {
        return _submit(_referral);
    }


    /**
      * @notice Stop pool routine operations
      */
    function stop() external auth(PAUSE_ROLE) {
        _stop();
    }

    /**
      * @notice Resume pool routine operations
      */
    function resume() external auth(PAUSE_ROLE) {
        _resume();
    }


    /**
      * @notice Set fee rate to `_feeBasisPoints` basis points. The fees are accrued when oracles report staking results
      * @param _feeBasisPoints Fee rate, in basis points
      */
    function setFee(uint16 _feeBasisPoints) external auth(MANAGE_FEE) {
        _setBPValue(FEE_VALUE_POSITION, _feeBasisPoints);
        emit FeeSet(_feeBasisPoints);
    }

    /**
      * @notice Set fee distribution: `_treasuryFeeBasisPoints` basis points go to the treasury, `_insuranceFeeBasisPoints` basis points go to the insurance fund, `_SPFeeBasisPoints` basis points go to staking providers. The sum has to be 10 000.
      */
    function setFeeDistribution(uint16 _treasuryFeeBasisPoints, uint16 _insuranceFeeBasisPoints,
                                uint16 _SPFeeBasisPoints) external auth(MANAGE_FEE)
    {
        require(10000 == uint256(_treasuryFeeBasisPoints).add(uint256(_insuranceFeeBasisPoints)).add(uint256(_SPFeeBasisPoints)),
                "FEES_DONT_ADD_UP");

        _setBPValue(TREASURY_FEE_VALUE_POSITION, _treasuryFeeBasisPoints);
        _setBPValue(INSURANCE_FEE_VALUE_POSITION, _insuranceFeeBasisPoints);
        _setBPValue(SP_FEE_VALUE_POSITION, _SPFeeBasisPoints);

        emit FeeDistributionSet(_treasuryFeeBasisPoints, _insuranceFeeBasisPoints, _SPFeeBasisPoints);
    }

    /**
      * @notice Set authorized oracle contract address to `_oracle`
      * @dev Contract specified here must periodically make `reportEther2` calls.
      */
    function setOracle(address _oracle) external auth(SET_ORACLE) {
        _setOracle(_oracle);
    }


    /**
      * @notice Set maximum number of Ethereum 2.0 validators registered in a single transaction.
      */
    function setDepositIterationLimit(uint256 _limit) external auth(SET_DEPOSIT_ITERATION_LIMIT) {
        _setDepositIterationLimit(_limit);
    }


    /**
      * @notice Set credentials to withdraw ETH on ETH 2.0 side after the phase 2 is launched to `_withdrawalCredentials`
      * @dev Note that setWithdrawalCredentials discards all unused signing keys as the signatures are invalidated.
      * @param _withdrawalCredentials hash of withdrawal multisignature key as accepted by
      *        the validator_registration.deposit function
      */
    function setWithdrawalCredentials(bytes _withdrawalCredentials) external auth(MANAGE_WITHDRAWAL_KEY) {
        require(_withdrawalCredentials.length == WITHDRAWAL_CREDENTIALS_LENGTH, "INVALID_LENGTH");

        withdrawalCredentials = _withdrawalCredentials;
        getSPs().trimUnusedKeys();

        emit WithdrawalCredentialsSet(_withdrawalCredentials);
    }


    /**
      * @notice Issues withdrawal request. Large withdrawals will be processed only after the phase 2 launch. WIP.
      * @param _amount Amount of StETH to burn
      * @param _pubkeyHash Receiving address
      */
    function withdraw(uint256 _amount, bytes32 _pubkeyHash) external whenNotStopped {
        revert("NOT_IMPLEMENTED_YET");
    }


    /**
      * @notice Ether on the ETH 2.0 side reported by the oracle
      * @param _eth2balance Balance in wei on the ETH 2.0 side
      */
    function reportEther2(uint256 _epoch, uint256 _eth2balance) external {
        require(msg.sender == getOracle(), "APP_AUTH_FAILED");
        require(0 != _epoch, "ZERO_EPOCH");

        if (_epoch <= LAST_ORACLE_EPOCH_VALUE_POSITION.getStorageUint256())
            return; // ignore old data

        LAST_ORACLE_EPOCH_VALUE_POSITION.setStorageUint256(_epoch);
        REMOTE_ETHER2_VALUE_POSITION.setStorageUint256(_eth2balance);

        // Calculating real amount of rewards
        uint256 rewardBase = REWARD_BASE_VALUE_POSITION.getStorageUint256();
        if (_eth2balance > rewardBase) {
            uint256 rewards = _eth2balance.sub(rewardBase);
            REWARD_BASE_VALUE_POSITION.setStorageUint256(_eth2balance);
            distributeRewards(rewards);
        }
    }


    /**
     * @notice Send funds to recovery Vault. Overrides default AragonApp behaviour.
     * @param _token Token to be sent to recovery vault.
     */
    function transferToVault(address _token) external {
        require(allowRecoverability(_token), "RECOVER_DISALLOWED");
        address vault = getRecoveryVault();
        require(isContract(vault), "RECOVER_VAULT_NOT_CONTRACT");

        uint256 balance;
        if (_token == ETH) {
            balance = _getUnaccountedEther();
            vault.transfer(balance);
        } else {
            ERC20 token = ERC20(_token);
            balance = token.staticBalanceOf(this);
            require(token.safeTransfer(vault, balance), "RECOVER_TOKEN_TRANSFER_FAILED");
        }

        emit RecoverToVault(vault, _token, balance);
    }


    /**
      * @notice Returns staking rewards fee rate
      */
    function getFee() external view returns (uint16 feeBasisPoints) {
        return _getFee();
    }

    /**
      * @notice Returns fee distribution proportion
      */
    function getFeeDistribution() external view returns (uint16 treasuryFeeBasisPoints, uint16 insuranceFeeBasisPoints,
                                                         uint16 SPFeeBasisPoints)
    {
        return _getFeeDistribution();
    }

    /**
      * @notice Returns current credentials to withdraw ETH on ETH 2.0 side after the phase 2 is launched
      */
    function getWithdrawalCredentials() external view returns (bytes) {
        return withdrawalCredentials;
    }


    /**
      * @notice Gets the amount of Ether temporary buffered on this contract balance
      */
    function getBufferedEther() external view returns (uint256) {
        return _getBufferedEther();
    }

    /**
      * @notice Gets the amount of Ether controlled by the system
      */
    function getTotalControlledEther() external view returns (uint256) {
        return _getTotalControlledEther();
    }


    /**
      * @notice Gets liquid token interface handle
      */
    function getToken() public view returns (ISTETH) {
        return ISTETH(TOKEN_VALUE_POSITION.getStorageAddress());
    }

    /**
      * @notice Gets validator registration contract handle
      */
    function getValidatorRegistrationContract() public view returns (IValidatorRegistration) {
        return IValidatorRegistration(VALIDATOR_REGISTRATION_VALUE_POSITION.getStorageAddress());
    }

    /**
      * @notice Gets authorized oracle address
      */
    function getOracle() public view returns (address) {
        return ORACLE_VALUE_POSITION.getStorageAddress();
    }

    /**
      * @notice Gets maximum number of Ethereum 2.0 validators registered in a single transaction
      */
    function getDepositIterationLimit() public view returns (uint256) {
        return DEPOSIT_ITERATION_LIMIT_VALUE_POSITION.getStorageUint256();
    }

    /**
      * @notice Gets staking providers registry interface handle
      */
    function getSPs() public view returns (IStakingProvidersRegistry) {
        return IStakingProvidersRegistry(SP_REGISTRY_VALUE_POSITION.getStorageAddress());
    }

    /**
      * @notice Returns the treasury address
      */
    function getTreasury() public view returns (address) {
        address vault = getRecoveryVault();
        require(isContract(vault), "RECOVER_VAULT_NOT_CONTRACT");
        return vault;
    }

    /**
      * @notice Returns the insurance fund address
      */
    function getInsuranceFund() public view returns (address) {
        // TODO a separate vault
        return getTreasury();
    }

    /**
      * @notice Gets the stat of the system's Ether on the Ethereum 2 side
      * @return deposited Amount of Ether deposited from the current Ethereum
      * @return remote Amount of Ether currently present on the Ethereum 2 side (can be 0 if the Ethereum 2 is yet to be launch
      */
    function getEther2Stat() external view returns (uint256 deposited, uint256 remote) {
        deposited = DEPOSITED_ETHER_VALUE_POSITION.getStorageUint256();
        remote = REMOTE_ETHER2_VALUE_POSITION.getStorageUint256();
    }


    /**
      * @dev Sets liquid token interface handle
      */
    function _setToken(ISTETH _token) internal {
        require(isContract(address(_token)), "NOT_A_CONTRACT");
        TOKEN_VALUE_POSITION.setStorageAddress(address(_token));
    }

    /**
      * @dev Sets validator registration contract handle
      */
    function _setValidatorRegistrationContract(IValidatorRegistration _contract) internal {
        require(isContract(address(_contract)), "NOT_A_CONTRACT");
        VALIDATOR_REGISTRATION_VALUE_POSITION.setStorageAddress(address(_contract));
    }

    /**
      * @dev Internal function to set authorized oracle address
      */
    function _setOracle(address _oracle) internal {
        require(isContract(_oracle), "NOT_A_CONTRACT");
        ORACLE_VALUE_POSITION.setStorageAddress(_oracle);
    }

    /**
      * @dev Internal function to set staking provider registry address
      */
    function _setSPs(IStakingProvidersRegistry _r) internal {
        require(isContract(_r), "NOT_A_CONTRACT");
        SP_REGISTRY_VALUE_POSITION.setStorageAddress(_r);
    }

    /**
      * @notice Internal function to set deposit loop iteration limit
      */
    function _setDepositIterationLimit(uint256 _limit) internal {
        require(0 != _limit, "ZERO_LIMIT");
        DEPOSIT_ITERATION_LIMIT_VALUE_POSITION.setStorageUint256(_limit);
    }


    /**
      * @dev Processes user deposit
      */
    function _submit(address _referral) internal whenNotStopped returns (uint256 StETH) {
        address sender = msg.sender;
        uint256 deposit = msg.value;

        if (0 != deposit) {
            // Minting new liquid tokens
            if (0 == _getTotalControlledEther()) {
                StETH = deposit;
            } else {
                assert(getToken().totalSupply() != 0);
                StETH = deposit.mul(getToken().totalSupply()).div(_getTotalControlledEther());
            }
            getToken().mint(sender, StETH);

            _submitted(sender, deposit, _referral);
        }

        // Buffer management
        uint256 buffered = _getBufferedEther();
        if (buffered >= DEPOSIT_SIZE) {
            uint256 unaccounted = _getUnaccountedEther();

            uint256 toUnbuffer = buffered.div(DEPOSIT_SIZE).mul(DEPOSIT_SIZE);
            assert(toUnbuffer <= buffered && toUnbuffer != 0);

            _markAsUnbuffered(_ETH2Deposit(toUnbuffer));

            assert(_getUnaccountedEther() == unaccounted);
        }
    }

    /**
      * @dev Makes a deposit to the ETH 2.0 side
      * @param _amount Total amount to deposit to the ETH 2.0 side
      * @return actually deposited amount
      */
    function _ETH2Deposit(uint256 _amount) internal returns (uint256) {
        assert(_amount >= MIN_DEPOSIT_AMOUNT);

        // Memory is very cheap, although you don't want to grow it too much.
        DepositLookupCacheEntry[] memory cache = _load_SP_cache();
        if (0 == cache.length)
            return 0;

        uint256 totalDepositCalls = 0;
        uint256 maxDepositCalls = getDepositIterationLimit();
        while (_amount != 0 && totalDepositCalls < maxDepositCalls) {
            // Finding the best suitable SP
            uint256 bestSPidx = cache.length;   // 'not found' flag
            uint256 smallestStake;
            // The loop is ligthweight comparing to an ether transfer and .deposit invocation
            for (uint256 idx = 0; idx < cache.length; ++idx) {
                DepositLookupCacheEntry memory entry = cache[idx];

                assert(entry.usedSigningKeys <= entry.totalSigningKeys);
                if (entry.usedSigningKeys == entry.totalSigningKeys)
                    continue;

                uint256 stake = entry.usedSigningKeys.sub(entry.stoppedValidators);
                if (stake + 1 > entry.stakingLimit)
                    continue;

                if (bestSPidx == cache.length || stake < smallestStake) {
                    bestSPidx = idx;
                    smallestStake = stake;
                }
            }

            if (bestSPidx == cache.length)  // not found
                break;

            // Invoking deposit for the best SP
            _amount = _amount.sub(DEPOSIT_SIZE);
            ++totalDepositCalls;

            (bytes memory key, bytes memory signature, bool used) =
                    getSPs().getSigningKey(cache[bestSPidx].id, cache[bestSPidx].usedSigningKeys++);
            assert(!used);

            // finally, stake the notch for the assigned validator
            _stake(key, signature);
        }

        uint256 deposited = totalDepositCalls.mul(DEPOSIT_SIZE);
        if (0 != deposited) {
            REWARD_BASE_VALUE_POSITION.setStorageUint256(REWARD_BASE_VALUE_POSITION.getStorageUint256().add(deposited));
            _write_back_SP_cache(cache);
        }

        return deposited;
    }

    /**
      * @dev Invokes a validator_registration.deposit call
      * @param _pubkey Validator to stake for
      * @param _signature Signature of the deposit call
      */
    function _stake(bytes memory _pubkey, bytes memory _signature) internal {
        require(withdrawalCredentials.length != 0, "EMPTY_WITHDRAWAL_CREDENTIALS");

        uint256 value = DEPOSIT_SIZE;

        // The following computations and Merkle tree-ization will make validator_registration.vy happy
        uint256 depositAmount = value.div(DEPOSIT_AMOUNT_UNIT);
        assert(depositAmount.mul(DEPOSIT_AMOUNT_UNIT) == value);    // properly rounded

        // Compute deposit data root (`DepositData` hash tree root) according to validator_registration.vy
        bytes32 pubkeyRoot = keccak256(_pad64(_pubkey));
        bytes32 signatureRoot = keccak256(abi.encodePacked(
            keccak256(BytesLib.slice(_signature, 0, 64)),
            keccak256(_pad64(BytesLib.slice(_signature, 64, SIGNATURE_LENGTH.sub(64))))
        ));

        bytes32 depositDataRoot = keccak256(abi.encodePacked(
            keccak256(abi.encodePacked(pubkeyRoot, withdrawalCredentials)),
            keccak256(abi.encodePacked(_toLittleEndian64(depositAmount), signatureRoot))
        ));

        uint256 targetBalance = address(this).balance.sub(value);

        getValidatorRegistrationContract().deposit.value(value)(
            _pubkey, withdrawalCredentials, _signature, depositDataRoot);
        require(address(this).balance == targetBalance, "EXPECTING_DEPOSIT_TO_HAPPEN");
    }

    /**
      * @dev Distributes rewards and fees.
      * @param _rewards Total rewards accrued on the Ethereum 2.0 side.
      */
    function distributeRewards(uint256 _rewards) internal {
        // Amount of the rewards in Ether
        uint256 protocolRewards = _rewards.mul(_getFee()).div(10000);

        assert(0 != getToken().totalSupply());
        // Amount of StETH we should mint to distribute protocolRewards by diluting the totalSupply
        uint256 tokens2mint = protocolRewards.mul(getToken().totalSupply()).div(
            _getTotalControlledEther().sub(protocolRewards));

        (uint16 treasuryFeeBasisPoints, uint16 insuranceFeeBasisPoints, ) = _getFeeDistribution();
        uint256 toTreasury = tokens2mint.mul(treasuryFeeBasisPoints).div(10000);
        uint256 toInsuranceFund = tokens2mint.mul(insuranceFeeBasisPoints).div(10000);
        uint256 toSP = tokens2mint.sub(toTreasury).sub(toInsuranceFund);

        getToken().mint(getTreasury(), toTreasury);
        getToken().mint(getInsuranceFund(), toInsuranceFund);
        getToken().mint(address(getSPs()), toSP);
        getSPs().distributeRewards(address(getToken()), toSP);
    }


    /**
      * @dev Records a deposit made by a user with optional referral
      * @param _value Deposit value in wei
      */
    function _submitted(address _sender, uint256 _value, address _referral) internal {
        BUFFERED_ETHER_VALUE_POSITION.setStorageUint256(_getBufferedEther().add(_value));

        emit Submitted(_sender, _value, _referral);
    }

    /**
      * @dev Records a deposit to the validator_registration.deposit function.
      * @param _amount Total amount deposited to the ETH 2.0 side
      */
    function _markAsUnbuffered(uint256 _amount) internal {
        DEPOSITED_ETHER_VALUE_POSITION.setStorageUint256(
            DEPOSITED_ETHER_VALUE_POSITION.getStorageUint256().add(_amount));
        BUFFERED_ETHER_VALUE_POSITION.setStorageUint256(
            BUFFERED_ETHER_VALUE_POSITION.getStorageUint256().sub(_amount));

        emit Unbuffered(_amount);
    }

    /**
      * @dev Write a value nominated in basis points
      */
    function _setBPValue(bytes32 _slot, uint16 _value) internal {
        require(_value <= 10000, "VALUE_OVER_100_PERCENT");
        _slot.setStorageUint256(uint256(_value));
    }

    /**
      * @dev Write back updated usedSigningKeys SP values
      */
    function _write_back_SP_cache(DepositLookupCacheEntry[] memory cache) internal {
        uint256 updateSize;
        for (uint256 idx = 0; idx < cache.length; ++idx) {
            if (cache[idx].usedSigningKeys > cache[idx].initialUsedSigningKeys)
                updateSize++;
        }
        if (0 == updateSize)
            return;

        uint256[] memory ids = new uint256[](updateSize);
        uint64[] memory usedSigningKeys = new uint64[](updateSize);
        uint256 i;
        for (idx = 0; idx < cache.length; ++idx) {
            if (cache[idx].usedSigningKeys > cache[idx].initialUsedSigningKeys) {
                ids[i] = cache[idx].id;
                usedSigningKeys[i] = to64(cache[idx].usedSigningKeys);
                i++;
            }
        }
        assert(i == updateSize);

        getSPs().updateUsedKeys(ids, usedSigningKeys);
    }


    /**
      * @dev Returns staking rewards fee rate
      */
    function _getFee() internal view returns (uint16) {
        return _readBPValue(FEE_VALUE_POSITION);
    }

    /**
      * @dev Returns fee distribution proportion
      */
    function _getFeeDistribution() internal view
        returns (uint16 treasuryFeeBasisPoints, uint16 insuranceFeeBasisPoints, uint16 SPFeeBasisPoints)
    {
        treasuryFeeBasisPoints = _readBPValue(TREASURY_FEE_VALUE_POSITION);
        insuranceFeeBasisPoints = _readBPValue(INSURANCE_FEE_VALUE_POSITION);
        SPFeeBasisPoints = _readBPValue(SP_FEE_VALUE_POSITION);
    }

    /**
      * @dev Read a value nominated in basis points
      */
    function _readBPValue(bytes32 _slot) internal view returns (uint16) {
        uint256 v = _slot.getStorageUint256();
        assert(v <= 10000);
        return uint16(v);
    }

    /**
      * @dev Gets the amount of Ether temporary buffered on this contract balance
      */
    function _getBufferedEther() internal view returns (uint256) {
        uint256 buffered = BUFFERED_ETHER_VALUE_POSITION.getStorageUint256();
        assert(address(this).balance >= buffered);

        return buffered;
    }

    /**
      * @dev Gets unaccounted (excess) Ether on this contract balance
      */
    function _getUnaccountedEther() internal view returns (uint256) {
        return address(this).balance.sub(_getBufferedEther());
    }

    /**
      * @dev Returns true if the oracle ever provided data
      */
    function _hasOracleData() internal view returns (bool) {
        return 0 != LAST_ORACLE_EPOCH_VALUE_POSITION.getStorageUint256();
    }

    /**
      * @dev Gets the amount of Ether controlled by the system
      */
    function _getTotalControlledEther() internal view returns (uint256) {
        uint256 remote = REMOTE_ETHER2_VALUE_POSITION.getStorageUint256();
        // Until the oracle provides data, we assume that all staked ether is intact.
        uint256 deposited = DEPOSITED_ETHER_VALUE_POSITION.getStorageUint256();

        uint256 assets = _getBufferedEther().add(_hasOracleData() ? remote : deposited);

        return assets;
    }

    function _load_SP_cache() internal view returns (DepositLookupCacheEntry[] memory cache) {
        IStakingProvidersRegistry sps = getSPs();
        cache = new DepositLookupCacheEntry[](sps.getActiveStakingProvidersCount());
        if (0 == cache.length)
            return cache;

        uint256 idx = 0;
        for (uint256 SP_id = sps.getStakingProvidersCount().sub(1); ; SP_id = SP_id.sub(1)) {
            (
                bool active, , ,
                uint64 stakingLimit,
                uint64 stoppedValidators,
                uint64 totalSigningKeys,
                uint64 usedSigningKeys
            ) = sps.getStakingProvider(SP_id, false);
            if (!active)
                continue;

            DepositLookupCacheEntry memory cached = cache[idx++];
            cached.id = SP_id;
            cached.stakingLimit = stakingLimit;
            cached.stoppedValidators = stoppedValidators;
            cached.totalSigningKeys = totalSigningKeys;
            cached.usedSigningKeys = usedSigningKeys;
            cached.initialUsedSigningKeys = usedSigningKeys;

            if (0 == SP_id)
                break;
        }
        require(idx == cache.length, "SP_REGISTRY_INCOSISTENCY");
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
            return BytesLib.concat(_b, BytesLib.slice(zero32, 0, uint256(64).sub(_b.length)));
    }

    /**
      * @dev Converting value to little endian bytes and padding up to 32 bytes on the right
      * @param _value Number less than `2**64` for compatibility reasons
      */
    function _toLittleEndian64(uint256 _value) internal pure returns (uint256 result) {
        result = 0;
        for (uint256 i = 0; i < 8; ++i) {
            result = (result << 8) | (_value & 0xFF);
            _value >>= 8;
        }

        assert(0 == _value);    // fully converted
        result <<= (24 * 8);
    }

    function to64(uint256 v) internal pure returns (uint64) {
        assert(v <= uint256(uint64(-1)));
        return uint64(v);
    }
}
