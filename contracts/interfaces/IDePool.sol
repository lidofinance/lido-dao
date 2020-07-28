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

    /**
      * @notice Returns staking rewards fee rate
      */
    function getFee() external view returns (uint32 feeBasisPoints);

    event FeeSet(uint32 feeBasisPoints);


    /**
      * @notice Sets credentials to withdraw ETH on ETH 2.0 side after the phase 2 is launched
      * @dev Note that setWithdrawalCredentials invalidates all signing keys as the signatures are invalidated.
      *      That is why it's required to remove all signing keys beforehand. Then, they'll need to be added again.
      * @param _withdrawalCredentials hash of withdrawal multisignature key as accepted by
      *        the validator_registration.deposit function
      */
    function setWithdrawalCredentials(bytes _withdrawalCredentials) external;

    /**
      * @notice Returns current credentials to withdraw ETH on ETH 2.0 side after the phase 2 is launched
      */
    function getWithdrawalCredentials() external view returns (bytes);

    /**
      * @notice Adds a validator signing key to the set of usable keys
      * @dev Along with the key the DAO has to provide signatures for several (pubkey, withdrawal_credentials,
      *      deposit_amount) messages where deposit_amount is some typical eth denomination.
      *      Given that information, the contract'll be able to call validator_registration.deposit on-chain
      *      for any deposit amount provided by a staker.
      * @param _pubkey Validator signing key
      * @param _signatures 12 concatenated signatures for (_pubkey, _withdrawalCredentials, amount of ether)
      *        where amount of ether is 1, 5, 10, 50, 100, 500, 1000, 5000, 10000, 50000, 100000, 500000
      */
    function addSigningKey(bytes _pubkey, bytes _signatures) external;

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
      * @return key Key
      * @return stakedEther Amount of ether stacked for this validator to the moment
      */
    function getActiveSigningKey(uint256 _index) external view returns (bytes key, uint256 stakedEther);

    event WithdrawalCredentialsSet(bytes withdrawalCredentials);
    event SigningKeyAdded(bytes pubkey);
    event SigningKeyRemoved(bytes pubkey);


    /**
      * @notice Ether on the ETH 2.0 side reported by the oracle
      * @param _epoch Epoch id
      * @param _eth2balance Balance in wei on the ETH 2.0 side
      */
    function reportEther2(uint256 _epoch, uint256 _eth2balance) external;


    // User functions

    /**
      * @notice Adds eth to the pool
      * @return StETH Amount of StETH generated
      */
    function submit() external payable returns (uint256 StETH);

    // Records a deposit made by a user
    event Submitted(address sender, uint256 amount);

    // The `_amount` of ether was sent to the validator_registration.deposit function.
    event Unbuffered(uint256 amount);

    /**
      * @notice Issues withdrawal request. Withdrawals will be processed only after the phase 2 launch.
      * @param _amount Amount of StETH to burn
      * @param _pubkeyHash Receiving address
      */
    function withdraw(uint256 _amount, bytes _pubkeyHash) external;

    event Withdrawal(uint256 amount, bytes pubkeyHash);
}
