methods {
    name()                                returns (string) envfree
    ymbol()                              returns (string) envfree
    decimals()                            returns (uint8) envfree   
    totalSupply()                         returns (uint256) envfree 
    balanceOf(address)                    returns (uint256) envfree 
    allowance(address,address)            returns (uint256) envfree
    approve(address,uint256)              returns (bool) 
    transfer(address,uint256)             returns (bool) 
    transferFrom(address,address,uint256) returns (bool) 
    increaseAllowance(address, uint256) returns (bool)  
    decreaseAllowance(address, uint256) returns (bool)  

    getTotalPooledEther() returns (uint256) envfree  
    getTotalShares() returns (uint256) envfree     
    sharesOf(address) returns (uint256) envfree
    getSharesByPooledEth(uint256) returns (uint256) envfree
    getPooledEthByShares(uint256) returns (uint256) envfree
    transferShares(address, uint256) returns (uint256)
    transferSharesFrom(address, address, uint256) returns (uint256)

    // Lido
    pauseStaking()
    resumeStaking()
    setStakingLimit(uint256, uint256)
    removeStakingLimit()
    isStakingPaused() returns (bool) envfree
    getCurrentStakeLimit() returns (uint256)
    getStakeLimitFullInfo() returns (bool, bool, uint256, uint256, uint256, uint256, uint256)
    submit(address) returns (uint256) //payable
    receiveELRewards() //payable
    depositBufferedEther()
    depositBufferedEther(uint256)
    burnShares(address, uint256) returns (uint256)
    stop()
    resume()
    setFee(uint16)
    setFeeDistribution(uint16, uint16, uint16)
    setProtocolContracts(address, address, address)
    setWithdrawalCredentials(bytes32)
    setELRewardsVault(address)
    setELRewardsWithdrawalLimit(uint16)
    handleOracleReport(uint256, uint256)
    transferToVault(address)
    getFee() returns (uint16) envfree
    getFeeDistribution() returns (uint16, uint16, uint16) envfree
    getWithdrawalCredentials() returns (bytes32) envfree
    getBufferedEther() returns (uint256) envfree
    getTotalELRewardsCollected() returns (uint256) envfree
    getELRewardsWithdrawalLimit() returns (uint256) envfree
    // getDepositContract() public view returns (IDepositContract)
    getOracle() returns (address) envfree
    // getOperators() public view returns (INodeOperatorsRegistry)
    getTreasury() returns (address) envfree
    getInsuranceFund() returns (address) envfree
    getBeaconStat() returns (uint256, uint256, uint256) envfree
    getELRewardsVault() returns (address) envfree

    getIsStopped() returns (bool) envfree

    // mint(address,uint256)
    // burn(uint256)
    // burn(address,uint256)
    // burnFrom(address,uint256)
    // initialize(address)
}

/**
Verify that there is no fee on transferFrom.
**/
rule noFeeOnTransferFrom(address alice, address bob, uint256 amount) {
    env e;
    require alice != bob;
    require allowance(alice, e.msg.sender) >= amount;
    uint256 sharesBalanceBeforeBob = sharesOf(bob);
    uint256 sharesBalanceBeforeAlice = sharesOf(alice);

    uint256 actualSharesAmount = getSharesByPooledEth(amount);

    transferFrom(e, alice, bob, amount);

    uint256 sharesBalanceAfterBob = sharesOf(bob);
    uint256 sharesBalanceAfterAlice = sharesOf(alice);

    assert sharesBalanceAfterBob == sharesBalanceBeforeBob + actualSharesAmount;
    assert sharesBalanceAfterAlice == sharesBalanceBeforeAlice - actualSharesAmount;
}

/**
Verify that there is no fee on transferSharesFrom.
**/
rule noFeeOnTransferSharesFrom(address alice, address bob, uint256 amount) {
    env e;
    require alice != bob;
    require allowance(alice, e.msg.sender) >= amount;
    uint256 sharesBalanceBeforeBob = sharesOf(bob);
    uint256 sharesBalanceBeforeAlice = sharesOf(alice);

    transferSharesFrom(e, alice, bob, amount);

    uint256 sharesBalanceAfterBob = sharesOf(bob);
    uint256 sharesBalanceAfterAlice = sharesOf(alice);

    assert sharesBalanceAfterBob == sharesBalanceBeforeBob + amount;
    assert sharesBalanceAfterAlice == sharesBalanceBeforeAlice - amount;
}

/**
Verify that there is no fee on transfer.
**/
rule noFeeOnTransfer(address bob, uint256 amount) {
    env e;
    require bob != e.msg.sender;
    uint256 balanceSenderBefore = sharesOf(e.msg.sender);
    uint256 balanceBefore = sharesOf(bob);

    uint256 actualSharesAmount = getSharesByPooledEth(amount);

    transfer(e, bob, amount);

    uint256 balanceAfter = sharesOf(bob);
    uint256 balanceSenderAfter = sharesOf(e.msg.sender);
    assert balanceAfter == balanceBefore + actualSharesAmount;
    assert balanceSenderAfter == balanceSenderBefore - actualSharesAmount;
}

/**
Verify that there is no fee on transferShares.
**/
rule noFeeOnTransferShares(address bob, uint256 amount) {
    env e;
    require bob != e.msg.sender;
    uint256 balanceSenderBefore = sharesOf(e.msg.sender);
    uint256 balanceBefore = sharesOf(bob);

    transferShares(e, bob, amount);

    uint256 balanceAfter = sharesOf(bob);
    uint256 balanceSenderAfter = sharesOf(e.msg.sender);
    assert balanceAfter == balanceBefore + amount;
    assert balanceSenderAfter == balanceSenderBefore - amount;
}

/**
Token transfer works correctly. Balances are updated if not reverted. 
If reverted then the transfer amount was too high, or the recipient either 0, the same as the sender or the currentContract.
**/
rule transferCorrect(address to, uint256 amount) {
    env e;
    require e.msg.value == 0 && e.msg.sender != 0;
    uint256 fromBalanceBefore = sharesOf(e.msg.sender);
    uint256 toBalanceBefore = sharesOf(to);
    require fromBalanceBefore + toBalanceBefore <= max_uint256;
    require getIsStopped() == false;
    uint256 actualSharesAmount = getSharesByPooledEth(amount);

    transfer@withrevert(e, to, amount);
    bool reverted = lastReverted;
    if (!reverted) {
        if (e.msg.sender == to) {
            assert sharesOf(e.msg.sender) == fromBalanceBefore;
        } else {
            assert sharesOf(e.msg.sender) == fromBalanceBefore - actualSharesAmount;
            assert sharesOf(to) == toBalanceBefore + actualSharesAmount;
        }
    } else {
        assert actualSharesAmount > fromBalanceBefore || to == 0 || e.msg.sender == to || to == currentContract;
    }
}

/**
Test that transferFrom works correctly. Balances are updated if not reverted.
**/
rule transferFromCorrect(address from, address to, uint256 amount) {
    env e;
    require e.msg.value == 0;
    uint256 fromBalanceBefore = sharesOf(from);
    uint256 toBalanceBefore = sharesOf(to);
    uint256 allowanceBefore = allowance(from, e.msg.sender);
    require fromBalanceBefore + toBalanceBefore <= max_uint256;
    uint256 actualSharesAmount = getSharesByPooledEth(amount);

    transferFrom(e, from, to, amount);

    assert from != to =>
        sharesOf(from) == fromBalanceBefore - actualSharesAmount &&
        sharesOf(to) == toBalanceBefore + actualSharesAmount;
}

/**
Test that transferSharesFrom works correctly. Balances are updated if not reverted.
**/
rule transferSharesFromCorrect(address from, address to, uint256 amount) {
    env e;
    require e.msg.value == 0;
    uint256 fromBalanceBefore = sharesOf(from);
    uint256 toBalanceBefore = sharesOf(to);
    uint256 allowanceBefore = allowance(from, e.msg.sender);
    require fromBalanceBefore + toBalanceBefore <= max_uint256;
    uint256 tokenAmount = getPooledEthByShares(amount);

    transferSharesFrom(e, from, to, amount);

    assert from != to =>
        sharesOf(from) == fromBalanceBefore - amount &&
        sharesOf(to) == toBalanceBefore + amount;
}

/**
transferFrom should revert if and only if the amount is too high or the recipient is 0 or the contract itself.
**/
rule transferFromReverts(address from, address to, uint256 amount) {
    env e;
    uint256 allowanceBefore = allowance(from, e.msg.sender);
    uint256 fromBalanceBefore = sharesOf(from);
    require from != 0 && e.msg.sender != 0;
    require e.msg.value == 0;
    require fromBalanceBefore + sharesOf(to) <= max_uint256;
    require getIsStopped() == false;
    uint256 actualSharesAmount = getSharesByPooledEth(amount);

    transferFrom@withrevert(e, from, to, amount);

    assert lastReverted <=> (allowanceBefore < amount || actualSharesAmount > fromBalanceBefore || to == 0 || to == currentContract);
}

/**
transferFrom should revert if and only if the amount is too high or the recipient is 0 or the contract itself.
**/
rule transferSharesFromReverts(address from, address to, uint256 amount) {
    env e;
    uint256 allowanceBefore = allowance(from, e.msg.sender);
    uint256 fromBalanceBefore = sharesOf(from);
    require from != 0 && e.msg.sender != 0;
    require e.msg.value == 0;
    require fromBalanceBefore + sharesOf(to) <= max_uint256;
    require getIsStopped() == false;
    uint256 tokenAmount = getPooledEthByShares(amount);

    transferSharesFrom@withrevert(e, from, to, amount);

    assert lastReverted <=> (allowanceBefore < tokenAmount || amount > fromBalanceBefore || to == 0 || to == currentContract);
}

/**
Allowance changes correctly as a result of calls to approve, transferFrom, transferSharesFrom, increaseAllowance, decreaseAllowance.
**/
rule ChangingAllowance(method f, address from, address spender) 
    filtered{ f -> f.selector != initialize(address, address).selector && f.selector != finalizeUpgrade_v2(address,address).selector } {
    uint256 allowanceBefore = allowance(from, spender);
    env e;
    if (f.selector == approve(address, uint256).selector) {
        address spender_;
        uint256 amount;
        approve(e, spender_, amount);
        if (from == e.msg.sender && spender == spender_) {
            assert allowance(from, spender) == amount;
        } else {
            assert allowance(from, spender) == allowanceBefore;
        }
    } else if (f.selector == transferFrom(address,address,uint256).selector || f.selector == transferSharesFrom(address,address,uint256).selector) {
        address from_;
        address to;
        address amount;
        transferFrom(e, from_, to, amount);
        uint256 allowanceAfter = allowance(from, spender);
        if (from == from_ && spender == e.msg.sender) {
            assert from == to || allowanceBefore == max_uint256 || allowanceAfter == allowanceBefore - amount;
        } else {
            assert allowance(from, spender) == allowanceBefore;
        }
    } else if (f.selector == decreaseAllowance(address, uint256).selector) {
        address spender_;
        uint256 amount;
        require amount <= allowanceBefore;
        decreaseAllowance(e, spender_, amount);
        if (from == e.msg.sender && spender == spender_) {
            assert allowance(from, spender) == allowanceBefore - amount;
        } else {
            assert allowance(from, spender) == allowanceBefore;
        }
    } else if (f.selector == increaseAllowance(address, uint256).selector) {
        address spender_;
        uint256 amount;
        require amount + allowanceBefore < max_uint256;
        increaseAllowance(e, spender_, amount);
        if (from == e.msg.sender && spender == spender_) {
            assert allowance(from, spender) == allowanceBefore + amount;
        } else {
            assert allowance(from, spender) == allowanceBefore;
        }
    } else {
        calldataarg args;
        f(e, args);
        assert allowance(from, spender) == allowanceBefore;
    }
}

/**
Transfer from msg.sender to recipient doesn't change the balance of other addresses.
**/
rule TransferDoesntChangeOtherBalance(address to, uint256 amount, address other) {
    env e;
    require other != e.msg.sender;
    require other != to && other != currentContract;
    uint256 balanceBefore = sharesOf(other);
    transfer(e, to, amount); 
    assert balanceBefore == sharesOf(other);
}

/**
Transfer from sender to recipient using transferFrom doesn't change the balance of other addresses.
**/
rule TransferFromDoesntChangeOtherBalance(address from, address to, uint256 amount, address other) {
    env e;
    require other != from;
    require other != to;
    uint256 balanceBefore = sharesOf(other);
    transferFrom(e, from, to, amount); 
    assert balanceBefore == sharesOf(other);
}

/**
Transfer shares from sender to recipient using transferFrom doesn't change the balance of other addresses.
**/
rule TransferSharesFromDoesntChangeOtherBalance(address from, address to, uint256 amount, address other) {
    env e;
    require other != from;
    require other != to;
    uint256 balanceBefore = sharesOf(other);
    transferSharesFrom(e, from, to, amount); 
    assert balanceBefore == sharesOf(other);
}

/**************************************************
 *                METHOD INTEGRITY                *
 **************************************************/

/**************************************************
 *                   HIGH LEVEL                   *
 **************************************************/

/**************************************************
 *                   INVARIANTS                   *
 **************************************************/

// invariant balanceOfCanrExceedTotalSuply(address user) 
//     balanceOf(user) <= totalSupply()

// invariant sharesOfCantExceedTotalShares(address user)
//     sharesOf(user) <= getTotalShares()

// /**
// This rule finds which functions are privileged.
// A function is privileged if only one address can call it.
// The rule identifies this by checking which functions can be called by two different users.
// **/
// rule privilegedOperation(method f, address privileged){
// 	env e1;
// 	calldataarg arg;
// 	require e1.msg.sender == privileged;

// 	storage initialStorage = lastStorage;
// 	f@withrevert(e1, arg); // privileged succeeds executing candidate privileged operation.
// 	bool firstSucceeded = !lastReverted;

// 	env e2;
// 	calldataarg arg2;
// 	require e2.msg.sender != privileged;
// 	f@withrevert(e2, arg2) at initialStorage; // unprivileged
// 	bool secondSucceeded = !lastReverted;

// 	assert  !(firstSucceeded && secondSucceeded), "${f.selector} can be called by both ${e1.msg.sender} and ${e2.msg.sender}, so it is not privileged";
// }


// rule sanity(method f)
// {
// 	env e;
// 	calldataarg arg;
// 	sinvoke f(e, arg);
// 	assert false;
// }
