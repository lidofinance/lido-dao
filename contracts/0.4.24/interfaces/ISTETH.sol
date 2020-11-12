pragma solidity 0.4.24;


/**
  * @title Liquid version of ETH 2.0 native token
  *
  * ERC20 token which supports stop/resume, mint/burn mechanics. The token is operated by `ILido`.
  */
interface ISTETH /* is IERC20 */ {
    function totalSupply() external view returns (uint256);

    /**
      * @notice Stop transfers
      */
    function stop() external;

    /**
      * @notice Resume transfers
      */
    function resume() external;

    /**
      * @notice Returns true if the token is stopped
      */
    function isStopped() external view returns (bool);

    event Stopped();
    event Resumed();


    /**
      * @notice Mint `@tokenAmount(this, _value)` new tokens to `_to`
      * @param _to Receiver of new tokens
      * @param _value Amount of new tokens to mint
      */
    function mint(address _to, uint256 _value) external;

    /**
      * @notice Burn `@tokenAmount(this, _value)` tokens from `_account`
      * @param _account Account which tokens are to be burnt
      * @param _value Amount of tokens to burn
      */
    function burn(address _account, uint256 _value) external;

    function balanceOf(address owner) external view returns (uint256);

    function transfer(address to, uint256 value) external returns (bool);

    function getTotalShares() external view returns (uint256);

    function getPooledEthByShares(uint256 _sharesAmount) external view returns (uint256);
}
