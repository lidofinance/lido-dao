// SPDX-FileCopyrightText: 2024 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
// for testing purposes only

pragma solidity 0.8.9;

import {ERC721} from "@openzeppelin/contracts-v4.4/token/ERC721/ERC721.sol";

contract ERC721Token_MockForWithdrawalVault is ERC721 {
    constructor(string memory _name, string memory _symbol) ERC721(_name, _symbol) {}

    function mint(address _account, uint256 _tokenId) public {
        super._mint(_account, _tokenId);
    }
}
