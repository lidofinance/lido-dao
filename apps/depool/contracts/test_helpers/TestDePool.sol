pragma solidity 0.4.24;

import "../DePool.sol";
import "./VaultMock.sol";


/**
  * @dev Only for testing purposes! DePool version with some functions exposed.
  */
contract TestDePool is DePool {
    address private treasury;
    address private insurance;

    function initialize(ISTETH _token, IValidatorRegistration validatorRegistration, address _oracle,
                        IStakingProvidersRegistry _sps)
    public
    {
        super.initialize(_token, validatorRegistration, _oracle, _sps);
        treasury = address(new VaultMock());
        insurance = address(new VaultMock());
    }

    /**
      * @dev Returns the treasury address
      */
    function getTreasury() public view returns (address) {
        return treasury;
    }

    /**
      * @dev Returns the insurance fund address
      */
    function getInsuranceFund() public view returns (address) {
        return insurance;
    }

    /**
      * @dev Gets unaccounted (excess) Ether on this contract balance
      */
    function getUnaccountedEther() public view returns (uint256) {
        return _getUnaccountedEther();
    }

    /**
      * @dev Padding memory array with zeroes up to 64 bytes on the right
      * @param _b Memory array of size 32 .. 64
      */
    function pad64(bytes memory _b) public pure returns (bytes memory) {
        return _pad64(_b);
    }

    /**
      * @dev Converting value to little endian bytes and padding up to 32 bytes on the right
      * @param _value Number less than `2**64` for compatibility reasons
      */
    function toLittleEndian64(uint256 _value) public pure returns (uint256 result) {
        return _toLittleEndian64(_value);
    }

    function totalWithdrawalRequests() public view returns (uint256) {
        return withdrawalRequests.length;
    }

    function getWithdrawalRequest(uint256 index) public view returns (uint256 amount, bytes32 pubkeyHash) {
        return (withdrawalRequests[index].amount, withdrawalRequests[index].pubkeyHash);
    }
}
