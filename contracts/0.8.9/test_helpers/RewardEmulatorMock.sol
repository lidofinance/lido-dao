
// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.9;

import "./ETHForwarderMock.sol";

contract RewardEmulatorMock {
    address payable private target;

    event Rewarded(address target, uint256 amount);

    constructor(address _target) {
        target = payable(_target);
    }

    function reward() public payable {
        require(target != address(0), "no target");
        uint256 amount = msg.value;
        uint256 balance = target.balance + amount;
        bytes memory bytecode = abi.encodePacked(type(ETHForwarderMock).creationCode, abi.encode(target));
        address addr;

        /*
        NOTE: How to call create2
        create2(v, p, n, s)
        create new contract with code at memory p to p + n
        and send v wei
        and return the new address
        where new address = first 20 bytes of keccak256(0xff + address(this) + s + keccak256(mem[p…(p+n)))
                s = big-endian 256-bit value
        */
        assembly {
            addr := create2(
                amount, // wei sent with current call
                // Actual code starts after skipping the first 32 bytes
                add(bytecode, 0x20),
                mload(bytecode), // Load the size of code contained in the first 32 bytes
                0 // Salt
            )
        }
        require(target.balance == balance, "incorrect balance");
        emit Rewarded(target, msg.value);
    }
}
