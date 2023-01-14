// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.9;

import "../EIP712StETH.sol";

contract EIP712StETHMock is EIP712StETH {
    function getChainId() external view returns (uint256 chainId) {
        return block.chainid;
    }
}
