methods {
    WSTETH.totalSupply()                         returns (uint256) envfree 
    WSTETH.balanceOf(address)                    returns (uint256) envfree 
    WSTETH.allowance(address,address)            returns (uint256) 
    WSTETH.approve(address,uint256)              returns (bool) 
    WSTETH.transfer(address,uint256)             returns (bool) 
    WSTETH.transferFrom(address,address,uint256) returns (bool) 
    WSTETH.unwrap(uint256) returns (uint256)
}
