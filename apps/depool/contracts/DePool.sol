pragma solidity 0.4.24;

import "@aragon/os/contracts/apps/AragonApp.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "@aragon/os/contracts/common/IsContract.sol";
import "solidity-bytes-utils/contracts/BytesLib.sol";

import "@depools/dao/contracts/interfaces/IDePool.sol";
import "@depools/dao/contracts/interfaces/ISTETH.sol";
import "@depools/dao/contracts/interfaces/IValidatorRegistration.sol";
import "@depools/depool-lib/contracts/Pausable.sol";


/**
  * @title Liquid staking pool implementation
  *
  * See the comment of `IDePool`.
  */
contract DePool is IDePool, IsContract, Pausable, AragonApp {
    using SafeMath for uint256;
    using UnstructuredStorage for bytes32;

    /// ACL
    bytes32 constant public PAUSE_ROLE = keccak256("PAUSE_ROLE");
    bytes32 constant public MANAGE_FEE = keccak256("MANAGE_FEE");
    bytes32 constant public MANAGE_WITHDRAWAL_KEY = keccak256("MANAGE_WITHDRAWAL_KEY");
    bytes32 constant public MANAGE_SIGNING_KEYS = keccak256("MANAGE_SIGNING_KEYS");
    bytes32 constant public SET_ORACLE = keccak256("SET_ORACLE");

    uint256 constant public MAX_SIGNING_KEYS = 256;
    uint256 constant public PUBKEY_LENGTH = 48;
    uint256 constant public WITHDRAWAL_CREDENTIALS_LENGTH = 32;
    uint256 constant public SIGNATURE_LENGTH = 96;

    uint256 constant public BUFFER_SIZE = 32 ether;

    uint256 internal constant MIN_DEPOSIT_AMOUNT = 1 ether;     // validator_registration.vy
    uint256 internal constant DEPOSIT_AMOUNT_UNIT = 1000000000 wei;     // validator_registration.vy

    bytes32 internal constant FEE_VALUE_POSITION = keccak256("depools.DePool.fee");
    bytes32 internal constant TOKEN_VALUE_POSITION = keccak256("depools.DePool.token");
    bytes32 internal constant VALIDATOR_REGISTRATION_VALUE_POSITION = keccak256("depools.DePool.validatorRegistration");
    bytes32 internal constant ORACLE_VALUE_POSITION = keccak256("depools.DePool.oracle");

    bytes32 internal constant BUFFERED_ETHER_VALUE_POSITION = keccak256("depools.DePool.bufferedEther");
    bytes32 internal constant DEPOSITED_ETHER_VALUE_POSITION = keccak256("depools.DePool.depositedEther");
    bytes32 internal constant REMOTE_ETHER_VALUE_POSITION = keccak256("depools.DePool.remoteEther");


    /// @dev index -> ether value (in ether, not wei)
    uint256[] public denominations;


    /// @dev Credentials which allows the DAO to withdraw Ether on the 2.0 side
    bytes private withdrawalCredentials;

    /// @dev index -> key
    bytes[] private signingKeys;

    /// @dev Information about a signing (validator) key
    struct KeyInfo {
        uint256 stakedEther;    // amount of Ether staked for this key by the contract
        bytes[] signatures;     // denomination index -> signature for (_pubkey, _withdrawalCredentials, denomination)
    }
    /// @dev index -> KeyInfo
    mapping (uint256 => KeyInfo) private keyInfo;


    /// @dev Request to withdraw Ether on the 2.0 side
    struct WithdrawalRequest {
        uint256 amount;     // amount of wei to withdraw
        bytes32 pubkeyHash; // receiver's public key hash
    }

    /// @dev Queue of withdrawal requests
    WithdrawalRequest[] private withdrawalRequests;


    function initialize(ISTETH _token, IValidatorRegistration validatorRegistration, address _oracle) public onlyInit {
        denominations = [1, 5, 10, 50, 100, 500, 1000, 5000, 10000, 50000, 100000, 500000];
        assert(denominations[0].mul(1 ether) >= MIN_DEPOSIT_AMOUNT);

        _setToken(_token);
        _setValidatorRegistrationContract(validatorRegistration);
        _setOracle(_oracle);

        initialized();
    }


    /**
      * @notice Adds eth to the pool
      */
    function() external payable {
        _submit();
    }

    /**
      * @notice Adds eth to the pool
      * @return StETH Amount of StETH generated
      */
    function submit() external payable returns (uint256 StETH) {
        return _submit();
    }


    /**
      * @notice Stops pool routine operations
      */
    function stop() external auth(PAUSE_ROLE) {
        _stop();
    }

    /**
      * @notice Resumes pool routine operations
      */
    function resume() external auth(PAUSE_ROLE) {
        _resume();
    }


    /**
      * @notice Sets fee rate for the fees accrued when oracles report staking results
      * @param _feeBasisPoints Fee rate, in basis points
      */
    function setFee(uint32 _feeBasisPoints) external auth(MANAGE_FEE) {
        FEE_VALUE_POSITION.setStorageUint256(uint256(_feeBasisPoints));
        emit FeeSet(_feeBasisPoints);
    }

    /**
      * @notice Sets authorized oracle address
      */
    function setOracle(address _oracle) external auth(SET_ORACLE) {
        _setOracle(_oracle);
    }


    /**
      * @notice Sets credentials to withdraw ETH on ETH 2.0 side after the phase 2 is launched
      * @dev Note that setWithdrawalCredentials invalidates all signing keys as the signatures are invalidated.
      *      That is why it's required to remove all signing keys beforehand. Then, they'll need to be added again.
      * @param _withdrawalCredentials hash of withdrawal multisignature key as accepted by
      *        the validator_registration.deposit function
      */
    function setWithdrawalCredentials(bytes _withdrawalCredentials) external auth(MANAGE_WITHDRAWAL_KEY) {
        require(_withdrawalCredentials.length == WITHDRAWAL_CREDENTIALS_LENGTH, "INVALID_LENGTH");
        require(0 == signingKeys.length, "SIGNING_KEYS_MUST_BE_REMOVED_FIRST");

        withdrawalCredentials = _withdrawalCredentials;

        emit WithdrawalCredentialsSet(_withdrawalCredentials);
    }

    /**
      * @notice Adds a validator signing key to the set of usable keys
      * @dev Along with the key the DAO has to provide signatures for several (pubkey, withdrawal_credentials,
      *      deposit_amount) messages where deposit_amount is some typical eth denomination.
      *      Given that information, the contract'll be able to call validator_registration.deposit on-chain
      *      for any deposit amount provided by a staker.
      * @param _pubkey Validator signing key
      * @param _signatures 12 concatenated signatures for (_pubkey, _withdrawalCredentials, amount of ether)
      *        where amount of ether is each of the values of `denominations`.
      */
    function addSigningKey(bytes _pubkey, bytes _signatures) external auth(MANAGE_SIGNING_KEYS) {
        require(_pubkey.length == PUBKEY_LENGTH, "INVALID_LENGTH");
        require(_signatures.length == SIGNATURE_LENGTH * 12, "INVALID_LENGTH");
        require(signingKeys.length < MAX_SIGNING_KEYS, "TOO_MANY_KEYS");

        uint256 length = signingKeys.length;
        for (uint256 i = 0; i < length; ++i) {
            require(!isEqual(signingKeys[i], _pubkey), "KEY_ALREADY_EXISTS");
        }

        uint256 index = signingKeys.length;
        signingKeys.push(_pubkey);

        bytes memory signatures = _signatures;
        keyInfo[index].stakedEther = 0;
        keyInfo[index].signatures.length = denominations.length;
        for (i = 0; i < denominations.length; i++) {
            keyInfo[index].signatures[i] = BytesLib.slice(signatures, i * SIGNATURE_LENGTH, SIGNATURE_LENGTH);
        }

        emit SigningKeyAdded(_pubkey);
    }

    /**
      * @notice Removes a validator signing key from the set of usable keys
      * @param _pubkey Validator signing key
      */
    function removeSigningKey(bytes _pubkey) external auth(MANAGE_SIGNING_KEYS) {
        uint256 length = signingKeys.length;
        for (uint256 i = 0; i < length; ++i) {
            if (!isEqual(signingKeys[i], _pubkey))
                continue;

            // Fill the spot with the latest key
            uint256 new_index = i;
            uint256 old_index = signingKeys.length - 1;
            if (new_index != old_index) {
                signingKeys[new_index] = signingKeys[old_index];
                keyInfo[new_index] = keyInfo[old_index];
            }

            delete signingKeys[old_index];
            signingKeys.length--;
            delete keyInfo[old_index];

            emit SigningKeyRemoved(_pubkey);
            return;
        }

        revert("KEY_NOT_FOUND");
    }


    /**
      * @notice Issues withdrawal request. Withdrawals will be processed only after the phase 2 launch.
      * @param _amount Amount of StETH to burn
      * @param _pubkeyHash Receiving address
      */
    function withdraw(uint256 _amount, bytes32 _pubkeyHash) external {
        address sender = msg.sender;

        uint256 totalSupply = getToken().totalSupply();
        getToken().burn(sender, _amount);

        // (total ether) * share of msg.sender's token holding.
        // totalSupply is taken before the burning.
        uint256 etherAmount = _amount.mul(_getTotalControlledEther()).div(totalSupply);

        withdrawalRequests.push(WithdrawalRequest({amount: etherAmount, pubkeyHash: _pubkeyHash}));

        emit Withdrawal(sender, _amount, _pubkeyHash, etherAmount);
    }


    /**
      * @notice Ether on the ETH 2.0 side reported by the oracle
      * @param _eth2balance Balance in wei on the ETH 2.0 side
      */
    function reportEther2(uint256 /*_epoch*/, uint256 _eth2balance) external {
        require(msg.sender == getOracle(), "APP_AUTH_FAILED");
        // +1 serves as a boolean flag of a set value
        REMOTE_ETHER_VALUE_POSITION.setStorageUint256(_eth2balance.add(1));

        // TODO mint
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
    function getFee() external view returns (uint32 feeBasisPoints) {
        return _getFee();
    }


    /**
      * @notice Returns current credentials to withdraw ETH on ETH 2.0 side after the phase 2 is launched
      */
    function getWithdrawalCredentials() external view returns (bytes) {
        return withdrawalCredentials;
    }

    /**
      * @notice Returns count of usable signing keys
      */
    function getActiveSigningKeyCount() external view returns (uint256) {
        return signingKeys.length;
    }

    /**
      * @notice Returns n-th signing key
      * @param _index Index of key, starting with 0
      * @return key Key
      * @return stakedEther Amount of ether stacked for this validator to the moment
      */
    function getActiveSigningKey(uint256 _index) external view returns (bytes key, uint256 stakedEther) {
        require(_index < signingKeys.length, "KEY_NOT_FOUND");

        return (signingKeys[_index], keyInfo[_index].stakedEther);
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
      * @dev Processes user deposit
      */
    function _submit() internal returns (uint256 StETH) {
        address sender = msg.sender;
        uint256 deposit = msg.value;
        require(deposit != 0, "ZERO_DEPOSIT");

        // Minting new liquid tokens
        if (0 == _getTotalControlledEther()) {
            StETH = deposit;
        } else {
            assert(getToken().totalSupply() != 0);
            StETH = deposit.mul(getToken().totalSupply()).div(_getTotalControlledEther());
        }
        getToken().mint(sender, StETH);

        _submitted(sender, deposit);

        // Buffer management
        uint256 buffered = _getBufferedEther();
        if (buffered >= BUFFER_SIZE) {
            uint256 unaccounted = _getUnaccountedEther();

            uint256 rounding = denominations[0].mul(1 ether);
            uint256 toUnbuffer = buffered.div(rounding).mul(rounding);
            assert(toUnbuffer <= buffered);

            _ETH2Deposit(toUnbuffer);
            _markAsUnbuffered(toUnbuffer);

            assert(_getUnaccountedEther() == unaccounted);
        }
    }

    /**
      * @dev Makes a deposit to the ETH 2.0 side
      * @param _amount Total amount to deposit to the ETH 2.0 side
      */
    function _ETH2Deposit(uint256 _amount) internal {
        assert(_amount >= MIN_DEPOSIT_AMOUNT);
        require(signingKeys.length > 0, "NO_VALIDATORS");

        // populating stat cache in memory
        uint256[] memory staked4validator = new uint256[](signingKeys.length);
        uint256 length = signingKeys.length;
        for (uint256 i = 0; i < length; ++i) {
            staked4validator[i] = keyInfo[i].stakedEther;
        }

        for (uint256 denomination_idx = denominations.length - 1; ; denomination_idx = denomination_idx.sub(1)) {
            uint256 denomination = denominations[denomination_idx].mul(1 ether);

            while (_amount >= denomination) {
                // notch off a denomination and send it to the ETH 2.0
                _amount = _amount.sub(denomination);

                // assign some validator for this notch and update stat
                uint256 assignedValidator = 0;
                uint256 staked = staked4validator[assignedValidator];
                for (i = 1; i < length; ++i) {
                    if (staked4validator[i] >= staked)
                        continue;

                    assignedValidator = i;
                    staked = staked4validator[assignedValidator];
                }
                keyInfo[assignedValidator].stakedEther = keyInfo[assignedValidator].stakedEther.add(denomination);
                staked4validator[assignedValidator] = staked4validator[assignedValidator].add(denomination);

                // finally, stake the notch for the assigned validator
                _stake(assignedValidator, denomination_idx);
            }

            if (0 == denomination_idx) {
                assert(0 == _amount);   // everything should be distributed by this moment
                break;
            }
        }
    }

    /**
      * @dev Invokes a validator_registration.deposit call
      * @param _assignedValidator Validator to stake for
      * @param _denomination_idx Denomination to stake
      */
    function _stake(uint256 _assignedValidator, uint256 _denomination_idx) internal {
        require(withdrawalCredentials.length != 0, "EMPTY_WITHDRAWAL_CREDENTIALS");

        bytes memory pubkey = signingKeys[_assignedValidator];
        bytes memory signature = keyInfo[_assignedValidator].signatures[_denomination_idx];
        uint256 value = denominations[_denomination_idx].mul(1 ether);

        // The following computations and Merkle tree-ization will make validator_registration.vy happy
        uint256 depositAmount = value.div(DEPOSIT_AMOUNT_UNIT);
        assert(depositAmount.mul(DEPOSIT_AMOUNT_UNIT) == value);    // properly rounded

        // Compute deposit data root (`DepositData` hash tree root) according to validator_registration.vy
        bytes32 pubkeyRoot = keccak256(_pad64(pubkey));
        bytes32 signatureRoot = keccak256(abi.encodePacked(
            keccak256(BytesLib.slice(signature, 0, 64)),
            keccak256(_pad64(BytesLib.slice(signature, 64, SIGNATURE_LENGTH.sub(64))))
        ));

        bytes32 depositDataRoot = keccak256(abi.encodePacked(
            keccak256(abi.encodePacked(pubkeyRoot, withdrawalCredentials)),
            keccak256(abi.encodePacked(_toLittleEndian64(depositAmount), signatureRoot))
        ));

        uint256 targetBalance = address(this).balance.sub(value);

        getValidatorRegistrationContract().deposit.value(value)(
            pubkey, withdrawalCredentials, signature, depositDataRoot);
        require(address(this).balance == targetBalance, "EXPECTING_DEPOSIT_TO_HAPPEN");
    }


    /**
      * @dev Records a deposit made by a user.
      * @param _value Deposit value in wei
      */
    function _submitted(address _sender, uint256 _value) internal {
        BUFFERED_ETHER_VALUE_POSITION.setStorageUint256(_getBufferedEther().add(_value));

        emit Submitted(_sender, _value);
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
      * @dev Returns staking rewards fee rate
      */
    function _getFee() internal view returns (uint32) {
        uint256 v = FEE_VALUE_POSITION.getStorageUint256();
        assert(v <= uint256(uint32(-1)));
        return uint32(v);
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
      * @dev Gets the amount of Ether controlled by the system
      */
    function _getTotalControlledEther() internal view returns (uint256) {
        uint256 remote = REMOTE_ETHER_VALUE_POSITION.getStorageUint256();
        // Until the oracle provides data, we assume that all staked ether intact.
        uint256 deposited = DEPOSITED_ETHER_VALUE_POSITION.getStorageUint256();

        return _getBufferedEther().add(remote != 0 ? remote.sub(1) : deposited);
    }


    /**
      * @dev Fast dynamic array comparison
      */
    function isEqual(bytes memory _a, bytes memory _b) internal pure returns (bool) {
        uint256 length = _a.length;
        if (length != _b.length)
            return false;

        if (length > 0 && _a[length - 1] != _b[length - 1])
            return false;
        if (length > 1 && _a[length - 2] != _b[length - 2])
            return false;

        return keccak256(_a) == keccak256(_b);
    }

    /**
      * @dev Padding memory array with zeroes up to 64 bytes
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
      * @dev Converting value to little endian bytes
      * @param _value Number less than `2**64` for compatibility reasons
      */
    function _toLittleEndian64(uint256 _value) internal pure returns (uint256 result) {
        result = 0;
        for (uint256 i = 0; i < 8; ++i) {
            result = (result << 8) | (_value & 0xFF);
            _value >>= 8;
        }

        assert(0 == _value);    // fully converted
        result <<= 24;
    }
}
