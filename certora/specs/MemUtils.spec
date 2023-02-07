methods{
    test1(uint256, uint256, uint256) returns (uint256, uint256, uint256) envfree
}

definition Whole() returns mathint = max_uint + 1;

function readWordAtOffset_CVL(uint256 a, uint256 b, uint256 c, uint8 offset) returns mathint {
    require(offset <= 96);
    mathint num = a + b*Whole() + c*Whole()*Whole();

    uint256 index = offset*8;
    mathint shift = 1 << index;
    mathint numShifted = num / shift;
    return numShifted - (numShifted / Whole())*Whole();
}

rule Test1(uint256 a, uint256 b, uint256 c) {
    uint256 A;
    uint256 B;
    uint256 C;
    A, B, C = test1(a,b,c);
    assert A == a && B == b && C == c;
}

rule checkReadOffset(uint256 a, uint256 b, uint8 offset) {
    mathint num = readWordAtOffset_CVL(1,0,0,offset);
    assert offset != 0 => num == 0;
    assert offset == 0 => num == 1;
}

rule alwaysReverts(method f) {
    env e;
    require e.msg.value == 0;
    calldataarg args;
    f@withrevert(e, args);
    assert lastReverted;
}

rule neverReverts(method f) {
    env e;
    require e.msg.value == 0;
    calldataarg args;
    f@withrevert(e, args);
    assert !lastReverted;
}