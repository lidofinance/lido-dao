const { assert } = require('../../helpers/assert')
const { processNamedTuple } = require('../../helpers/utils')

const ResizableArrayTest = artifacts.require('ResizableArrayTest')

contract('ResizableArray', () => {
  let test

  before(async () => {
    test = await ResizableArrayTest.new()
  })

  context('uninitialized representation', () => {
    it(`can be detected via isInvalid()`, async () => {
      await test.test_uninitialized_representation_can_be_detected_via_is_invalid()
    })

    it(`can be obtained by calling invalid()`, async () => {
      await test.test_uninitialized_representation_can_be_obtained_by_calling_invalid()
    })

    it(`pointer cannot be obtained from an uninitialized representation`, async () => {
      await assert.reverts(
        test.test_pointer_cannot_be_obtained_from_an_uninitialized_representation(),
        'Uninitialized()'
      )
    })

    it(`length cannot be obtained from an uninitialized representation`, async () => {
      await assert.reverts(
        test.test_length_cannot_be_obtained_from_an_uninitialized_representation(),
        'Uninitialized()'
      )
    })

    it(`push cannot be called on an uninitialized representation`, async () => {
      await assert.reverts(
        test.test_push_cannot_be_called_on_an_uninitialized_representation(),
        'Uninitialized()'
      )
    })

    it(`pop cannot be called on an uninitialized representation`, async () => {
      await assert.reverts(
        test.test_pop_cannot_be_called_on_an_uninitialized_representation(),
        'Uninitialized()'
      )
    })

    it(`trim cannot be called on an uninitialized representation`, async () => {
      await assert.reverts(
        test.test_trim_cannot_be_called_on_an_uninitialized_representation(),
        'Uninitialized()'
      )
    })

    it(`clear cannot be called on an uninitialized representation`, async () => {
      await assert.reverts(
        test.test_clear_cannot_be_called_on_an_uninitialized_representation(),
        'Uninitialized()'
      )
    })
  })

  context('preallocate', () => {
    it('returns array of zero length', async () => {
      await test.test_preallocate_returns_array_of_zero_length()
    })

    it('preallocates the required array size', async () => {
      await test.test_preallocate_preallocates_the_required_array_size()
    })

    it('sets config correctly', async () => {
      await test.test_preallocate_sets_config_correctly()
    })

    it('reverts when called with zero size', async () => {
      await assert.reverts(
        test.test_preallocate_reverts_when_called_with_zero_size(),
        'PrealloctedLengthCannotBeZero()'
      )
    })

    it('reverts when called with growth factor less than or equal 100 (trying 0)', async () => {
      await assert.reverts(
        test.test_preallocate_reverts_when_called_with_growth_factor_0(),
        'GrowthFactorShouldBeMoreThan100()'
      )
    })

    it('reverts when called with growth factor less than or equal 100 (trying 100)', async () => {
      await assert.reverts(
        test.test_preallocate_reverts_when_called_with_growth_factor_100(),
        'GrowthFactorShouldBeMoreThan100()'
      )
    })
  })

  context('pop', () => {
    it('reverts on empty array (case 1)', async () => {
      await assert.reverts(
        test.test_pop_reverts_on_empty_array_case_1(),
        'ArrayIsEmpty()'
      )
    })

    it(`doesn't revert on non-empty array`, async () => {
      await test.test_pop_doesnt_revert_on_non_empty_array()
    })

    it('reverts on empty array (case 2)', async () => {
      await assert.reverts(
        test.test_pop_reverts_on_empty_array_case_2(),
        'ArrayIsEmpty()'
      )
    })

    it('reverts on empty array (case 3)', async () => {
      await assert.reverts(
        test.test_pop_reverts_on_empty_array_case_3(),
        'ArrayIsEmpty()'
      )
    })
  })

  context('trim', () => {
    it('reverts on empty array (case 1)', async () => {
      await assert.reverts(
        test.test_trim_reverts_on_empty_array_case_1(),
        'CannotTrimMoreThanLength()'
      )
    })

    it('reverts on empty array (case 2)', async () => {
      await assert.reverts(
        test.test_trim_reverts_on_empty_array_case_1(),
        'CannotTrimMoreThanLength()'
      )
    })

    it('reverts on trimming more than length', async () => {
      await assert.reverts(
        test.test_trim_reverts_on_trimming_more_than_length(),
        'CannotTrimMoreThanLength()'
      )
    })

    it(`doesn't modify non-empty array when trimming by zero`, async () => {
      await test.test_trim_by_zero_doesnt_modity_non_empty_array()
    })

    it(`doesn't modify empty array when trimming by zero (case 1)`, async () => {
      await test.test_trim_by_zero_doesnt_modity_empty_array_case_1()
    })

    it(`doesn't modify empty array when trimming by zero (case 2)`, async () => {
      await test.test_trim_by_zero_doesnt_modity_empty_array_case_2()
    })
  })

  context('clear', () => {
    it(`doesn't modity empty array (case 1)`, async () => {
      await test.test_clear_doesnt_modity_empty_array_case_1()
    })

    it(`doesn't modity empty array (case 2)`, async () => {
      await test.test_clear_doesnt_modity_empty_array_case_2()
    })

    it(`can be called multiple times`, async () => {
      await test.test_clear_can_be_called_multiple_times()
    })
  })

  context('growth factor and max growth', () => {
    it('are respected (case 1)', async () => {
      await test.test_growth_factor_and_max_growth_are_respected_case_1()
    })

    it('are respected (case 2)', async () => {
      await test.test_growth_factor_and_max_growth_are_respected_case_2()
    })

    it('are respected (case 3)', async () => {
      await test.test_growth_factor_and_max_growth_are_respected_case_3()
    })
  })

  context('push, pop, and trim', () => {
    it('work as intended within prealloc range', async () => {
      await test.test_push_pop_and_trim_work_within_prealloc_range()
    })

    it('work as intended outside of prealloc range (case 1)', async () => {
      await test.test_push_pop_and_trim_work_outside_of_prealloc_range_case_1()
    })

    it('work as intended outside of prealloc range wit no mem allocated after the array', async () => {
      await test.test_push_pop_and_trim_work_outside_of_prealloc_range_with_no_mem_allocated_after()
      // console.log(tx.logs.map(({event, args}) => ({event, args: processNamedTuple(args)})))
    })

    it('work as intended outside of prealloc range with mem allocated after the array', async () => {
      await test.test_push_pop_and_trim_work_outside_of_prealloc_range_with_mem_allocated_after()
    })
  })
})
