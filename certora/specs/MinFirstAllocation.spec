methods {
    getLength() returns(uint256) envfree
    sumOfBuckets() returns (uint256) envfree
    sumOfCapacities() returns (uint256) envfree
    sumOfIncrements() returns (uint256) envfree
    getBucket(uint256) returns (uint256) envfree
    getCapacity(uint256) returns (uint256) envfree
    getIncrement(uint256) returns (uint256) envfree

    addBucket(uint256, uint256) envfree
    allocate(uint256) returns(uint256) envfree
}

definition bucketLength() returns uint256 = 4;

function nonOverFlow(uint256 allocationSize) returns bool {
    return sumOfBuckets() + allocationSize <= to_mathint(max_uint);
}

rule sumOfIncrementsEqualsAllocated(uint256 allocationSize) {
    require bucketLength() >= getLength();
    require nonOverFlow(allocationSize);

    uint256 allocated = allocate(allocationSize);

    assert allocated == sumOfIncrements();
    assert allocated <= allocationSize;
}

rule capacityIsNeverSurpassed(uint256 index, uint256 allocationSize) {
    require forall uint256 ind. 
        (ind < bucketLength() => getBucket(ind) <= getCapacity(ind));
    require bucketLength() >= getLength();
    require nonOverFlow(allocationSize);

    uint256 allocated = allocate(allocationSize);

    assert getBucket(index) + getIncrement(index) <= getCapacity(index);
}

rule minimumBucketIsAlwaysIncrementedWhenPossible(uint256 allocationSize) {
    require bucketLength() >= getLength();
    require nonOverFlow(allocationSize);
    uint256 i_min;
    uint256 bucket_min = getBucket(i_min);
    uint256 capacity_min = getCapacity(i_min);

    require forall uint256 indx. 
        (indx < bucketLength() && indx != i_min) =>
        (getBucket(indx) > bucket_min);

    allocate(allocationSize);
    uint256 incr_min = getIncrement(i_min);

    assert incr_min > 0 <=> (allocationSize > 0 && bucket_min < capacity_min);
}

rule incrementsReduceDifferences(uint256 i, uint256 j, uint256 allocationSize) {
    require bucketLength() >= getLength();
    require nonOverFlow(allocationSize);

    uint256 bucket_i = getBucket(i);
    uint256 bucket_j = getBucket(j);
    require bucket_i >= bucket_j;
    uint256 diff_before = bucket_i - bucket_j;
    
    allocate(allocationSize);

    uint256 bucket_i_after = bucket_i + getIncrement(i);
    uint256 bucket_j_after = bucket_j + getIncrement(j);

    // We are concerned of cases where the capacities aren't reached.
    require bucket_i_after < getCapacity(i);
    require bucket_j_after < getCapacity(j);

    uint256 diff_after = bucket_i_after >= bucket_j_after ?
        bucket_i_after - bucket_j_after :
        bucket_j_after - bucket_i_after;

    assert diff_after <= diff_before;
}
