// For testing purposes only
pragma solidity 0.4.24;

import {StETHPermit} from "contracts/0.4.24/StETHPermit.sol";
import {StethMinimalMockWithTotalPooledEther} from "test/0.4.24/Lido/contracts/StethMinimalMockWithTotalPooledEther.sol";

contract StethPermitInheritor is StETHPermit, StethMinimalMockWithTotalPooledEther {
  constructor(address _holder) payable StethMinimalMockWithTotalPooledEther(_holder) {}

  function initializeEIP712StETH(address _eip712StETH) external {
    _initializeEIP712StETH(_eip712StETH);
  }
}
