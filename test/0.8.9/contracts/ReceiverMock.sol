contract ReceiverMock {

  bool public canReceive;

  function setCanReceive(bool _value) external {
    canReceive = _value;
  }

  receive() external payable {
    if (!canReceive) {
      revert("RECEIVER_NOT_ACCEPT_TOKENS");
    }
  }
}