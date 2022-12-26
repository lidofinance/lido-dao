const hre = require('hardhat')
const { assert } = require('chai')
const { assertBn } = require('@aragon/contract-helpers-test/src/asserts')

const MinFirstAllocationStrategyTest = hre.artifacts.require('MinFirstAllocationStrategyTest')

contract('MinFirstAllocationStrategy', (accounts) => {
  let minFirstAllocationStrategy
  const [deployer] = accounts
  let evmSnapshotId

  before(async () => {
    minFirstAllocationStrategy = await MinFirstAllocationStrategyTest.new({ from: deployer })
    evmSnapshotId = await hre.ethers.provider.send('evm_snapshot', [])
  })

  afterEach(async () => {
    await hre.ethers.provider.send('evm_revert', [evmSnapshotId])
    evmSnapshotId = await hre.ethers.provider.send('evm_snapshot', [])
  })

  describe('allocateToBestCandidate()', () => {
    describe('allocations.length == 0', () => {
      for (const maxAllocationSize of [0, 2, 4, 8, 16, 32, 64]) {
        it(`allocations=[], capacities=[] maxAllocationSize == ${maxAllocationSize}`, async () => {
          const { allocated, newAllocations } = await minFirstAllocationStrategy.allocateToBestCandidate([], [], maxAllocationSize)
          assertBn(allocated, 0)
          assert.equal(newAllocations.length, 0)
        })
      }
    })

    describe('allocations.length == 1', () => {
      const capacities = [0, 15, 24, 50]
      const allocations = [0, 15, 25, 50]
      const maxAllocationSizes = [0, 15, 25, 50]

      it(`allocations[0]=[${allocations}] capacity[0]=[${capacities}] maxAllocationSize=[${maxAllocationSizes}]`, async () => {
        for (const capacity of capacities) {
          for (const allocation of allocations) {
            for (const maxAllocationSize of maxAllocationSizes) {
              const { allocated, newAllocations } = await minFirstAllocationStrategy.allocateToBestCandidate(
                [allocation],
                [capacity],
                maxAllocationSize
              )
              const expectedAllocated = Math.min(Math.max(0, capacity - allocation), maxAllocationSize)
              assertBn(allocated, expectedAllocated)
              assert.equal(newAllocations.length, 1)
              assertBn(newAllocations[0], allocation + expectedAllocated)
            }
          }
        }
      })
    })

    for (let allocationsLength = 2; allocationsLength <= 16; ++allocationsLength) {
      const samplesCount = 128
      const allocationRange = [0, 8192]
      const capacityRange = [0, 8192]
      const maxAllocationSizeRange = [0, 1024]
      describe(`allocations.length == ${allocationsLength} samples count: ${samplesCount}`, async () => {
        const title = [
          `allocation: [${allocationRange[0]}..${allocationRange[1]}]`,
          `capacity: [${capacityRange[0]}..${capacityRange[1]}]`,
          `maxAllocationSize: [${maxAllocationSizeRange[0]}..${maxAllocationSizeRange[1]}]`
        ].join(' | ')
        it(title, async () => {
          for (let i = 0; i < samplesCount; ++i) {
            const allocations = getAllocationSample(allocationsLength, allocationRange)
            const capacities = getCapacitiesSample(allocationsLength, capacityRange)
            const maxAllocationSize = getMaxAllocationSizeSample(maxAllocationSizeRange)

            const { allocated, newAllocations } = await minFirstAllocationStrategy.allocateToBestCandidate(
              allocations,
              capacities,
              maxAllocationSize
            )
            const [expectedAllocated, expectedNewAllocations] = getExpectedAllocateToBestCandidate(
              allocations,
              capacities,
              maxAllocationSize
            )

            const assertMessage = getAssertMessage(allocations, capacities, maxAllocationSize, expectedNewAllocations, newAllocations)
            assert.equal(expectedNewAllocations.length, newAllocations.length, assertMessage)
            assertBn(allocated, expectedAllocated, assertMessage)
            for (let i = 0; i < newAllocations.length; ++i) {
              assertBn(newAllocations[i], expectedNewAllocations[i], assertMessage)
            }
          }
        })
      })
    }

    describe(`edge cases & illustrative examples`, () => {
      const edgeCases = [
        {
          input: [[0, 0, 0, 0], [0, 0, 0, 0], 100],
          output: [0, [0, 0, 0, 0]]
        },
        {
          input: [[100, 100, 100], [200, 300, 600], 600],
          output: [100, [200, 100, 100]]
        },
        {
          input: [[0, 0], [10, 20], 100],
          output: [10, [10, 0]]
        },
        {
          input: [[9998, 70, 0], [10099, 101, 100], 101],
          output: [70, [9998, 70, 70]]
        }
      ]
      for (const { input, output } of edgeCases) {
        const [allocations, capacities, maxAllocationSize] = input
        const [expectedAllocated, expectedNewAllocations] = output
        const title = `allocations: [${allocations}] capacities: [${capacities}] maxAllocationSize: ${maxAllocationSize}`
        it(title, async () => {
          const { allocated, newAllocations } = await minFirstAllocationStrategy.allocateToBestCandidate(
            allocations,
            capacities,
            maxAllocationSize
          )

          const assertMessage = getAssertMessage(allocations, capacities, maxAllocationSize, expectedNewAllocations, newAllocations)
          assert.equal(expectedNewAllocations.length, newAllocations.length, assertMessage)
          assertBn(allocated, expectedAllocated, assertMessage)
          for (let i = 0; i < newAllocations.length; ++i) {
            assertBn(newAllocations[i], expectedNewAllocations[i], assertMessage)
          }
        })
      }
    })
  })

  describe('allocate()', () => {
    describe('allocations.length == 0', () => {
      for (const maxAllocationSize of [0, 4, 8, 15, 16, 23, 42]) {
        it(`allocations=[], capacities=[] maxAllocationSize == ${maxAllocationSize}`, async () => {
          const { allocated, newAllocations } = await minFirstAllocationStrategy.allocate([], [], maxAllocationSize)
          assertBn(allocated, 0)
          assert.equal(newAllocations.length, 0)
        })
      }
    })

    describe('allocations.length == 1', () => {
      const capacities = [0, 13, 17, 19]
      const allocations = [0, 2, 19, 23]
      const maxAllocationSizes = [0, 3, 19, 23]

      it(`allocations[0]=[${allocations}] capacity[0]=[${capacities}] maxAllocationSize=[${maxAllocationSizes}]`, async () => {
        for (const capacity of capacities) {
          for (const allocation of allocations) {
            for (const maxAllocationSize of maxAllocationSizes) {
              const { allocated, newAllocations } = await minFirstAllocationStrategy.allocate([allocation], [capacity], maxAllocationSize)

              assertAllocationAssumptions([allocation], [capacity], maxAllocationSize, allocated, newAllocations)

              const expectedAllocated = Math.min(Math.max(0, capacity - allocation), maxAllocationSize)
              assertBn(allocated, expectedAllocated)
              assert.equal(newAllocations.length, 1)
              assertBn(newAllocations[0], allocation + expectedAllocated)
            }
          }
        }
      })
    })

    for (let allocationsLength = 2; allocationsLength <= 16; ++allocationsLength) {
      const samplesCount = 128
      const allocationRange = [0, 8192]
      const capacityRange = [0, 8192]
      const maxAllocationSizeRange = [0, 1024]
      describe(`allocations.length == ${allocationsLength} samples count: ${samplesCount}`, async () => {
        const title = [
          `allocation: [${allocationRange[0]}..${allocationRange[1]}]`,
          `capacity: [${capacityRange[0]}..${capacityRange[1]}]`,
          `maxAllocationSize: [${maxAllocationSizeRange[0]}..${maxAllocationSizeRange[1]}]`
        ].join(' ')
        it(title, async () => {
          for (let i = 0; i < samplesCount; ++i) {
            const allocations = getAllocationSample(allocationsLength, allocationRange)
            const capacities = getCapacitiesSample(allocationsLength, capacityRange)
            const maxAllocationSize = getMaxAllocationSizeSample(maxAllocationSizeRange)

            const { allocated, newAllocations } = await minFirstAllocationStrategy.allocate(allocations, capacities, maxAllocationSize)

            assertAllocationAssumptions(allocations, capacities, maxAllocationSize, allocated, newAllocations)

            const [expectedAllocated, expectedNewAllocations] = getExpectedAllocate(allocations, capacities, maxAllocationSize)

            const assertMessage = getAssertMessage(allocations, capacities, maxAllocationSize, expectedNewAllocations, newAllocations)
            assert.equal(expectedNewAllocations.length, newAllocations.length, assertMessage)
            assertBn(allocated, expectedAllocated, assertMessage)
            for (let i = 0; i < newAllocations.length; ++i) {
              assertBn(newAllocations[i], expectedNewAllocations[i], assertMessage)
            }
          }
        })
      })
    }

    describe(`edge cases & illustrative examples`, () => {
      const edgeCases = [
        {
          input: [[0, 0, 0, 0], [0, 0, 0, 0], 100],
          output: [0, [0, 0, 0, 0]]
        },
        {
          input: [[100, 100, 100], [200, 300, 600], 600],
          output: [600, [200, 300, 400]]
        },
        {
          input: [[0, 0], [10, 20], 100],
          output: [30, [10, 20]]
        },
        {
          input: [[9998, 70, 0], [10099, 101, 100], 101],
          output: [101, [9998, 86, 85]]
        },
        {
          input: [[3379, 495, 5572], [7185, 1061, 3265], 1007],
          output: [1007, [3820, 1061, 5572]]
        }
      ]
      for (const { input, output } of edgeCases) {
        const [allocations, capacities, maxAllocationSize] = input
        const [expectedAllocated, expectedNewAllocations] = output
        const title = `allocations: [${allocations}] capacities: [${capacities}] maxAllocationSize: ${maxAllocationSize}`
        it(title, async () => {
          const { allocated, newAllocations } = await minFirstAllocationStrategy.allocate(allocations, capacities, maxAllocationSize)

          assertAllocationAssumptions(allocations, capacities, maxAllocationSize, allocated, newAllocations)

          const assertMessage = getAssertMessage(allocations, capacities, maxAllocationSize, expectedNewAllocations, newAllocations)
          assert.equal(expectedNewAllocations.length, newAllocations.length, assertMessage)
          assertBn(allocated, expectedAllocated, assertMessage)
          for (let i = 0; i < newAllocations.length; ++i) {
            assertBn(newAllocations[i], expectedNewAllocations[i], assertMessage)
          }
        })
      }
    })
  })
})

function getAssertMessage(allocations, capacities, maxAllocationSize, expectedNewAllocations, actualAllocations) {
  return [
    `Allocations mismatch: [${allocations}] [${capacities}] ${maxAllocationSize}.`,
    `Expected: [${expectedNewAllocations}]`,
    `Actual [${actualAllocations}]`
  ].join(' ')
}

function getExpectedAllocate(allocations, capacities, maxAllocationSize) {
  let allocated = 0
  while (allocated < maxAllocationSize) {
    const [allocatedToBestCandidate, newAllocations] = getExpectedAllocateToBestCandidate(
      allocations,
      capacities,
      maxAllocationSize - allocated
    )
    allocations = newAllocations
    allocated += allocatedToBestCandidate
    if (allocatedToBestCandidate === 0) {
      break
    }
  }
  return [allocated, allocations]
}

function assertAllocationAssumptions(allocations, capacities, maxAllocationSize, allocated, newAllocations) {
  const assertMessage = getAssertMessage(allocations, capacities, maxAllocationSize, [], newAllocations)
  // assumption 1: lengths of prev allocations, capacities and new allocations are equal
  assert(allocations.length === capacities.length, assertMessage)
  assert(allocations.length === newAllocations.length, assertMessage)

  // assumption 2: allocated doesn't exceeds maxAllocationSize
  assert(allocated.toNumber() <= maxAllocationSize, assertMessage)

  // assumption 3: each item in new allocation doesn't exceeds capacity if prev allocation wasn't
  for (let i = 0; i < newAllocations.length; ++i) {
    if (allocations[i] < capacities[i]) {
      assert(newAllocations[i].toNumber() <= capacities[i], assertMessage)
    }
  }

  // assumption 4: if new allocation item exceeds capacity it must be equal to value in prev allocation
  for (let i = 0; i < newAllocations.length; ++i) {
    if (allocations[i] >= capacities[i]) {
      assertBn(newAllocations[i], allocations[i], assertMessage)
    }
  }

  // assumption 4: the sum of new allocation minus the sum of prev allocation equal to distributed
  const newAllocationsSum = newAllocations.map((a) => a.toNumber()).reduce((sum, a) => sum + a, 0)
  const prevAllocationsSum = allocations.reduce((sum, a) => sum + a, 0)
  assert.equal(prevAllocationsSum, newAllocationsSum - allocated, assertMessage)

  // assumption 5: allocated might be less then maxAllocationSize only when
  // every new allocation item greater or equal than capacity item
  if (allocated < maxAllocationSize) {
    assert.isTrue(
      newAllocations.every((newAllocation, i) => newAllocation.toNumber() >= capacities[i]),
      assertMessage
    )
  }
}

function getExpectedAllocateToBestCandidate(allocations, capacities, maxAllocationSize) {
  const [allocation, capacity, index] = allocations
    .map((a, i) => [a, capacities[i], i])
    .filter(([a, c]) => a < c)
    .reduce(
      ([minA, minC, minI], [a, c, i]) => (a < minA ? [a, c, i] : [minA, minC, minI]),
      [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]
    )

  if (allocation === Number.MAX_SAFE_INTEGER || maxAllocationSize === 0) {
    return [0, allocations]
  }

  const candidatesCount = allocations.filter((a, i) => a === allocation && a < capacities[i]).length

  let allocationBound = Number.MAX_SAFE_INTEGER
  for (let i = 0; i < allocations.length; ++i) {
    if (allocations[i] >= capacities[i]) {
      continue
    }
    if (allocations[i] > allocation && allocations[i] < allocationBound) {
      allocationBound = allocations[i]
    }
  }

  const allocationPerCandidate = Math.max(1, Math.floor(maxAllocationSize / candidatesCount))
  const allocated = Math.min(allocationPerCandidate, capacity - allocation, allocationBound - allocation)
  const newAllocations = [...allocations]
  newAllocations[index] += allocated
  return [allocated, newAllocations]
}

function getMaxAllocationSizeSample(itemsValueRange) {
  return getRandomValueInRange(...itemsValueRange)
}

function getCapacitiesSample(length, itemsValueRange) {
  return getRandomArray(length, ...itemsValueRange)
}

function getAllocationSample(length, itemsValueRange) {
  return getRandomArray(length, ...itemsValueRange)
}

function getRandomArray(length, min, max) {
  const allocations = Array(length).fill(0)
  return allocations.map(() => getRandomValueInRange(min, max))
}

function getRandomValueInRange(min, max) {
  min = Math.ceil(min)
  max = Math.floor(max)
  return Math.floor(Math.random() * (max - min + 1)) + min
}