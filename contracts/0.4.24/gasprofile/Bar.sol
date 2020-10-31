pragma solidity ^0.4.24;

contract Bar {
    uint s;
    
    function bar (uint i) public returns (uint) {
        s = s + i;
        return s;
    }    
}
