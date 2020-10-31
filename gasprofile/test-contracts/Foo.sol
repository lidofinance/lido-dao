pragma solidity ^0.4.24;
import "./Bar.sol";

contract Foo {
    uint s;
    Bar bar;
    
    constructor (address a) public {
        bar = Bar(a);
    }

    function foo (uint c) public  {
        for (uint i=0; i<c; i++ ) {
            s = bar.bar(i);
        }

        if (s > 1) {
            s += 1;
        }       
    }
}
