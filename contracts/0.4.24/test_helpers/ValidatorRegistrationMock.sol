pragma solidity 0.4.24;

import "../interfaces/IValidatorRegistration.sol";


/**
  * @dev This is a mock. Don't use in production.
  */
contract ValidatorRegistrationMock is IValidatorRegistration {
    struct Call {
        bytes pubkey;
        bytes withdrawal_credentials;
        bytes signature;
        bytes32 deposit_data_root;
        uint256 value;
    }

    Call[] public calls;


    function deposit(bytes /* 48 */ pubkey,
                     bytes /* 32 */ withdrawal_credentials,
                     bytes /* 96 */ signature,
                     bytes32 deposit_data_root)
        external
        payable
    {
        calls.push(Call(pubkey, withdrawal_credentials, signature, deposit_data_root, msg.value));
    }

    function totalCalls() external view returns (uint256) {
        return calls.length;
    }

    function reset() external {
        calls.length = 0;
    }
}
