pragma solidity 0.4.24;

import "../Lido.sol";


/**
 * @dev Mock for unit-testing pushBeacon and how reward get calculated
 */
contract LidoPushableMock is Lido {

    uint256 public totalRewards;
    bool public distributeRewardsCalled;

    function setDepositedValidators(uint256 _depositedValidators) public {
        DEPOSITED_VALIDATORS_VALUE_POSITION.setStorageUint256(_depositedValidators);
    }

    function initialize(address _oracle) public onlyInit {
        _setOracle(_oracle);
        initialized();
    }

    function resetDistributeRewards() public {
        totalRewards = 0;
        distributeRewardsCalled = false;
    }

    function distributeRewards(uint256 _totalRewards) internal {
        totalRewards = _totalRewards;
        distributeRewardsCalled = true;
    }
}
