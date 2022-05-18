// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import "../Lido.sol";
import "./VaultMock.sol";


/**
 * @dev Mock for unit-testing handleOracleReport and how reward get calculated
 */
contract LidoPushableMock is Lido {

    uint256 public totalRewards;
    bool public distributeFeeCalled;

    function initialize(
        IDepositContract depositContract,
        address _oracle,
        INodeOperatorsRegistry _operators
    )
    public
    {
        super.initialize(
          depositContract,
          _oracle,
          _operators,
          new VaultMock(),
          new VaultMock()
        );

        _resume();
    }

    function setDepositedValidators(uint256 _depositedValidators) public {
        DEPOSITED_VALIDATORS_POSITION.setStorageUint256(_depositedValidators);
    }

    function setBeaconBalance(uint256 _beaconBalance) public {
        BEACON_BALANCE_POSITION.setStorageUint256(_beaconBalance);
    }

    // value sent to this function becomes buffered
    function setBufferedEther() public payable {
        BUFFERED_ETHER_POSITION.setStorageUint256(msg.value);
    }

    function setBeaconValidators(uint256 _beaconValidators) public {
        BEACON_VALIDATORS_POSITION.setStorageUint256(_beaconValidators);
    }

    function initialize(address _oracle) public onlyInit {
        _setProtocolContracts(_oracle, _oracle, _oracle);
        _resume();
        initialized();
    }

    function resetDistributeFee() public {
        totalRewards = 0;
        distributeFeeCalled = false;
    }

    function distributeFee(uint256 _totalRewards) internal {
        totalRewards = _totalRewards;
        distributeFeeCalled = true;
    }
}
