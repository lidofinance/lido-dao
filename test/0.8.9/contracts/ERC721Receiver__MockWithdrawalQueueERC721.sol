// SPDX-FileCopyrightText: 2024 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
// for testing purposes only

pragma solidity 0.8.9;

contract ERC721Receiver__MockWithdrawalQueueERC721 {
    bool public isReturnValid;
    bool public doesAcceptTokens;
    string public ERROR_MSG = "ERC721_NOT_ACCEPT_TOKENS";

    function setDoesAcceptTokens(bool _value) external {
        doesAcceptTokens = _value;
    }

    function setReturnValid(bool _value) external {
        isReturnValid = _value;
    }

    function onERC721Received(
        address, // operator,
        address, // from,
        uint256, // tokenId,
        bytes calldata // data
    ) external view returns (bytes4) {
        if (!doesAcceptTokens) {
            revert(ERROR_MSG);
        }
        if (!isReturnValid) {
            return bytes4(keccak256("neverGonnaGiveYouUp()"));
        }
        return
            bytes4(
            keccak256("onERC721Received(address,address,uint256,bytes)")
        );
    }

    receive() external payable {
        if (!doesAcceptTokens) {
            revert(ERROR_MSG);
        }
    }
}
