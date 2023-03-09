// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts v4.4.1
//
// Adopted AccessControl tests from:
// https://github.com/OpenZeppelin/openzeppelin-contracts/tree/dad73159df3d3053c72b5e430fa8164330f18068/test/access
//

const { makeInterfaceId } = require('@openzeppelin/test-helpers')
const { artifacts, contract, web3, ethers } = require('hardhat')

const { assert } = require('../../helpers/assert')
const { EvmSnapshot } = require('../../helpers/blockchain')

const AccessControlEnumerableMock = artifacts.require('AccessControlEnumerableMock.sol')

const DEFAULT_ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000'
const ROLE = web3.utils.soliditySha3('ROLE')
const OTHER_ROLE = web3.utils.soliditySha3('OTHER_ROLE')

const AccessControlInterface = [
  'hasRole(bytes32,address)',
  'getRoleAdmin(bytes32)',
  'grantRole(bytes32,address)',
  'revokeRole(bytes32,address)',
  'renounceRole(bytes32,address)',
]

const AccessControlEnumerableInterface = [
  'hasRole(bytes32,address)',
  'getRoleAdmin(bytes32)',
  'grantRole(bytes32,address)',
  'revokeRole(bytes32,address)',
  'renounceRole(bytes32,address)',
]

const deployAccessControlEnumerable = async ({ owner }) => {
  const ac = await AccessControlEnumerableMock.new({ from: owner })
  return ac
}

contract('AccessControlEnumerable', ([admin, authorized, other, otherAdmin, otherAuthorized]) => {
  let ac
  const snapshot = new EvmSnapshot(ethers.provider)

  before('deploy', async () => {
    ac = await deployAccessControlEnumerable({ admin })
    await snapshot.make()
  })

  afterEach(async () => {
    await snapshot.rollback()
  })

  it('supports interfaces', async () => {
    assert(await ac.supportsInterface(makeInterfaceId.ERC165(AccessControlInterface)))
    assert(await ac.supportsInterface(makeInterfaceId.ERC165(AccessControlEnumerableInterface)))
  })

  describe('default admin', function () {
    it('deployer has default admin role', async function () {
      assert(await ac.hasRole(DEFAULT_ADMIN_ROLE, admin))
    })

    it("other roles's admin is the default admin role", async function () {
      assert.equals(await ac.getRoleAdmin(admin), DEFAULT_ADMIN_ROLE)
    })

    it("default admin role's admin is itself", async function () {
      assert.equals(await ac.getRoleAdmin(DEFAULT_ADMIN_ROLE), DEFAULT_ADMIN_ROLE)
    })
  })

  describe('granting', function () {
    beforeEach(async function () {
      await ac.grantRole(ROLE, authorized, { from: admin })
    })

    it('non-admin cannot grant role to other accounts', async function () {
      await assert.reverts(
        ac.grantRole(ROLE, authorized, { from: other }),
        `AccessControl: account ${other.toLowerCase()} is missing role ${DEFAULT_ADMIN_ROLE}`
      )
    })

    it('accounts can be granted a role multiple times', async function () {
      await ac.grantRole(ROLE, authorized, { from: admin })
      const receipt = await ac.grantRole(ROLE, authorized, { from: admin })
      assert.notEmits(receipt, 'RoleGranted')
    })
  })

  describe('renouncing', function () {
    it('roles that are not had can be renounced', async function () {
      const receipt = await ac.renounceRole(ROLE, authorized, { from: authorized })
      assert.notEmits(receipt, 'RoleRevoked')
    })

    context('with granted role', function () {
      beforeEach(async function () {
        await ac.grantRole(ROLE, authorized, { from: admin })
      })

      it('bearer can renounce role', async function () {
        const receipt = await ac.renounceRole(ROLE, authorized, { from: authorized })
        assert.emits(receipt, 'RoleRevoked', { account: authorized, role: ROLE, sender: authorized })

        assert(!(await ac.hasRole(ROLE, authorized)))
      })

      it('only the sender can renounce their roles', async function () {
        await assert.reverts(
          ac.renounceRole(ROLE, authorized, { from: admin }),
          'AccessControl: can only renounce roles for self'
        )
      })

      it('a role can be renounced multiple times', async function () {
        await ac.renounceRole(ROLE, authorized, { from: authorized })

        const receipt = await ac.renounceRole(ROLE, authorized, { from: authorized })
        assert.notEmits(receipt, 'RoleRevoked')
      })
    })
  })

  describe('setting role admin', function () {
    beforeEach(async function () {
      const receipt = await ac.setRoleAdmin(ROLE, OTHER_ROLE)
      assert.emits(receipt, 'RoleAdminChanged', {
        role: ROLE,
        previousAdminRole: DEFAULT_ADMIN_ROLE,
        newAdminRole: OTHER_ROLE,
      })

      await ac.grantRole(OTHER_ROLE, otherAdmin, { from: admin })
    })

    it("a role's admin role can be changed", async function () {
      assert.equals(await ac.getRoleAdmin(ROLE), OTHER_ROLE)
    })

    it('the new admin can grant roles', async function () {
      const receipt = await ac.grantRole(ROLE, authorized, { from: otherAdmin })
      assert.emits(receipt, 'RoleGranted', { account: authorized, role: ROLE, sender: otherAdmin })
    })

    it('the new admin can revoke roles', async function () {
      await ac.grantRole(ROLE, authorized, { from: otherAdmin })
      const receipt = await ac.revokeRole(ROLE, authorized, { from: otherAdmin })
      assert.emits(receipt, 'RoleRevoked', { account: authorized, role: ROLE, sender: otherAdmin })
    })

    it("a role's previous admins no longer grant roles", async function () {
      await assert.reverts(
        ac.grantRole(ROLE, authorized, { from: admin }),
        `AccessControl: account ${admin.toLowerCase()} is missing role ${OTHER_ROLE}`
      )
    })

    it("a role's previous admins no longer revoke roles", async function () {
      await assert.reverts(
        ac.revokeRole(ROLE, authorized, { from: admin }),
        `AccessControl: account ${admin.toLowerCase()} is missing role ${OTHER_ROLE}`
      )
    })
  })

  describe('onlyRole modifier', function () {
    beforeEach(async function () {
      await ac.grantRole(ROLE, authorized, { from: admin })
    })

    it('do not revert if sender has role', async function () {
      await ac.senderProtected(ROLE, { from: authorized })
    })

    it("revert if sender doesn't have role #1", async function () {
      await assert.reverts(
        ac.senderProtected(ROLE, { from: other }),
        `AccessControl: account ${other.toLowerCase()} is missing role ${ROLE}`
      )
    })

    it("revert if sender doesn't have role #2", async function () {
      await assert.reverts(
        ac.senderProtected(OTHER_ROLE, { from: authorized }),
        `AccessControl: account ${authorized.toLowerCase()} is missing role ${OTHER_ROLE}`
      )
    })
  })

  describe('enumerating', function () {
    it('role bearers can be enumerated', async function () {
      await ac.grantRole(ROLE, authorized, { from: admin })
      await ac.grantRole(ROLE, other, { from: admin })
      await ac.grantRole(ROLE, otherAuthorized, { from: admin })
      await ac.revokeRole(ROLE, other, { from: admin })

      const memberCount = await ac.getRoleMemberCount(ROLE)
      assert.equals(memberCount, 2)

      const bearers = []
      for (let i = 0; i < memberCount; ++i) {
        bearers.push(await ac.getRoleMember(ROLE, i))
      }

      assert(bearers.includes(authorized))
      assert(bearers.includes(otherAuthorized))
    })
    it('role enumeration should be in sync after renounceRole call', async function () {
      assert.equals(await ac.getRoleMemberCount(ROLE), 0)
      await ac.grantRole(ROLE, admin, { from: admin })
      assert.equals(await ac.getRoleMemberCount(ROLE), 1)
      await ac.renounceRole(ROLE, admin, { from: admin })
      assert.equals(await ac.getRoleMemberCount(ROLE), 0)
    })
  })
})
