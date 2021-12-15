// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

contract ERC721OZMock is ERC721 {
    constructor() public ERC721("Mock NFT", "mNFT") {}

    function mintToken(uint256 token_id) public {
        _mint(msg.sender, token_id);
    }
}