// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;


/**
  * @title A liquid version of ETH 2.0 native token
  *
  * ERC20 token which supports stop/resume mechanics. The token is operated by `ILido`.
  *
  * Since balances of all token holders change when the amount of total controlled Ether
  * changes, this token cannot fully implement ERC20 standard: it only emits `Transfer`
  * events upon explicit transfer between holders. In contrast, when Lido oracle reports
  * rewards, no Transfer events are generated: doing so would require emitting an event
  * for each token holder and thus running an unbounded loop.
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

    /**
      * @notice An executed shares transfer from `sender` to `recipient`.
      *
      * @dev emitted in pair with an ERC20-defined `Transfer` event.
      */
    event TransferShares(
        address indexed from,
        address indexed to,
        uint256 sharesValue
    );

    event Stopped();
    event Resumed();

    /**
      * @notice Burn is called by Lido contract when a user withdraws their Ether.
      * @param _account Account which tokens are to be burnt
      * @param _sharesAmount Amount of shares to burn
      * @return The total amount of all holders' shares after the shares are burned
      */
    function burnShares(address _account, uint256 _sharesAmount) external returns (uint256);


    function balanceOf(address owner) external view returns (uint256);

    function transfer(address to, uint256 value) external returns (bool);
    function transferShares(address to, uint256 sharesValue) external returns (uint256);

    function getTotalShares() external view returns (uint256);

    function getPooledEthByShares(uint256 _sharesAmount) external view returns (uint256);
    function getSharesByPooledEth(uint256 _pooledEthAmount) external view returns (uint256);
}
