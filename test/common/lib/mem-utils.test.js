const { assert } = require('../../helpers/assert')
const { printEvents } = require('../../helpers/utils')

const MemUtilsTest = artifacts.require('MemUtilsTest')


contract('MemUtils', () => {
  let test

  before(async () => {
    test = await MemUtilsTest.new()
  })

  context('unsafeAllocateBytes', () => {

    it('allocates empty byte array', async () => {
      await test.unsafeAlloc_allocates_empty_byte_array()
    })

    it('allocates memory and advances free mem pointer', async () => {
      await test.unsafeAlloc_allocates_memory_and_advances_free_mem_pointer()
    })

    it('pads free mem pointer to 32 bytes', async () => {
      await test.unsafeAlloc_pads_free_mem_pointer_to_32_bytes()
    })

    it('handles misaligned free mem pointer and pads it to 32 bytes', async () => {
      await test.unsafeAlloc_handles_misaligned_free_mem_pointer_and_pads_to_32_bytes()
    })
  })

  context('memcpy', () => {

    it('copies mem chunks that are multiples of 32 bytes', async () => {
      await test.memcpy_copies_mem_chunks_that_are_multiples_of_32_bytes()
    })

    it('copies mem chunks that are multiples of 32 bytes from a non-32 byte offset', async () => {
      await test.memcpy_copies_mem_chunks_that_are_multiples_of_32_bytes_from_a_non_32b_offset()
    })

    it('copies mem chunks that are multiples of 32 bytes to a non-32 byte offset', async () => {
      await test.memcpy_copies_mem_chunks_that_are_multiples_of_32b_to_a_non_32b_offset()
    })

    it('copies mem chunks that are multiples of 32 bytes from and to a non-32 byte offset', async () => {
      await test.memcpy_copies_mem_chunks_that_are_multiples_of_32_bytes_from_and_to_a_non_32b_offset()
    })

    it('copies mem chunks that are not multiples of 32 bytes', async () => {
      await test.memcpy_copies_mem_chunks_that_are_not_multiples_of_32_bytes()
    })

    it('copies mem chunks that are not multiples of 32 bytes from a non-32 byte offset', async () => {
      await test.memcpy_copies_mem_chunks_that_are_not_multiples_of_32_bytes_from_a_non_32b_offset()
    })

    it('copies mem chunks that are not multiples of 32 bytes to a non-32 byte offset', async () => {
      await test.memcpy_copies_mem_chunks_that_are_not_multiples_of_32_bytes_to_a_non_32b_offset()
    })

    it('copies mem chunks that are not multiples of 32 bytes from and to a non-32 byte offset', async () => {
      await test.memcpy_copies_mem_chunks_that_are_not_multiples_of_32_bytes_from_and_to_a_non_32b_offset()
    })

    it('copies mem chunks shorter than 32 bytes', async () => {
      await test.memcpy_copies_mem_chunks_shorter_than_32_bytes()
    })

    it('copies mem chunks shorter than 32 bytes from a non-32 byte offset', async () => {
      await test.memcpy_copies_mem_chunks_shorter_than_32_bytes_from_a_non_32b_offset()
    })

    it('copies mem chunks shorter than 32 bytes to a non-32 byte offset', async () => {
      await test.memcpy_copies_mem_chunks_shorter_than_32_bytes_to_a_non_32b_offset()
    })

    it('copies mem chunks shorter than 32 bytes from and to a non-32 byte offset', async () => {
      await test.memcpy_copies_mem_chunks_shorter_than_32_bytes_from_and_to_a_non_32b_offset()
    })

    it('zero length is handled correctly', async () => {
      await test.memcpy_zero_length_is_handled_correctly()
    })
  })

  context('keccakUint256Array', () => {

    it('calculates a keccak256 over a uint256 array', async () => {
      await test.keccakUint256Array_calcs_keccak_over_a_uint_array()
    })

    it('calculates a keccak256 over an empty uint256 array', async () => {
      await test.keccakUint256Array_calcs_keccak_over_an_empty_array()
    })
  })

  context('trimUint256Array', () => {

    it('decreases length of a uint256 array', async () => {
      await test.trimUint256Array_decreases_length_of_a_uint_array()
    })

    it('allows trimming to a zero length', async () => {
      await test.trimUint256Array_allows_trimming_to_zero_length()
    })

    it('reverts on trying to trim by more than the array length', async () => {
      await assert.reverts(
        test.trimUint256Array_reverts_on_trying_to_trim_by_more_than_length()
      )
    })
  })
})
