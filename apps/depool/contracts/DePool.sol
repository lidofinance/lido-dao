pragma solidity 0.4.24;

import "@aragon/os/contracts/apps/AragonApp.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "@aragon/os/contracts/common/IsContract.sol";
import "solidity-bytes-utils/contracts/BytesLib.sol";

import "@depools/dao/contracts/interfaces/IDePool.sol";
import "@depools/dao/contracts/interfaces/ISTETH.sol";
import "@depools/depool-lib/contracts/Pausable.sol";


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

    bytes32 internal constant FEE_VALUE_POSITION = keccak256("depools.DePool.fee");
    bytes32 internal constant TOKEN_VALUE_POSITION = keccak256("depools.DePool.token");
    bytes32 internal constant ORACLE_VALUE_POSITION = keccak256("depools.DePool.oracle");


    /// @dev index -> ether value (in ether, not wei)
    uint256[] public denominations;

    bytes private withdrawalCredentials;

    /// @dev index -> key
    bytes[] private signingKeys;

    struct KeyInfo {
        uint256 stakedEther;
        bytes[] signatures;     // denomination index -> signature for (_pubkey, _withdrawalCredentials, denomination)
    }
    /// @dev index -> KeyInfo
    mapping (uint256 => KeyInfo) private keyInfo;


    function initialize(ISTETH _token, address _oracle) public onlyInit {
        denominations = [1, 5, 10, 50, 100, 500, 1000, 5000, 10000, 50000, 100000, 500000];

        _setToken(_token);
        _setOracle(_oracle);

        initialized();
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

    function _getFee() internal view returns (uint32) {
        uint256 v = FEE_VALUE_POSITION.getStorageUint256();
        assert(v <= uint256(uint32(-1)));
        return uint32(v);
    }

    /**
      * @notice Returns staking rewards fee rate
      */
    function getFee() external view returns (uint32 feeBasisPoints) {
        return _getFee();
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
      * @notice Returns current credentials to withdraw ETH on ETH 2.0 side after the phase 2 is launched
      */
    function getWithdrawalCredentials() external view returns (bytes) {
        return withdrawalCredentials;
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

        for (uint i = 0; i < signingKeys.length; ++i) {
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
        for (uint i = 0; i < signingKeys.length; ++i) {
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
      * @notice Issues withdrawal request. Withdrawals will be processed only after the phase 2 launch.
      * @param _amount Amount of StETH to burn
      * @param _pubkeyHash Receiving address
      */
    function withdraw(uint256 _amount, bytes _pubkeyHash) external {
        // FIXME TBD
    }


    function _submit() internal returns (uint256) {
        // FIXME TBD
        return 0;
    }


    /**
      * @dev Sets liquid token interface handle
      */
    function _setToken(ISTETH _token) internal {
        require(isContract(address(_token)), 'NOT_A_CONTRACT');
        TOKEN_VALUE_POSITION.setStorageAddress(address(_token));
    }

    /**
      * @notice Gets liquid token interface handle
      */
    function getToken() public view returns (ISTETH) {
        return ISTETH(TOKEN_VALUE_POSITION.getStorageAddress());
    }

    /**
      * @notice Sets authorized oracle address
      */
    function setOracle(address _oracle) external auth(SET_ORACLE) {
        _setOracle(_oracle);
    }

    /**
      * @dev Internal function to set authorized oracle address
      */
    function _setOracle(address _oracle) internal {
        require(isContract(_oracle), 'NOT_A_CONTRACT');
        ORACLE_VALUE_POSITION.setStorageAddress(_oracle);
    }

    /**
      * @notice Gets authorized oracle address
      */
    function getOracle() public view returns (address) {
        return ORACLE_VALUE_POSITION.getStorageAddress();
    }


    function isEqual(bytes memory a, bytes memory b) private pure returns (bool) {
        uint256 length = a.length;
        if (length != b.length)
            return false;

        if (length > 0 && a[length - 1] != b[length - 1])
            return false;
        if (length > 1 && a[length - 2] != b[length - 2])
            return false;

        return keccak256(a) == keccak256(b);
    }
}
