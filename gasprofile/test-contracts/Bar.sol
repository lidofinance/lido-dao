pragma solidity ^0.4.24;

import "./Baz.sol";

contract Bar {
    uint s;
    Baz baz;

    constructor (address a) public {
        baz = Baz(a);
    }

    function bar (uint i) public returns (uint) {
        uint sum = baz.add(s, i);
        s = sum;
        return sum;
    }
}
