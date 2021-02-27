const { assert } = require('chai')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')
const { bn } = require('@aragon/contract-helpers-test')
const { toBN } = require('../helpers/utils')

const ReportUtils = artifacts.require('ReportUtilsMock.sol')

contract('ReportUtils', ([testUser]) => {
  let utils

  before('deploy base app', async () => {
    utils = await ReportUtils.new()
  })

  it('encode-decode min', async () => {
    const raw = await utils.encode(0, 0)
    assertBn(await utils.getCount(raw), 0)

    const report = await utils.decode(raw)
    assertBn(report.beaconBalance, 0)
    assertBn(report.beaconValidators, 0)

    const reportWithCount = await utils.decodeWithCount(raw)
    assertBn(reportWithCount.beaconBalance, 0)
    assertBn(reportWithCount.beaconValidators, 0)
    assertBn(reportWithCount.count, 0)
  })

  it('encode-decode max', async () => {
    const MAX_BALLANCE = toBN(10).pow(toBN(18))
    const raw = await utils.encode(MAX_BALLANCE, 1e9)
    assertBn(await utils.getCount(raw), 0)

    const report = await utils.decode(raw)
    assertBn(report.beaconBalance, MAX_BALLANCE)
    assertBn(report.beaconValidators, 1e9)

    const reportWithCount = await utils.decodeWithCount(raw.add(toBN(255)))
    assertBn(reportWithCount.beaconBalance, MAX_BALLANCE)
    assertBn(reportWithCount.beaconValidators, 1e9)
    assertBn(reportWithCount.count, 255)
  })

  it('counter arithmetic', async () => {
    const raw = await utils.encode(0, 0)
    assertBn(await utils.getCount(raw), 0)
    assertBn(await utils.getCount(raw + 1), 1)
    assertBn(await utils.getCount(raw + 255), 255)
  })

  it('is exactly the same', async () => {
    const one = await utils.encode(32 * 1e9, 1)
    const two = await utils.encode(32 * 1e9, 2)
    const tri = await utils.encode(32 * 1e9, 1)

    assert((await utils.isDifferent(one, one)) === false)
    assert((await utils.isDifferent(two, two)) === false)
    assert((await utils.isDifferent(tri, tri)) === false)

    assert((await utils.isDifferent(one, two)) === true)
    assert((await utils.isDifferent(one, tri)) === false)
    assert((await utils.isDifferent(two, tri)) === true)

    // Make sure that the relations stay the same even with counters
    const noice = toBN(1)

    assert((await utils.isDifferent(one.add(noice), one)) === false)
    assert((await utils.isDifferent(two.add(noice), two)) === false)
    assert((await utils.isDifferent(tri.add(noice), tri)) === false)

    assert((await utils.isDifferent(one.add(noice), two)) === true)
    assert((await utils.isDifferent(one.add(noice), tri)) === false)
    assert((await utils.isDifferent(two.add(noice), tri)) === true)
  })
})
