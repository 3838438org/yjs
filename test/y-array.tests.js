import { wait, initArrays, compareUsers, Y, flushAll, garbageCollectUsers, applyRandomTests } from '../tests-lib/helper.js'
import { test, proxyConsole } from 'cutest'

proxyConsole()

test('basic spec', async function array0 (t) {
  let { users, array0 } = await initArrays(t, { users: 2 })

  array0.delete(0, 0)
  t.assert(true, 'Does not throw when deleting zero elements with position 0')

  let throwInvalidPosition = false
  try {
    array0.delete(1, 0)
  } catch (e) {
    throwInvalidPosition = true
  }
  t.assert(throwInvalidPosition, 'Throws when deleting zero elements with an invalid position')

  array0.insert(0, ['A'])
  array0.delete(1, 0)
  t.assert(true, 'Does not throw when deleting zero elements with valid position 1')

  await compareUsers(t, users)
})

test('insert three elements, try re-get property', async function array1 (t) {
  var { users, array0, array1 } = await initArrays(t, { users: 2 })
  array0.insert(0, [1, 2, 3])
  t.compare(array0.toArray(), [1, 2, 3], '.toArray() works')
  await flushAll(t, users)
  t.compare(array1.toArray(), [1, 2, 3], '.toArray() works after sync')
  await compareUsers(t, users)
})

test('concurrent insert (handle three conflicts)', async function array2 (t) {
  var { users, array0, array1, array2 } = await initArrays(t, { users: 3 })
  array0.insert(0, [0])
  array1.insert(0, [1])
  array2.insert(0, [2])

  await compareUsers(t, users)
})

test('concurrent insert&delete (handle three conflicts)', async function array3 (t) {
  var { users, array0, array1, array2 } = await initArrays(t, { users: 3 })
  array0.insert(0, ['x', 'y', 'z'])
  await flushAll(t, users)
  array0.insert(1, [0])
  array1.delete(0)
  array1.delete(1, 1)
  array2.insert(1, [2])

  await compareUsers(t, users)
})

test('insertions work in late sync', async function array4 (t) {
  var { users, array0, array1, array2 } = await initArrays(t, { users: 3 })
  array0.insert(0, ['x', 'y'])
  await flushAll(t, users)
  users[1].disconnect()
  users[2].disconnect()
  array0.insert(1, ['user0'])
  array1.insert(1, ['user1'])
  array2.insert(1, ['user2'])
  await users[1].reconnect()
  await users[2].reconnect()
  await compareUsers(t, users)
})

test('disconnect really prevents sending messages', async function array5 (t) {
  var { users, array0, array1 } = await initArrays(t, { users: 3 })
  array0.insert(0, ['x', 'y'])
  await flushAll(t, users)
  users[1].disconnect()
  users[2].disconnect()
  array0.insert(1, ['user0'])
  array1.insert(1, ['user1'])
  await wait(1000)
  t.compare(array0.toArray(), ['x', 'user0', 'y'])
  t.compare(array1.toArray(), ['x', 'user1', 'y'])
  await users[1].reconnect()
  await users[2].reconnect()
  await compareUsers(t, users)
})

test('deletions in late sync', async function array6 (t) {
  var { users, array0, array1 } = await initArrays(t, { users: 2 })
  array0.insert(0, ['x', 'y'])
  await flushAll(t, users)
  await users[1].disconnect()
  array1.delete(1, 1)
  array0.delete(0, 2)
  await wait()
  await users[1].reconnect()
  await compareUsers(t, users)
})

test('insert, then marge delete on sync', async function array7 (t) {
  var { users, array0, array1 } = await initArrays(t, { users: 2 })
  array0.insert(0, ['x', 'y', 'z'])
  await flushAll(t, users)
  await wait()
  await users[0].disconnect()
  array1.delete(0, 3)
  await wait()
  await users[0].reconnect()
  await compareUsers(t, users)
})

function compareEvent (t, is, should) {
  for (var key in should) {
    t.assert(
      should[key] === is[key] ||
      JSON.stringify(should[key]) === JSON.stringify(is[key])
    , 'event works as expected'
    )
  }
}

test('insert & delete events', async function array8 (t) {
  var { array0, users } = await initArrays(t, { users: 2 })
  var event
  array0.observe(function (e) {
    event = e
  })
  array0.insert(0, [0, 1, 2])
  compareEvent(t, event, {
    type: 'insert',
    index: 0,
    values: [0, 1, 2],
    length: 3
  })
  array0.delete(0)
  compareEvent(t, event, {
    type: 'delete',
    index: 0,
    length: 1,
    values: [0]
  })
  array0.delete(0, 2)
  compareEvent(t, event, {
    type: 'delete',
    index: 0,
    length: 2,
    values: [1, 2]
  })
  await compareUsers(t, users)
})

test('insert & delete events for types', async function array9 (t) {
  var { array0, users } = await initArrays(t, { users: 2 })
  var event
  array0.observe(function (e) {
    event = e
  })
  array0.insert(0, [Y.Array])
  compareEvent(t, event, {
    type: 'insert',
    object: array0,
    index: 0,
    length: 1
  })
  var type = array0.get(0)
  t.assert(type._model != null, 'Model of type is defined')
  array0.delete(0)
  compareEvent(t, event, {
    type: 'delete',
    object: array0,
    index: 0,
    length: 1
  })
  await compareUsers(t, users)
})

test('insert & delete events for types (2)', async function array10 (t) {
  var { array0, users } = await initArrays(t, { users: 2 })
  var events = []
  array0.observe(function (e) {
    events.push(e)
  })
  array0.insert(0, ['hi', Y.Map])
  compareEvent(t, events[0], {
    type: 'insert',
    object: array0,
    index: 0,
    length: 1,
    values: ['hi']
  })
  compareEvent(t, events[1], {
    type: 'insert',
    object: array0,
    index: 1,
    length: 1
  })
  array0.delete(1)
  compareEvent(t, events[2], {
    type: 'delete',
    object: array0,
    index: 1,
    length: 1
  })
  await compareUsers(t, users)
})

test('garbage collector', async function gc1 (t) {
  var { users, array0 } = await initArrays(t, { users: 3 })

  array0.insert(0, ['x', 'y', 'z'])
  await flushAll(t, users)
  users[0].disconnect()
  array0.delete(0, 3)
  await wait()
  await users[0].reconnect()
  await flushAll(t, users)
  await garbageCollectUsers(t, users)
  await compareUsers(t, users)
})

test('event has correct value when setting a primitive on a YArray (same user)', async function array11 (t) {
  var { array0, users } = await initArrays(t, { users: 3 })

  var event
  array0.observe(function (e) {
    event = e
  })
  array0.insert(0, ['stuff'])
  t.assert(event.values[0] === event.object.get(0), 'compare value with get method')
  t.assert(event.values[0] === 'stuff', 'check that value is actually present')
  t.assert(event.values[0] === array0.toArray()[0], '.toArray works as expected')
  await compareUsers(t, users)
})

test('event has correct value when setting a primitive on a YArray (received from another user)', async function array12 (t) {
  var { users, array0, array1 } = await initArrays(t, { users: 3 })

  var event
  array0.observe(function (e) {
    event = e
  })
  array1.insert(0, ['stuff'])
  await flushAll(t, users)
  t.assert(event.values[0] === event.object.get(0), 'compare value with get method')
  t.assert(event.values[0] === 'stuff', 'check that value is actually present')
  t.assert(event.values[0] === array0.toArray()[0], '.toArray works as expected')
  await compareUsers(t, users)
})

test('event has correct value when setting a type on a YArray (same user)', async function array13 (t) {
  var { array0, users } = await initArrays(t, { users: 3 })

  var event
  array0.observe(function (e) {
    event = e
  })
  array0.insert(0, [Y.Array])
  t.assert(event.values[0] === event.object.get(0), 'compare value with get method')
  t.assert(event.values[0] != null, 'event.value exists')
  t.assert(event.values[0] === array0.toArray()[0], '.toArray works as expected')
  await compareUsers(t, users)
})
test('event has correct value when setting a type on a YArray (ops received from another user)', async function array14 (t) {
  var { users, array0, array1 } = await initArrays(t, { users: 3 })

  var event
  array0.observe(function (e) {
    event = e
  })
  array1.insert(0, [Y.Array])
  await flushAll(t, users)
  t.assert(event.values[0] === event.object.get(0), 'compare value with get method')
  t.assert(event.values[0] != null, 'event.value exists')
  t.assert(event.values[0] === array0.toArray()[0], '.toArray works as expected')
  await compareUsers(t, users)
})

var _uniqueNumber = 0
function getUniqueNumber () {
  return _uniqueNumber++
}

var arrayTransactions = [
  function insert (t, user, chance) {
    var uniqueNumber = getUniqueNumber()
    var content = []
    var len = chance.integer({ min: 1, max: 4 })
    for (var i = 0; i < len; i++) {
      content.push(uniqueNumber)
    }
    var pos = chance.integer({ min: 0, max: user.share.array.length })
    user.share.array.insert(pos, content)
  },
  function insertTypeArray (t, user, chance) {
    var pos = chance.integer({ min: 0, max: user.share.array.length })
    user.share.array.insert(pos, [Y.Array])
    var array2 = user.share.array.get(pos)
    array2.insert(0, [1, 2, 3, 4])
  },
  function insertTypeMap (t, user, chance) {
    var pos = chance.integer({ min: 0, max: user.share.array.length })
    user.share.array.insert(pos, [Y.Map])
    var map = user.share.array.get(pos)
    map.set('someprop', 42)
    map.set('someprop', 43)
    map.set('someprop', 44)
  },
  function _delete (t, user, chance) {
    var length = user.share.array._content.length
    if (length > 0) {
      var pos = chance.integer({ min: 0, max: length - 1 })
      var delLength = chance.integer({ min: 1, max: Math.min(2, length - pos) })
      if (user.share.array._content[pos].type != null) {
        if (chance.bool()) {
          var type = user.share.array.get(pos)
          if (type instanceof Y.Array.typeDefinition.class) {
            if (type._content.length > 0) {
              pos = chance.integer({ min: 0, max: type._content.length - 1 })
              delLength = chance.integer({ min: 0, max: Math.min(2, type._content.length - pos) })
              type.delete(pos, delLength)
            }
          } else {
            type.delete('someprop')
          }
        } else {
          user.share.array.delete(pos, delLength)
        }
      } else {
        user.share.array.delete(pos, delLength)
      }
    }
  }
]

test('y-array: Random tests (42)', async function randomArray42 (t) {
  await applyRandomTests(t, arrayTransactions, 42)
})

test('y-array: Random tests (43)', async function randomArray43 (t) {
  await applyRandomTests(t, arrayTransactions, 43)
})

test('y-array: Random tests (44)', async function randomArray44 (t) {
  await applyRandomTests(t, arrayTransactions, 44)
})

test('y-array: Random tests (45)', async function randomArray45 (t) {
  await applyRandomTests(t, arrayTransactions, 45)
})

test('y-array: Random tests (46)', async function randomArray46 (t) {
  await applyRandomTests(t, arrayTransactions, 46)
})

test('y-array: Random tests (47)', async function randomArray47 (t) {
  await applyRandomTests(t, arrayTransactions, 47)
})

/*
test('y-array: Random tests (200)', async function randomArray200 (t) {
  await applyRandomTests(t, arrayTransactions, 200)
})

test('y-array: Random tests (300)', async function randomArray300 (t) {
  await applyRandomTests(t, arrayTransactions, 300)
})

test('y-array: Random tests (400)', async function randomArray400 (t) {
  await applyRandomTests(t, arrayTransactions, 400)
})

test('y-array: Random tests (500)', async function randomArray500 (t) {
  await applyRandomTests(t, arrayTransactions, 500)
})
*/
