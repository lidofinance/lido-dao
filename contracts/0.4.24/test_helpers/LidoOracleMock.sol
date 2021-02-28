// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import "../oracle/LidoOracle.sol";


/**
  * @dev Only for testing purposes! LidoOracle version with some functions exposed.
  */
contract LidoOracleMock is LidoOracle {
    uint256 private time;

    // Original initialize function from v1
    function initialize(
        address _lido,
        uint64 _epochsPerFrame,
        uint64 _slotsPerEpoch,
        uint64 _secondsPerSlot,
        uint64 _genesisTime
    )
        public onlyInit
    {
        assert(1 == ((1 << (MAX_MEMBERS - 1)) >> (MAX_MEMBERS - 1)));  // static assert
        _setBeaconSpec(
            _epochsPerFrame,
            _slotsPerEpoch,
            _secondsPerSlot,
            _genesisTime
        );
        LIDO_POSITION.setStorageAddress(_lido);
        QUORUM_POSITION.setStorageUint256(1);
        emit QuorumChanged(1);
        initialized();

        initialize_v2();
    }

    function _reportSanityChecks(uint256 postTotalPooledEther,
                                 uint256 preTotalPooledEther,
                                 uint256 timeElapsed) internal view {
        // it's possible at the beginning of the work with the contract or in tests
        if (preTotalPooledEther == 0 || postTotalPooledEther == 0 || timeElapsed == 0) return;
        LidoOracle._reportSanityChecks(postTotalPooledEther, preTotalPooledEther, timeElapsed);
    }

    function setTime(uint256 _time) public {
        time = _time;
    }

    function _getTime() internal view returns (uint256) {
        return time;
    }
}
