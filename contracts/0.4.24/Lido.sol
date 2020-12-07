// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.4.24;

import "@aragon/os/contracts/apps/AragonApp.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "@aragon/os/contracts/lib/math/SafeMath64.sol";
import "@aragon/os/contracts/common/IsContract.sol";
import "solidity-bytes-utils/contracts/BytesLib.sol";

import "./interfaces/ILido.sol";
import "./interfaces/INodeOperatorsRegistry.sol";
import "./interfaces/IValidatorRegistration.sol";

import "./StETH.sol";


/**
* @title Liquid staking pool implementation
*
* Lido is an Ethereum 2.0 liquid staking protocol solving the problem of frozen staked Ethers
* until transfers become available in Ethereum 2.0.
* Whitepaper: https://lido.fi/static/Lido:Ethereum-Liquid-Staking.pdf
*
* NOTE: the code below assumes moderate amount of node operators, e.g. up to 50.
*
* Since balances of all token holders change when the amount of total pooled Ether
* changes, this token cannot fully implement ERC20 standard: it only emits `Transfer`
* events upon explicit transfer between holders. In contrast, when Lido oracle reports
* rewards, no Transfer events are generated: doing so would require emitting an event
* for each token holder and thus running an unbounded loop.
*/
contract Lido is ILido, IsContract, StETH, AragonApp {
    using SafeMath for uint256;
    using SafeMath64 for uint64;
    using UnstructuredStorage for bytes32;

    /// ACL
    bytes32 constant public PAUSE_ROLE = keccak256("PAUSE_ROLE");
    bytes32 constant public MANAGE_FEE = keccak256("MANAGE_FEE");
    bytes32 constant public MANAGE_WITHDRAWAL_KEY = keccak256("MANAGE_WITHDRAWAL_KEY");
    bytes32 constant public SET_ORACLE = keccak256("SET_ORACLE");
    bytes32 constant public BURN_ROLE = keccak256("BURN_ROLE");
    bytes32 constant public SET_TREASURY = keccak256("SET_TREASURY");
    bytes32 constant public SET_INSURANCE_FUND = keccak256("SET_INSURANCE_FUND");

    uint256 constant public PUBKEY_LENGTH = 48;
    uint256 constant public WITHDRAWAL_CREDENTIALS_LENGTH = 32;
    uint256 constant public SIGNATURE_LENGTH = 96;

    uint256 constant public DEPOSIT_SIZE = 32 ether;

    uint256 internal constant MIN_DEPOSIT_AMOUNT = 1 ether;     // validator_registration.vy
    uint256 internal constant DEPOSIT_AMOUNT_UNIT = 1000000000 wei;     // validator_registration.vy

    /// @dev default value for maximum number of Ethereum 2.0 validators registered in a single depositBufferedEther call
    uint256 internal constant DEFAULT_MAX_DEPOSITS_PER_CALL = 16;

    bytes32 internal constant FEE_VALUE_POSITION = keccak256("lido.Lido.fee");
    bytes32 internal constant TREASURY_FEE_VALUE_POSITION = keccak256("lido.Lido.treasuryFee");
    bytes32 internal constant INSURANCE_FEE_VALUE_POSITION = keccak256("lido.Lido.insuranceFee");
    bytes32 internal constant NODE_OPERATORS_FEE_VALUE_POSITION = keccak256("lido.Lido.operatorsFee");

    bytes32 internal constant VALIDATOR_REGISTRATION_VALUE_POSITION = keccak256("lido.Lido.validatorRegistration");
    bytes32 internal constant ORACLE_VALUE_POSITION = keccak256("lido.Lido.oracle");
    bytes32 internal constant NODE_OPERATOR_REGISTRY_VALUE_POSITION = keccak256("lido.Lido.nodeOperatorRegistry");
    bytes32 internal constant TREASURY_VALUE_POSITION = keccak256("lido.Lido.treasury");
    bytes32 internal constant INSURANCE_FUND_VALUE_POSITION = keccak256("lido.Lido.insuranceFunds");

    /// @dev amount of Ether (on the current Ethereum side) buffered on this smart contract balance
    bytes32 internal constant BUFFERED_ETHER_VALUE_POSITION = keccak256("lido.Lido.bufferedEther");
    /// @dev number of deposited validators (incrementing counter of deposit operations).
    bytes32 internal constant DEPOSITED_VALIDATORS_VALUE_POSITION = keccak256("lido.Lido.depositedValidators");
    /// @dev total amount of Beacon-side Ether (sum of all the balances of Lido validators)
    bytes32 internal constant BEACON_BALANCE_VALUE_POSITION = keccak256("lido.Lido.beaconBalance");
    /// @dev number of Lido's validators available in the Beacon state
    bytes32 internal constant BEACON_VALIDATORS_VALUE_POSITION = keccak256("lido.Lido.beaconValidators");


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

    /**
    * @dev As AragonApp, Lido contract must be initialized with following variables:
    * @param validatorRegistration official ETH2 Deposit contract
    * @param _oracle oracle contract
    * @param _operators instance of Node Operators Registry
    */
    function initialize(
        IValidatorRegistration validatorRegistration,
        address _oracle,
        INodeOperatorsRegistry _operators,
        address _treasury,
        address _insuranceFund
    )
        public onlyInit
    {
        _setValidatorRegistrationContract(validatorRegistration);
        _setOracle(_oracle);
        _setOperators(_operators);
        _setTreasury(_treasury);
        _setInsuranceFund(_insuranceFund);

        initialized();
    }

    /**
    * @notice Send funds to the pool
    * @dev Users are able to submit their funds by transacting to the fallback function.
    * Unlike vanilla Eth2.0 Deposit contract, accepting only 32-Ether transactions, Lido
    * accepts payments of any size. Submitted Ethers are stored in Buffer until someone calls
    * depositBufferedEther() and pushes them to the ETH2 Deposit contract.
    */
    function() external payable {
        _submit(0);
    }

    /**
    * @notice Send funds to the pool with optional _referral parameter
    * @dev This function is alternative way to submit funds. Supports optional referral address.
    * @return Amount of StETH shares generated
    */
    function submit(address _referral) external payable returns (uint256) {
        return _submit(_referral);
    }

    /**
    * @notice Deposits buffered ethers to the official DepositContract.
    * @dev This function is separated from submit() to reduce the cost of sending funds.
    */
    function depositBufferedEther() external {
        return _depositBufferedEther(DEFAULT_MAX_DEPOSITS_PER_CALL);
    }

    /**
      * @notice Deposits buffered ethers to the official DepositContract, making no more than `_maxDeposits` deposit calls.
      * @dev This function is separated from submit() to reduce the cost of sending funds.
      */
    function depositBufferedEther(uint256 _maxDeposits) external {
        return _depositBufferedEther(_maxDeposits);
    }

    function burnShares(address _account, uint256 _sharesAmount)
        external
        authP(BURN_ROLE, arr(_account, _sharesAmount))
        returns (uint256 newTotalShares)
    {
        return _burnShares(_account, _sharesAmount);
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
      * @notice Set fee distribution: `_treasuryFeeBasisPoints` basis points go to the treasury, `_insuranceFeeBasisPoints` basis points go to the insurance fund, `_operatorsFeeBasisPoints` basis points go to node operators. The sum has to be 10 000.
      */
    function setFeeDistribution(
        uint16 _treasuryFeeBasisPoints,
        uint16 _insuranceFeeBasisPoints,
        uint16 _operatorsFeeBasisPoints
    )
        external auth(MANAGE_FEE)
    {
        require(
            10000 == uint256(_treasuryFeeBasisPoints)
            .add(uint256(_insuranceFeeBasisPoints))
            .add(uint256(_operatorsFeeBasisPoints)),
            "FEES_DONT_ADD_UP"
        );

        _setBPValue(TREASURY_FEE_VALUE_POSITION, _treasuryFeeBasisPoints);
        _setBPValue(INSURANCE_FEE_VALUE_POSITION, _insuranceFeeBasisPoints);
        _setBPValue(NODE_OPERATORS_FEE_VALUE_POSITION, _operatorsFeeBasisPoints);

        emit FeeDistributionSet(_treasuryFeeBasisPoints, _insuranceFeeBasisPoints, _operatorsFeeBasisPoints);
    }

    /**
      * @notice Set authorized oracle contract address to `_oracle`
      * @dev Contract specified here is allowed to make periodical updates of beacon states
      * by calling pushBeacon.
      * @param _oracle oracle contract
      */
    function setOracle(address _oracle) external auth(SET_ORACLE) {
        _setOracle(_oracle);
    }

    /**
      * @notice Set treasury contract address to `_treasury`
      * @dev Contract specified here is used to accumulate the protocol treasury fee.
      * @param _treasury contract which accumulates treasury fee.
      */
    function setTreasury(address _treasury) external auth(SET_TREASURY) {
        _setTreasury(_treasury);
    }

    /**
      * @notice Set insuranceFund contract address to `_insuranceFund`
      * @dev Contract specified here is used to accumulate the protocol insurance fee.
      * @param _insuranceFund contract which accumulates insurance fee.
      */
    function setInsuranceFund(address _insuranceFund) external auth(SET_INSURANCE_FUND) {
        _setInsuranceFund(_insuranceFund);
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
        getOperators().trimUnusedKeys();

        emit WithdrawalCredentialsSet(_withdrawalCredentials);
    }

    /**
      * @notice Issues withdrawal request. Not implemented.
      * @param _amount Amount of StETH to withdraw
      * @param _pubkeyHash Receiving address
      */
    function withdraw(uint256 _amount, bytes32 _pubkeyHash) external whenNotStopped { /* solhint-disable-line no-unused-vars */
        //will be upgraded to an actual implementation when withdrawals are enabled (Phase 1.5 or 2 of Eth2 launch, likely late 2021 or 2022).
        //at the moment withdrawals are not possible in the beacon chain and there's no workaround
        revert("NOT_IMPLEMENTED_YET");
    }

    /**
    * @notice Updates the number of Lido-controlled keys in the beacon validators set and their total balance.
    * @dev periodically called by the Oracle contract
    * @param _beaconValidators number of Lido's keys in the beacon state
    * @param _beaconBalance simmarized balance of Lido-controlled keys in wei
    */
    function pushBeacon(uint256 _beaconValidators, uint256 _beaconBalance) external {
        require(msg.sender == getOracle(), "APP_AUTH_FAILED");

        uint256 depositedValidators = DEPOSITED_VALIDATORS_VALUE_POSITION.getStorageUint256();
        require(_beaconValidators <= depositedValidators, "REPORTED_MORE_DEPOSITED");

        uint256 beaconValidators = BEACON_VALIDATORS_VALUE_POSITION.getStorageUint256();
        // Since the calculation of funds in the ingress queue is based on the number of validators 
        // that are in a transient state (deposited but not seen on beacon yet), we can't decrease the previously
        // reported number (we'll be unable to figure out who is in the queue and count them).
        // See LIP-1 for details https://github.com/lidofinance/lido-improvement-proposals/blob/develop/LIPS/lip-1.md
        require(_beaconValidators >= beaconValidators, "REPORTED_LESS_VALIDATORS");
        uint256 appearedValidators = _beaconValidators.sub(beaconValidators);

        // RewardBase is the amount of money that is not included in the reward calculation
        // Just appeared validators * 32 added to the previously reported beacon balance
        uint256 rewardBase = (appearedValidators.mul(DEPOSIT_SIZE)).add(BEACON_BALANCE_VALUE_POSITION.getStorageUint256());

        // Save the current beacon balance and validators to
        // calcuate rewards on the next push
        BEACON_BALANCE_VALUE_POSITION.setStorageUint256(_beaconBalance);
        BEACON_VALIDATORS_VALUE_POSITION.setStorageUint256(_beaconValidators);

        if (_beaconBalance > rewardBase) {
            uint256 rewards = _beaconBalance.sub(rewardBase);
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
    function getFeeDistribution()
        external
        view
        returns (
            uint16 treasuryFeeBasisPoints,
            uint16 insuranceFeeBasisPoints,
            uint16 operatorsFeeBasisPoints
        )
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
    * @notice Get the amount of Ether temporary buffered on this contract balance
    * @dev Buffered balance is kept on the contract from the moment the funds are received from user
    * until the moment they are actually sent to the official Deposit contract.
    * @return uint256 of buffered funds in wei
    */
    function getBufferedEther() external view returns (uint256) {
        return _getBufferedEther();
    }

    /**
      * @notice Gets validator registration contract handle
      */
    function getValidatorRegistrationContract() public view returns (IValidatorRegistration) {
        return IValidatorRegistration(VALIDATOR_REGISTRATION_VALUE_POSITION.getStorageAddress());
    }

    /**
    * @notice Gets authorized oracle address
    * @return address of oracle contract
    */
    function getOracle() public view returns (address) {
        return ORACLE_VALUE_POSITION.getStorageAddress();
    }

    /**
      * @notice Gets node operators registry interface handle
      */
    function getOperators() public view returns (INodeOperatorsRegistry) {
        return INodeOperatorsRegistry(NODE_OPERATOR_REGISTRY_VALUE_POSITION.getStorageAddress());
    }

    /**
      * @notice Returns the treasury address
      */
    function getTreasury() public view returns (address) {
        return TREASURY_VALUE_POSITION.getStorageAddress();
    }

    /**
      * @notice Returns the insurance fund address
      */
    function getInsuranceFund() public view returns (address) {
        return INSURANCE_FUND_VALUE_POSITION.getStorageAddress();
    }

    /**
    * @notice Returns the key values related to Beacon-side
    * @return depositedValidators - number of deposited validators
    * @return beaconValidators - number of Lido's validators visible in the Beacon state, reported by oracles
    * @return beaconBalance - total amount of Beacon-side Ether (sum of all the balances of Lido validators)
    */
    function getBeaconStat() public view returns (uint256 depositedValidators, uint256 beaconValidators, uint256 beaconBalance) {
        depositedValidators = DEPOSITED_VALIDATORS_VALUE_POSITION.getStorageUint256();
        beaconValidators = BEACON_VALIDATORS_VALUE_POSITION.getStorageUint256();
        beaconBalance = BEACON_BALANCE_VALUE_POSITION.getStorageUint256();
    }

    /**
    * @dev Sets the address of Deposit contract
    * @param _contract the address of Deposit contract
    */
    function _setValidatorRegistrationContract(IValidatorRegistration _contract) internal {
        require(isContract(address(_contract)), "NOT_A_CONTRACT");
        VALIDATOR_REGISTRATION_VALUE_POSITION.setStorageAddress(address(_contract));
    }

    /**
    * @dev Internal function to set authorized oracle address
    * @param _oracle oracle contract
    */
    function _setOracle(address _oracle) internal {
        require(isContract(_oracle), "NOT_A_CONTRACT");
        ORACLE_VALUE_POSITION.setStorageAddress(_oracle);
    }

    /**
    * @dev Internal function to set node operator registry address
    * @param _r registry of node operators
    */
    function _setOperators(INodeOperatorsRegistry _r) internal {
        require(isContract(_r), "NOT_A_CONTRACT");
        NODE_OPERATOR_REGISTRY_VALUE_POSITION.setStorageAddress(_r);
    }

    function _setTreasury(address _treasury) internal {
        require(_treasury != address(0), "SET_TREASURY_ZERO_ADDRESS");
        TREASURY_VALUE_POSITION.setStorageAddress(_treasury);
    }

    function _setInsuranceFund(address _insuranceFund) internal {
        require(_insuranceFund != address(0), "SET_INSURANCE_FUND_ZERO_ADDRESS");
        INSURANCE_FUND_VALUE_POSITION.setStorageAddress(_insuranceFund);
    }

    /**
    * @dev Process user deposit, mints liquid tokens and increase the pool buffer
    * @param _referral address of referral.
    * @return amount of StETH shares generated
    */
    function _submit(address _referral) internal whenNotStopped returns (uint256) {
        address sender = msg.sender;
        uint256 deposit = msg.value;
        require(deposit != 0, "ZERO_DEPOSIT");

        uint256 sharesAmount = getSharesByPooledEth(deposit);
        if (sharesAmount == 0) {
            // totalControlledEther is 0: either the first-ever deposit or complete slashing
            // assume that shares correspond to Ether 1-to-1
            _mintShares(sender, deposit);
            _emitTransferAfterMintingShares(sender, deposit);
        } else {
            _mintShares(sender, sharesAmount);
            _emitTransferAfterMintingShares(sender, sharesAmount);
        }        

        _submitted(sender, deposit, _referral);

        return sharesAmount;
    }

    /**
     * @dev Emits an {Transfer} event where from is 0 address. Indicates mint events.
     */
    function _emitTransferAfterMintingShares(address _to, uint256 _sharesAmount) internal {
        emit Transfer(address(0), _to, getPooledEthByShares(_sharesAmount));
    }

    /**
    * @dev Deposits buffered eth to the DepositContract and assigns chunked deposits to node operators
    */
    function _depositBufferedEther(uint256 _maxDeposits) internal whenNotStopped {
        uint256 buffered = _getBufferedEther();
        if (buffered >= DEPOSIT_SIZE) {
            uint256 unaccounted = _getUnaccountedEther();

            uint256 toUnbuffer = buffered.div(DEPOSIT_SIZE).mul(DEPOSIT_SIZE);
            assert(toUnbuffer <= buffered && toUnbuffer != 0);

            _markAsUnbuffered(_ETH2Deposit(toUnbuffer, _maxDeposits));

            assert(_getUnaccountedEther() == unaccounted);
        }
    }

    /**
    * @dev Makes a deposit to the ETH 2.0 side
    * @param _amount Total amount of Ethers to deposit to the ETH 2.0 side
    * @return actually deposited amount
    */
    function _ETH2Deposit(uint256 _amount, uint256 _maxDeposits) internal returns (uint256) {
        assert(_amount >= MIN_DEPOSIT_AMOUNT);

        // Memory is very cheap, although you don't want to grow it too much.
        DepositLookupCacheEntry[] memory cache = _load_operator_cache();
        if (0 == cache.length)
            return 0;

        uint256 totalDeposits = 0;
        uint256 depositAmount = _amount;
        while (depositAmount != 0 && totalDeposits < _maxDeposits) {
            // Finding the best suitable operator
            uint256 bestOperatorIdx = cache.length;   // 'not found' flag
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

                if (bestOperatorIdx == cache.length || stake < smallestStake) {
                    bestOperatorIdx = idx;
                    smallestStake = stake;
                }
            }

            if (bestOperatorIdx == cache.length)  // not found
                break;

            // Invoking deposit for the best operator
            depositAmount = depositAmount.sub(DEPOSIT_SIZE);
            ++totalDeposits;

            (bytes memory key, bytes memory signature, bool used) =  /* solium-disable-line */
                getOperators().getSigningKey(cache[bestOperatorIdx].id, cache[bestOperatorIdx].usedSigningKeys++);
            assert(!used);

            // finally, stake the notch for the assigned validator
            _stake(key, signature);
        }

        if (0 != totalDeposits) {
            DEPOSITED_VALIDATORS_VALUE_POSITION.setStorageUint256(DEPOSITED_VALIDATORS_VALUE_POSITION.getStorageUint256().add(totalDeposits));
            _write_back_operator_cache(cache);
        }

        return totalDeposits.mul(DEPOSIT_SIZE);
    }

    /**
    * @dev Invokes a deposit call to the official Deposit contract
    * @param _pubkey Validator to stake for
    * @param _signature Signature of the deposit call
    */
    function _stake(bytes memory _pubkey, bytes memory _signature) internal {
        require(withdrawalCredentials.length != 0, "EMPTY_WITHDRAWAL_CREDENTIALS");

        uint256 value = DEPOSIT_SIZE;

        // The following computations and Merkle tree-ization will make official Deposit contract happy
        uint256 depositAmount = value.div(DEPOSIT_AMOUNT_UNIT);
        assert(depositAmount.mul(DEPOSIT_AMOUNT_UNIT) == value);    // properly rounded

        // Compute deposit data root (`DepositData` hash tree root) according to validator_registration.vy
        bytes32 pubkeyRoot = sha256(_pad64(_pubkey));
        bytes32 signatureRoot = sha256(
            abi.encodePacked(
                sha256(BytesLib.slice(_signature, 0, 64)),
                sha256(_pad64(BytesLib.slice(_signature, 64, SIGNATURE_LENGTH.sub(64))))
            )
        );

        bytes32 depositDataRoot = sha256(
            abi.encodePacked(
                sha256(abi.encodePacked(pubkeyRoot, withdrawalCredentials)),
                sha256(abi.encodePacked(_toLittleEndian64(depositAmount), signatureRoot))
            )
        );

        uint256 targetBalance = address(this).balance.sub(value);

        getValidatorRegistrationContract().deposit.value(value)(
            _pubkey, withdrawalCredentials, _signature, depositDataRoot);
        require(address(this).balance == targetBalance, "EXPECTING_DEPOSIT_TO_HAPPEN");
    }

    /**
    * @dev Distributes rewards by minting and distributing corresponding amount of liquid tokens.
    * @param _totalRewards Total rewards accrued on the Ethereum 2.0 side in wei
    */
    function distributeRewards(uint256 _totalRewards) internal {
        uint256 feeInEther = _totalRewards.mul(_getFee()).div(10000);
        // We need to take a defined percentage of the reported reward as a fee, and we do
        // this by minting new token shares and assigning them to the fee recipients (see
        // StETH docs for the explanation of the shares mechanics).
        //
        // Since we've increased totalPooledEther by _totalRewards (which is already
        // performed by the time this function is called), the combined cost of all holders'
        // shares has became _totalRewards StETH tokens more, effectively splitting the reward
        // between each token holder proportionally to their token share.
        //
        // Now we want to mint new shares to the fee recipient, so that the total cost of the
        // newly-minted shares exactly corresponds to the fee taken:
        //
        // shares2mint * newShareCost = feeInEther
        // newShareCost = newTotalPooledEther / (prevTotalShares + shares2mint)
        //
        // which follows to:
        //
        //                    feeInEther * prevTotalShares
        // shares2mint = --------------------------------------
        //                 newTotalPooledEther - feeInEther
        //
        // The effect is that the given percentage of the reward goes to the fee recipient, and
        // the rest of the reward is distributed between token holders proportionally to their
        // token shares.
        //
        uint256 shares2mint = (
            feeInEther
            .mul(_getTotalShares())
            .div(_getTotalPooledEther().sub(feeInEther))
        );

        // Mint the calculated amount of shares to this contract address. This will reduce the
        // balances of the holders, as if the fee was taken in parts from each of them.
        _mintShares(address(this), shares2mint);

        (uint16 treasuryFeeBasisPoints, uint16 insuranceFeeBasisPoints, ) = _getFeeDistribution();
        uint256 toTreasury = shares2mint.mul(treasuryFeeBasisPoints).div(10000);
        uint256 toInsuranceFund = shares2mint.mul(insuranceFeeBasisPoints).div(10000);
        // Transfer the rest of the fee to operators
        uint256 toOperatorsRegistry = shares2mint.sub(toTreasury).sub(toInsuranceFund);
        
        address treasury = getTreasury();
        _transferShares(address(this), getTreasury(), toTreasury);
        _emitTransferAfterMintingShares(treasury, toTreasury);

        address insuranceFund = getInsuranceFund();
        _transferShares(address(this), getInsuranceFund(), toInsuranceFund);
        _emitTransferAfterMintingShares(insuranceFund, toInsuranceFund);

        INodeOperatorsRegistry operatorsRegistry = getOperators();
        _transferShares(address(this), operatorsRegistry, toOperatorsRegistry);
        _emitTransferAfterMintingShares(operatorsRegistry, toOperatorsRegistry);

        operatorsRegistry.distributeRewards(address(this), getPooledEthByShares(toOperatorsRegistry));        
    }

    /**
    * @dev Records a deposit made by a user with optional referral
    * @param _sender sender's address
    * @param _value Deposit value in wei
    * @param _referral address of the referral
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
      * @dev Write back updated usedSigningKeys operator's values
      */
    function _write_back_operator_cache(DepositLookupCacheEntry[] memory cache) internal {
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

        getOperators().updateUsedKeys(ids, usedSigningKeys);
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
        returns (uint16 treasuryFeeBasisPoints, uint16 insuranceFeeBasisPoints, uint16 operatorsFeeBasisPoints)
    {
        treasuryFeeBasisPoints = _readBPValue(TREASURY_FEE_VALUE_POSITION);
        insuranceFeeBasisPoints = _readBPValue(INSURANCE_FEE_VALUE_POSITION);
        operatorsFeeBasisPoints = _readBPValue(NODE_OPERATORS_FEE_VALUE_POSITION);
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
    * @dev Calculates and returns the total base balance (multiple of 32) of validators in transient state,
    *      i.e. submitted to the official Deposit contract but not yet visible in the beacon state.
    * @return transient balance in wei (1e-18 Ether)
    */
    function _getTransientBalance() internal view returns (uint256) {
        uint256 depositedValidators = DEPOSITED_VALIDATORS_VALUE_POSITION.getStorageUint256();
        uint256 beaconValidators = BEACON_VALIDATORS_VALUE_POSITION.getStorageUint256();
        // beaconValidators can never be less than deposited ones.
        assert(depositedValidators >= beaconValidators);
        uint256 transientValidators = depositedValidators.sub(beaconValidators);
        return transientValidators.mul(DEPOSIT_SIZE);
    }

    /**
    * @dev Gets the total amount of Ether controlled by the system
    * @return total balance in wei
    */
    function _getTotalPooledEther() internal view returns (uint256) {
        uint256 bufferedBalance = _getBufferedEther();
        uint256 beaconBalance = BEACON_BALANCE_VALUE_POSITION.getStorageUint256();
        uint256 transientBalance = _getTransientBalance();
        return bufferedBalance.add(beaconBalance).add(transientBalance);
    }

    function _load_operator_cache() internal view returns (DepositLookupCacheEntry[] memory cache) {
        INodeOperatorsRegistry operators = getOperators();
        cache = new DepositLookupCacheEntry[](operators.getActiveNodeOperatorsCount());
        if (0 == cache.length)
            return cache;

        uint256 idx = 0;
        for (uint256 operatorId = operators.getNodeOperatorsCount().sub(1); ; operatorId = operatorId.sub(1)) {
            (
                bool active, , ,
                uint64 stakingLimit,
                uint64 stoppedValidators,
                uint64 totalSigningKeys,
                uint64 usedSigningKeys
            ) = operators.getNodeOperator(operatorId, false);
            if (!active)
                continue;

            DepositLookupCacheEntry memory cached = cache[idx++];
            cached.id = operatorId;
            cached.stakingLimit = stakingLimit;
            cached.stoppedValidators = stoppedValidators;
            cached.totalSigningKeys = totalSigningKeys;
            cached.usedSigningKeys = usedSigningKeys;
            cached.initialUsedSigningKeys = usedSigningKeys;

            if (0 == operatorId)
                break;
        }
        require(idx == cache.length, "NODE_OPERATOR_REGISTRY_INCOSISTENCY");
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
        uint256 temp_value = _value;
        for (uint256 i = 0; i < 8; ++i) {
            result = (result << 8) | (temp_value & 0xFF);
            temp_value >>= 8;
        }

        assert(0 == temp_value);    // fully converted
        result <<= (24 * 8);
    }

    function to64(uint256 v) internal pure returns (uint64) {
        assert(v <= uint256(uint64(-1)));
        return uint64(v);
    }
}
