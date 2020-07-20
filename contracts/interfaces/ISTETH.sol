pragma solidity 0.4.24;


/**
  * @title Liquid version of ETH 2.0 native token
  */
interface ISTETH {
    /**
      * @notice Stops transfers
      */
    function stop() external;

    /**
      * @notice Resumes transfers
      */
    function resume() external;

    event Stopped();
    event Resumed();
}
