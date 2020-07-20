pragma solidity 0.4.24;


/**
  * @title Liquid staking pool
  */
interface IDePool {
    /**
      * @notice Stops pool routine operations
      */
    function stop() external;

    /**
      * @notice Resumes pool routine operations
      */
    function resume() external;

    event Stopped();
    event Resumed();


    /**
      * @notice Sets fee rate for the fees accrued when oracles report staking results
      * @param _feeBasisPoints Fee rate, in basis points
      */
    function setFee(uint32 _feeBasisPoints) external;

    event FeeSet(uint32 _feeBasisPoints);


    /**
      * @notice Sets credentials to withdraw ETH on ETH 2.0 side after the phase 2 is launched
      * @param _withdrawalCredentials hash of withdrawal multisignature key as accepted by
      *        the validator_registration.deposit function
      */
    function setWithdrawalCredentials(bytes _withdrawalCredentials) external;

    /**
      * @notice Adds a validator signing key to the set of usable keys
      * @dev Along with the key the DAO has to provide signatures for several (pubkey, withdrawal_credentials,
      *      deposit_amount) messages where deposit_amount is some typical eth denomination.
      *      Given that information, the contract'll be able to call validator_registration.deposit on-chain
      *      for any deposit amount provided by a staker.
      *      Note that setWithdrawalCredentials invalidates all signing keys as the signatures are invalidated.
      *      They need to be added again.
      * @param _pubkey Validator signing key
      * @param _eth1signature BLS signature of the message (_pubkey, _withdrawalCredentials, 1 ether)
      * @param _eth5signature BLS signature of the message (_pubkey, _withdrawalCredentials, 5 ether)
      * @param _eth10signature BLS signature of the message (_pubkey, _withdrawalCredentials, 10 ether)
      * @param _eth50signature BLS signature of the message (_pubkey, _withdrawalCredentials, 50 ether)
      * @param _eth100signature BLS signature of the message (_pubkey, _withdrawalCredentials, 100 ether)
      * @param _eth500signature BLS signature of the message (_pubkey, _withdrawalCredentials, 500 ether)
      * @param _eth1000signature BLS signature of the message (_pubkey, _withdrawalCredentials, 1000 ether)
      * @param _eth5000signature BLS signature of the message (_pubkey, _withdrawalCredentials, 5000 ether)
      * @param _eth10000signature BLS signature of the message (_pubkey, _withdrawalCredentials, 10000 ether)
      * @param _eth50000signature BLS signature of the message (_pubkey, _withdrawalCredentials, 50000 ether)
      * @param _eth100000signature BLS signature of the message (_pubkey, _withdrawalCredentials, 100000 ether)
      * @param _eth500000signature BLS signature of the message (_pubkey, _withdrawalCredentials, 500000 ether)
      */
    function addSigningKey(bytes _pubkey,
            bytes _eth1signature, bytes _eth5signature,
            bytes _eth10signature, bytes _eth50signature,
            bytes _eth100signature, bytes _eth500signature,
            bytes _eth1000signature, bytes _eth5000signature,
            bytes _eth10000signature, bytes _eth50000signature,
            bytes _eth100000signature, bytes _eth500000signature) external;

    /**
      * @notice Removes a validator signing key from the set of usable keys
      * @param _pubkey Validator signing key
      */
    function removeSigningKey(bytes _pubkey) external;

    /**
      * @notice Returns count of usable signing keys
      */
    function getActiveSigningKeyCount() external view returns (uint256);

    /**
      * @notice Returns n-th signing key
      * @param _index Index of key, starting with 0
      * @return _key Key
      * @return _stakedEther Amount of ether stacked for this validator to the moment
      */
    function getActiveSigningKey(uint256 _index) external view returns (bytes _key, uint256 _stakedEther);

    event WithdrawalCredentialsSet(bytes _withdrawalCredentials);
    event SigningKeyAdded(bytes _pubkey);


    // User functions

    /**
      * @notice Adds eth to the pool
      * @return _StETH Amount of StETH generated
      */
    function submit() external payable returns (uint256 _StETH);

    /**
      * @notice Issues withdrawal request. Withdrawals will be processed only after the phase 2 launch.
      * @param _amount Amount of StETH to burn
      * @param _pubkeyHash Receiving address
      */
    function withdraw(uint256 _amount, bytes _pubkeyHash) external;

    event Withdrawal(uint256 _amount, bytes _pubkeyHash);
}
