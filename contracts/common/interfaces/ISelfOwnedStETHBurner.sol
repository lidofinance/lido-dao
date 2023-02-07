// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
// solhint-disable-next-line
pragma solidity >=0.4.24 <0.9.0;

interface ISelfOwnedStETHBurner {
    /**
     * Commit cover/non-cover burning requests and logs cover/non-cover shares amount just burnt.
     *
     * NB: The real burn enactment to be invoked after the call (via internal Lido._burnShares())
     */
    function commitSharesToBurn(uint256 sharesToBurnLimit) external returns (uint256 sharesToBurnNow);

    /**
      * @notice Mark excess stETH shares for burning
      *
      * @dev Can be called only by `Lido`.
      *
      * @param _stETHShares stETH shares to burn
      */
    function markExcessStETHSharesForBurn(uint256 _stETHShares) external;

    /**
      * Returns the current amount of shares locked on the contract to be burnt.
      */
    function getSharesRequestedToBurn() external view returns (
        uint256 coverShares, uint256 nonCoverShares
    );

    /**
      * Returns the total cover shares ever burnt.
      */
    function getCoverSharesBurnt() external view returns (uint256);

    /**
      * Returns the total non-cover shares ever burnt.
      */
    function getNonCoverSharesBurnt() external view returns (uint256);
}
