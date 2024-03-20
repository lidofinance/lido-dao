const { contract, artifacts, ethers } = require('hardhat')
const { assert } = require('../../helpers/assert')

const { EvmSnapshot } = require('../../helpers/blockchain')

// npx hardhat test --grep "Multiprover"
const Multiprover = artifacts.require('Multiprover')

contract('Multiprover', ([deployer]) => {
  let multiprover
  let snapshot

  const log = console.log
  // const log = () => {}

  before('Deploy multiprover', async function () {
    multiprover = await Multiprover.new(deployer)
    log('multiprover address', multiprover.address)

    snapshot = new EvmSnapshot(ethers.provider)
    await snapshot.make()
  })

  afterEach(async () => {
    await snapshot.rollback()
  })

  describe('Multiprover is functional', () => {
    it(`have zero members`, async () => {
      const members = await multiprover.getMembers()
      assert.equal(members.length, 0)
      log('members', members)
    })
    it(`can add members`, async () => {
      const role = await multiprover.MANAGE_MEMBERS_AND_QUORUM_ROLE()
      log('role', role)
      await multiprover.grantRole(role, deployer)

      await multiprover.addMember(deployer, 1)

      const members = await multiprover.getMembers()
      log('members', members)
    })
  })
})
