methods {
    getLength() returns(uint256) envfree
    sumOfBuckets() returns (uint256) envfree
    sumOfIncrements() returns (uint256) envfree
    getBucket(uint256) returns (uint256) envfree
    getCapacity(uint256) returns (uint256) envfree
    getIncrement(uint256) returns (uint256) envfree

    allocate(uint256) returns(uint256) envfree
}

definition bucketLength() returns uint256 = 4;

function nonOverFlow(uint256 allocationSize) returns bool {
    return sumOfBuckets() + allocationSize <= to_mathint(max_uint);
}

rule sumOfIncrementsEqualsAllocated(uint256 allocationSize) {
    require bucketLength() == getLength();
    require nonOverFlow(allocationSize);

    uint256 allocated = allocate(allocationSize);

    assert allocated == sumOfIncrements();
    assert allocated <= allocationSize;
}

rule capacityIsNotSurpassed(uint256 index, uint256 allocationSize) {
    require forall uint256 ind. 
        (ind < bucketLength() => getBucket(ind) <= getCapacity(ind));
    require bucketLength() == getLength();
    require nonOverFlow(allocationSize);

    uint256 allocated = allocate(allocationSize);

    assert getBucket(index) + getIncrement(index) <= getCapacity(index);
}

// Needs refinement.
rule incrementsAreFair(uint256 i, uint256 j, uint256 allocationSize) {
    require bucketLength() == getLength();
    require nonOverFlow(allocationSize);

    uint256 bucket_i = getBucket(i);
    uint256 bucket_j = getBucket(j);
    uint256 capacity_i = getCapacity(i);
    uint256 capacity_j = getCapacity(j);
    allocate(allocationSize);
    uint256 incr_i = getIncrement(i);
    uint256 incr_j = getIncrement(j);

    assert (bucket_i < bucket_j && bucket_i + incr_i < capacity_i) 
        => (incr_i > incr_j || incr_i == 0 && incr_j == 0);
}
