pragma solidity 0.4.24;

library SharesRoundingMath {
    uint256 internal constant VALUE_LENGTH = 236;
    uint256 internal constant PRECISION_LENGTH = 20;

    function fromStoredSharesToShiftedSharesValue(uint256 _storedShares) internal pure returns (uint256) {
        return _storedShares << PRECISION_LENGTH;
    }

    function fromShiftedSharesToStoredSharesValue(uint256 _shiftedShares) internal pure returns (uint256) {
        return _shiftedShares >> PRECISION_LENGTH;
    }

    function fromStoredSharesToStoredSharesValue(uint256 _storedShares) internal pure returns (uint256) {
        return _storedShares << PRECISION_LENGTH >> PRECISION_LENGTH;
    }

    function fromStoredSharesToShiftedShares(uint256 _storedShares) internal pure returns (uint256) {
        return (_storedShares << PRECISION_LENGTH) + (_storedShares >> VALUE_LENGTH);
    }

    function fromStoredSharesToStoredPrecision(uint256 _storedShares) internal pure returns (uint256) {
        return _storedShares >> VALUE_LENGTH << VALUE_LENGTH;
    }

    function fromShiftedSharesToStoredShares(uint256 _shiftedShares) internal pure returns (uint256) {
        return (_shiftedShares << VALUE_LENGTH) + (_shiftedShares >> PRECISION_LENGTH);
    }
}
