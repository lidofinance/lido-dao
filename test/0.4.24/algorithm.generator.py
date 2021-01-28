#!/usr/bin/env python3
#
# Tests generator for Algorithm.frequent() code. Run it with:
# python algorithm.generator.py
# yarn test test/0.4.24/algorithm.test.generated.js
#
import collections
import random


NUM_TESTS = 100
MAX_NUM = 5
CASE = """
    r = await algorithm.frequentTest(%array%, %quorum%, { from: testUser })
    assert(r.exists === %exists%)
    assertBn(r.mode, bn(%result%))
"""


def frequent(nums, quorum):
    ctr = collections.Counter(nums).most_common()
    if ctr[0][1] >= quorum and (len(ctr) == 1 or ctr[1][1] != ctr[0][1]):
        return True, ctr[0][0]
    return False, 0


with open('algorithm.test.template.js') as inp:
    template = inp.read()

cases = ''
for arr_len in range(2, 10):
    positive = 0
    for i in range(NUM_TESTS):
        nums = []
        for j in range(arr_len):
            nums.append(random.randint(1, MAX_NUM))
        quorum = random.randint(1, arr_len)
        exists, result = frequent(nums, quorum)
        if exists:
            positive += 1
        cases += CASE \
            .replace('%array%', str(list(map(lambda val: str(val), nums)))) \
            .replace('%quorum%', str(quorum)) \
            .replace('%exists%', 'true' if exists else 'false') \
            .replace('%result%', str(result))
    print(f'For len {arr_len}, quorum found in {100 * positive / NUM_TESTS}%')

result = template.replace('/** test cases */', cases)
with open('algorithm.test.generated.js', 'w') as outp:
    outp.write(result)
