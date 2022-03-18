// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import "../voting/Voting.sol";
import "@aragon/contract-helpers-test/contracts/0.4/aragonOS/TimeHelpersMock.sol";


/**
  * @dev This is a mock. Don't use in production.
  */
contract VotingMock is Voting, TimeHelpersMock {
    /* Ugly hack to work around this issue:
     * https://github.com/trufflesuite/truffle/issues/569
     * https://github.com/trufflesuite/truffle/issues/737
     */
    function newVoteExt(bytes _executionScript, string _metadata, bool _castVote, bool _executesIfDecided)
        external
        returns (uint256 voteId)
    {
        voteId = _newVote(_executionScript, _metadata, _castVote, _executesIfDecided);
        emit StartVote(voteId, msg.sender, _metadata);
    }

    // _isValuePct public wrapper
    function isValuePct(uint256 _value, uint256 _total, uint256 _pct) external pure returns (bool) {
        return _isValuePct(_value, _total, _pct);
    }

    // Mint a token and create a vote in the same transaction to test snapshot block values are correct
    function newTokenAndVote(address _holder, uint256 _tokenAmount, string _metadata)
        external
        returns (uint256 voteId)
    {
        token.generateTokens(_holder, _tokenAmount);

        bytes memory noScript = new bytes(0);
        voteId = _newVote(noScript, _metadata, false, false);
        emit StartVote(voteId, msg.sender, _metadata);
    }
}