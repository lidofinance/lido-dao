pragma solidity 0.4.24;


/**
  * @title Liquid version of ETH 2.0 native token
  */
interface ISTETH /* is IERC20 */ {
    function totalSupply() external view returns (uint256);

    /**
      * @notice Stops transfers
      */
    function stop() external;

    /**
      * @notice Resumes transfers
      */
    function resume() external;

    /**
      * @notice Returns true if the token is stopped
      */
    function isStopped() external view returns (bool);

    event Stopped();
    event Resumed();


    /**
      * @notice Mints new tokens
      * @param _to Receiver of new tokens
      * @param _value Amount of new tokens to mint
      */
    function mint(address _to, uint256 _value) external;
}
