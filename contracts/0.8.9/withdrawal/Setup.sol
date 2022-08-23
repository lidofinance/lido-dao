// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>
// SPDX-License-Identifier: MIT

pragma solidity =0.8.9;

import "./Withdrawal.sol";

contract Setup {
  address public immutable LIDO;

  Withdrawal public withdrawal;

  constructor(address _lido) {
    LIDO = _lido;

    withdrawal = new Withdrawal(_lido);
  }
}
