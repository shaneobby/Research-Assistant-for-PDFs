// Dependency-free check for the citation parser:  node --experimental-strip-types scripts/check-citations.mts
import assert from 'node:assert/strict'
import { linkCitations as l } from '../src/lib/markdown.ts'

const chip = (n: number) => `[p. ${n}](#page-${n})`
assert.equal(l('A [p. 4] b'), `A ${chip(4)} b`)
assert.equal(l('(p. 6)'), chip(6))
assert.equal(l('(Table 1, p. 6)'), `(Table 1, ${chip(6)})`)
assert.equal(l('(pp. 6–7)'), `${chip(6)} ${chip(7)}`)
assert.equal(l('[p. 6, 8]'), `${chip(6)} ${chip(8)}`)
assert.equal(l('[pp. 3-5]'), `${chip(3)} ${chip(4)} ${chip(5)}`)
assert.equal(l('(page 2 and 9)'), `${chip(2)} ${chip(9)}`)
// out-of-range pages never become chips
assert.equal(l('[p. 0]'), '[p. 0]')
assert.equal(l('[p. 9999]', 12), '[p. 9999]')
assert.equal(l('[p. 12]', 12), chip(12))
assert.equal(l('[p. 13]', 12), '[p. 13]')
assert.equal(l('[pp. 11-14]', 12), `${chip(11)} ${chip(12)}`)
assert.equal(l('(Table 1, p. 99)', 12), '(Table 1, p. 99)')
// brackets nested in parentheses
assert.equal(l('(see [p. 4])'), `(see ${chip(4)})`)
assert.equal(l('(see [p. 4]; [p. 6])'), `(see ${chip(4)}; ${chip(6)})`)
assert.equal(l('(see [p. 99])', 12), '(see [p. 99])')
for (const untouched of ['step 6', '(n = 6)', '[6]', 'see `(p. 3)`', 'p. 6 bare', chip(3)]) assert.equal(l(untouched), untouched)
console.log('citation parser: ok')
