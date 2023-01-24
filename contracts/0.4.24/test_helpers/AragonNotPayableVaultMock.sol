pragma solidity 0.4.24;

import "@aragon/os/contracts/apps/UnsafeAragonApp.sol";
import "@aragon/os/contracts/common/DepositableStorage.sol";


contract AragonNotPayableVaultMock {

    function () external payable {
        require(false);
    }
}
