// For testing purposes only
pragma solidity 0.4.24;

import {StETHPermit} from "contracts/0.4.24/StETHPermit.sol";
import {StethMock} from "test/0.4.24/Lido/StethMock.sol";

contract StethPermitInheritor is StETHPermit, StethMock {
  constructor(address _holder) payable StethMock(_holder) {}

  function initializeEIP712StETH(address _eip712StETH) external {
    _initializeEIP712StETH(_eip712StETH);
  }
}
