pragma solidity 0.4.24;

import "@aragon/os/contracts/apps/AragonApp.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";

import "@depools/dao/contracts/interfaces/IDePool.sol";
import "@depools/depool-lib/contracts/Pausable.sol";


contract DePool is IDePool, Pausable, AragonApp {
    using SafeMath for uint256;
    using UnstructuredStorage for bytes32;

    /// ACL
    bytes32 constant public PAUSE_ROLE = keccak256("PAUSE_ROLE");
    bytes32 constant public MANAGE_FEE = keccak256("MANAGE_FEE");
    bytes32 constant public MANAGE_WITHDRAWAL_KEY = keccak256("MANAGE_WITHDRAWAL_KEY");
    bytes32 constant public MANAGE_SIGNING_KEYS = keccak256("MANAGE_SIGNING_KEYS");

    bytes32 internal constant FEE_VALUE_POSITION = keccak256("depools.DePool.fee");


    function initialize() public onlyInit {
        initialized();
    }


    /**
      * @notice Stops pool routine operations
      */
    function stop() external auth(PAUSE_ROLE) {
        _stop();
    }

    /**
      * @notice Resumes pool routine operations
      */
    function resume() external auth(PAUSE_ROLE) {
        _resume();
    }


    /**
      * @notice Sets fee rate for the fees accrued when oracles report staking results
      * @param _feeBasisPoints Fee rate, in basis points
      */
    function setFee(uint32 _feeBasisPoints) external auth(MANAGE_FEE) {
        FEE_VALUE_POSITION.setStorageUint256(uint256(_feeBasisPoints));
        emit FeeSet(_feeBasisPoints);
    }

    function _getFee() internal view returns (uint32) {
        uint256 v = FEE_VALUE_POSITION.getStorageUint256();
        assert(v <= uint256(uint32(-1)));
        return uint32(v);
    }

    /**
      * @notice Returns staking rewards fee rate
      */
    function getFee() external view returns (uint32 _feeBasisPoints) {
        return _getFee();
    }
}
