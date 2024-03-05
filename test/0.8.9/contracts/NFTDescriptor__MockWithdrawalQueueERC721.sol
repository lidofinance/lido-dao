// SPDX-FileCopyrightText: 2024 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0
// for testing purposes only

pragma solidity 0.8.9;

import {NFTDescriptorMock} from "contracts/0.8.9/test_helpers/NFTDescriptorMock.sol";

contract NFTDescriptor__MockWithdrawalQueueERC721 is NFTDescriptorMock {
    constructor(string memory _baseURI) NFTDescriptorMock(_baseURI) {}
}
