// For testing purposes only
pragma solidity 0.4.24;

import {StETHPermit} from "contracts/0.4.24/StETHPermit.sol";
import {Steth__MinimalMock} from "test/0.4.24/contracts/Steth__MinimalMock.sol";

contract StethPermitMockWithEip712Initialization is StETHPermit, Steth__MinimalMock {
  constructor(address _holder) payable Steth__MinimalMock(_holder) {}

  function initializeEIP712StETH(address _eip712StETH) external {
    _initializeEIP712StETH(_eip712StETH);
  }
}
