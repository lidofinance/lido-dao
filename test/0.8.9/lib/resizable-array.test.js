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

    it('reverts when called with zero size', async () => {
      await assert.reverts(
        test.test_preallocate_reverts_when_called_with_zero_size(),
        'MaxLengthCannotBeZero()'
      )
    })
  })

  context('push', () => {
    it(`adds an element (case 1)`, async () => {
      await test.test_push_adds_an_element_case_1()
    })

    it(`adds an element (case 2)`, async () => {
      await test.test_push_adds_an_element_case_2()
    })

    it(`adds an element (case 3)`, async () => {
      await test.test_push_adds_an_element_case_3()
    })

    it('reverts when pushing past the pre-allocated length (case 1)', async () => {
      await assert.reverts(
        test.test_push_past_preallocated_length_reverts_case_1(),
        'MaxLengthReached()'
      )
    })

    it(`allows to fill all preallocated memory`, async () => {
      await test.test_push_allows_to_fill_all_preallocated_memory()
    })

    it('reverts when pushing past the pre-allocated length (case 2)', async () => {
      await assert.reverts(
        test.test_push_past_preallocated_length_reverts_case_2(),
        'MaxLengthReached()'
      )
    })

    it('reverts when pushing past the pre-allocated length (case 3)', async () => {
      await assert.reverts(
        test.test_push_past_preallocated_length_reverts_case_3(),
        'MaxLengthReached()'
      )
    })

    it('reverts when pushing past the pre-allocated length (case 4)', async () => {
      await assert.reverts(
        test.test_push_past_preallocated_length_reverts_case_4(),
        'MaxLengthReached()'
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
      await test.test_trim_by_zero_doesnt_modify_non_empty_array()
    })

    it(`doesn't modify empty array when trimming by zero (case 1)`, async () => {
      await test.test_trim_by_zero_doesnt_modify_empty_array_case_1()
    })

    it(`doesn't modify empty array when trimming by zero (case 2)`, async () => {
      await test.test_trim_by_zero_doesnt_modify_empty_array_case_2()
    })
  })

  context('clear', () => {
    it(`doesn't modify empty array (case 1)`, async () => {
      await test.test_clear_doesnt_modify_empty_array_case_1()
    })

    it(`doesn't modify empty array (case 2)`, async () => {
      await test.test_clear_doesnt_modify_empty_array_case_2()
    })

    it(`can be called multiple times`, async () => {
      await test.test_clear_can_be_called_multiple_times()
    })
  })

  context('Array manipulation: push, pop, clear, trim', () => {
    it('scenario 1', async () => {
      await test.test_array_manipulation_scenario_1()
    })

    it('scenario 2', async () => {
      await test.test_array_manipulation_scenario_2()
    })

    it('preserves memory safety', async () => {
      await test.test_array_manipulation_preserves_memory_safety()
    })
  })
})
