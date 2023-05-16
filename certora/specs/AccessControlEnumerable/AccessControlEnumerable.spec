methods {
    function hasRole(bytes32, address) external returns (bool) envfree;
    function getRoleAdmin(bytes32) external returns (bytes32) envfree;
    function contains(bytes32, address) external returns (bool) envfree;
    function getRoleMember(bytes32, uint256) external returns (address) envfree;
    function getRoleMemberCount(bytes32) external returns (uint256) envfree;
    function indexOfMember(bytes32, address) external returns (uint256) envfree;
    function realValue(bytes32, uint256) external returns (uint256) envfree;
}

definition roleChangingMethods(method f) returns bool = 
    f.selector == sig:revokeRole(bytes32,address).selector ||
    f.selector == sig:renounceRole(bytes32,address).selector ||
    f.selector == sig:grantRole(bytes32,address).selector;

invariant indexNeverSurpassesLength(bytes32 role, address account)
    indexOfMember(role, account) <= getRoleMemberCount(role)
    && getRoleMemberCount(role) < max_uint
    && to_mathint(realValue(role, require_uint256(indexOfMember(role, account)-1))) < to_mathint(1 << 160)
    filtered{f -> roleChangingMethods(f)}
    {
        preserved grantRole(bytes32 role0, address account0) with (env e)
            {requireInvariant valueIndexConsistency(role0, account0);}

        preserved revokeRole(bytes32 role0, address account0) with (env e)
            {requireInvariant valueIndexConsistency(role0, account0);
            requireInvariant valueIndexConsistency(role, account);}

        preserved renounceRole(bytes32 role0, address account0) with (env e)
            {requireInvariant valueIndexConsistency(role0, account0);
            requireInvariant valueIndexConsistency(role, account);}
    }

invariant valueIndexConsistency(bytes32 role, address account) 
    indexOfMember(role, account) != 0 =>
    getRoleMember(role, require_uint256(indexOfMember(role, account)-1)) == account
    filtered{f -> roleChangingMethods(f)}
    {
        preserved revokeRole(bytes32 role0, address account0) with (env e) {
            requireInvariant valueIndexConsistency(role0, account0);}

        preserved renounceRole(bytes32 role0, address account0) with (env e) {
            requireInvariant valueIndexConsistency(role0, account0);}
    }

invariant containsRole(bytes32 role, address account)
    contains(role, account) <=> hasRole(role, account)
    filtered{f -> roleChangingMethods(f)}
    {
        preserved grantRole(bytes32 role0, address account0) with (env e) {
            requireInvariant valueIndexConsistency(role0, account0);
        }

        preserved revokeRole(bytes32 role0, address account0) with (env e) {
            requireInvariant indexNeverSurpassesLength(role, account);}

        preserved renounceRole(bytes32 role0, address account0) with (env e) {
            requireInvariant indexNeverSurpassesLength(role, account);}
    }

invariant noDuplicates(bytes32 role, uint256 index1, uint256 index2)
    (index1 < getRoleMemberCount(role) &&
    index2 < getRoleMemberCount(role) &&
    index1 != index2) =>
    getRoleMember(role, index1) != getRoleMember(role, index2)
    {
        preserved revokeRole(bytes32 role0, address account0) with (env e) {
            requireInvariant noDuplicates(role, index1, require_uint256(getRoleMemberCount(role)-1));
            requireInvariant noDuplicates(role, index2, require_uint256(getRoleMemberCount(role)-1));}

        preserved renounceRole(bytes32 role0, address account0) with (env e) {
            requireInvariant noDuplicates(role, index1, require_uint256(getRoleMemberCount(role)-1));
            requireInvariant noDuplicates(role, index2, require_uint256(getRoleMemberCount(role)-1));}
    }


rule roleSetAfterRevoke(bytes32 role, address account) {
    env e;
        revokeRole(e, role, account);
    assert !contains(role, account);
}

rule canRevokeAfterGrant(bytes32 role, address sender) {
    env e1;
    env e2;
    require e1.msg.sender == e2.msg.sender;
    require e2.msg.value == 0;

    requireInvariant indexNeverSurpassesLength(role, sender);
    
    grantRole(e1, role, sender);
    revokeRole@withrevert(e2, role, sender);

    assert !lastReverted;
}

rule canGrantAfterRevoke(bytes32 role, address sender1, address sender2) {
    env e1;
    env e2;
    require e1.msg.sender == e2.msg.sender;
    require e2.msg.value == 0;

    requireInvariant containsRole(role, sender1);
    requireInvariant containsRole(role, sender2);

    bytes32 role_grant = getRoleAdmin(role);
    revokeRole(e1, role, sender1);
    grantRole@withrevert(e2, role, sender2);

    assert lastReverted => role_grant == role;
}

rule canAlwaysRenounce(bytes32 role) {
    env e;
    require e.msg.value == 0;
    require e.msg.sender !=0;
    requireInvariant indexNeverSurpassesLength(role, e.msg.sender);

    renounceRole@withrevert(e, role, e.msg.sender);

    assert !lastReverted;
}

rule oneRoleAtATime(method f, bytes32 role, address sender) 
filtered{f -> roleChangingMethods(f)} {
    env e;
    calldataarg args;

    address otherSender;
    bytes32 otherRole;

    bool has_role_before_0 = hasRole(role, sender);
    bool has_role_before_1 = hasRole(role, otherSender);
    bool has_role_before_2 = hasRole(otherRole, sender);
    bool contains_before_0 = contains(role, sender);
    bool contains_before_1 = contains(role, otherSender);
    bool contains_before_2 = contains(otherRole, sender);
        f(e, args);
    bool has_role_after_0 = hasRole(role, sender);
    bool has_role_after_1 = hasRole(role, otherSender);
    bool has_role_after_2 = hasRole(otherRole, sender);
    bool contains_after_0 = contains(role, sender);
    bool contains_after_1 = contains(role, otherSender);
    bool contains_after_2 = contains(otherRole, sender);

    assert (
            has_role_before_0 != has_role_after_0 &&
            has_role_before_1 != has_role_after_1) =>
            otherSender == sender;

    assert (
            has_role_before_0 != has_role_after_0 &&
            has_role_before_2 != has_role_after_2) =>
            otherRole == role;

    assert (
            contains_before_0 != contains_after_0 &&
            contains_after_1 != contains_after_1) =>
            otherSender == sender;

    assert (
            contains_before_0 != contains_after_0 &&
            contains_after_2 != contains_after_2) =>
            otherRole == role;
}

rule whoChangedRoles(method f, bytes32 role, address sender) 
filtered{f -> roleChangingMethods(f)} {
    env e;
    bool has_role;

    bool has_role_before = hasRole(role, sender);
    bool has_admin_role = hasRole(getRoleAdmin(role), e.msg.sender);
        if(f.selector == sig:revokeRole(bytes32,address).selector) {
            revokeRole(e, role, sender);
            require !has_role;
        }
        else if(f.selector == sig:renounceRole(bytes32,address).selector) {
            renounceRole(e, role, sender);
            require !has_role;
            assert sender == e.msg.sender;
        }
        else if(f.selector == sig:grantRole(bytes32,address).selector) {
            grantRole(e, role, sender);
            require has_role;
        }
        else {
            require false;
        }
    bool has_role_after = hasRole(role, sender);
    
    if(f.selector != sig:renounceRole(bytes32,address).selector) {
        assert has_admin_role;
    }
    assert has_role_after == has_role;
}

rule roleSetAfterGrant(bytes32 role, address account) {
    env e;
    require getRoleMemberCount(role) < max_uint;
        grantRole(e, role, account);
    assert contains(role, account);
}