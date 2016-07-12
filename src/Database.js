/* @flow */
'use strict'

export default AbstractDatabase
import struct from './Struct.js'
import utils from './Utils.js'

/*
  Partial definition of an OperationStore.
  TODO: name it Database, operation store only holds operations.

  A database definition must alse define the following methods:
  * logTable() (optional)
    - show relevant information information in a table
  * requestTransaction(makeGen)
    - request a transaction
  * destroy()
    - destroy the database
*/
class AbstractDatabase {
  /* ::
  y: YConfig;
  forwardAppliedOperations: boolean;
  listenersById: Object;
  listenersByIdExecuteNow: Array<Object>;
  listenersByIdRequestPending: boolean;
  initializedTypes: Object;
  whenUserIdSetListener: ?Function;
  waitingTransactions: Array<Transaction>;
  transactionInProgress: boolean;
  executeOrder: Array<Object>;
  gc1: Array<Struct>;
  gc2: Array<Struct>;
  gcTimeout: number;
  gcInterval: any;
  garbageCollect: Function;
  executeOrder: Array<any>; // for debugging only
  userId: UserId;
  opClock: number;
  transactionsFinished: ?{promise: Promise, resolve: any};
  transact: (x: ?Generator) => any;
  */
  constructor (y, opts) {
    this.y = y
    var os = this
    this.userId = null
    var resolve
    this.userIdPromise = new Promise(function (r) {
      resolve = r
    })
    this.userIdPromise.resolve = resolve
    // whether to broadcast all applied operations (insert & delete hook)
    this.forwardAppliedOperations = false
    // E.g. this.listenersById[id] : Array<Listener>
    this.listenersById = {}
    // Execute the next time a transaction is requested
    this.listenersByIdExecuteNow = []
    // A transaction is requested
    this.listenersByIdRequestPending = false
    /* To make things more clear, the following naming conventions:
        * ls : we put this.listenersById on ls
        * l : Array<Listener>
        * id : Id (can't use as property name)
        * sid : String (converted from id via JSON.stringify
                        so we can use it as a property name)

      Always remember to first overwrite
      a property before you iterate over it!
    */
    // TODO: Use ES7 Weak Maps. This way types that are no longer user,
    // wont be kept in memory.
    this.initializedTypes = {}
    this.waitingTransactions = []
    this.transactionInProgress = false
    this.transactionIsFlushed = false
    if (typeof YConcurrency_TestingMode !== 'undefined') {
      this.executeOrder = []
    }
    this.gc1 = [] // first stage
    this.gc2 = [] // second stage -> after that, remove the op
    this.gcTimeout = !opts.gcTimeout ? 50000 : opts.gcTimeouts
    function garbageCollect () {
      return os.whenTransactionsFinished().then(function () {
        if (os.gc1.length > 0 || os.gc2.length > 0) {
          if (!os.y.isConnected()) {
            console.warn('gc should be empty when disconnected!')
          }
          return new Promise((resolve) => {
            os.requestTransaction(function * () {
              if (os.y.connector != null && os.y.connector.isSynced) {
                for (var i = 0; i < os.gc2.length; i++) {
                  var oid = os.gc2[i]
                  yield* this.garbageCollectOperation(oid)
                }
                os.gc2 = os.gc1
                os.gc1 = []
              }
              // TODO: Use setInterval here instead (when garbageCollect is called several times there will be several timeouts..)
              if (os.gcTimeout > 0) {
                os.gcInterval = setTimeout(garbageCollect, os.gcTimeout)
              }
              resolve()
            })
          })
        } else {
          // TODO: see above
          if (os.gcTimeout > 0) {
            os.gcInterval = setTimeout(garbageCollect, os.gcTimeout)
          }
          return Promise.resolve()
        }
      })
    }
    this.garbageCollect = garbageCollect
    if (this.gcTimeout > 0) {
      garbageCollect()
    }
  }
  queueGarbageCollector (id) {
    if (this.y.isConnected()) {
      this.gc1.push(id)
    }
  }
  emptyGarbageCollector () {
    return new Promise(resolve => {
      var check = () => {
        if (this.gc1.length > 0 || this.gc2.length > 0) {
          this.garbageCollect().then(check)
        } else {
          resolve()
        }
      }
      setTimeout(check, 0)
    })
  }
  addToDebug () {
    if (typeof YConcurrency_TestingMode !== 'undefined') {
      var command /* :string */ = Array.prototype.map.call(arguments, function (s) {
        if (typeof s === 'string') {
          return s
        } else {
          return JSON.stringify(s)
        }
      }).join('').replace(/"/g, "'").replace(/,/g, ', ').replace(/:/g, ': ')
      this.executeOrder.push(command)
    }
  }
  getDebugData () {
    console.log(this.executeOrder.join('\n'))
  }
  stopGarbageCollector () {
    var self = this
    return new Promise(function (resolve) {
      self.requestTransaction(function * () {
        var ungc /* :Array<Struct> */ = self.gc1.concat(self.gc2)
        self.gc1 = []
        self.gc2 = []
        for (var i = 0; i < ungc.length; i++) {
          var op = yield* this.getOperation(ungc[i])
          if (op != null) {
            delete op.gc
            yield* this.setOperation(op)
          }
        }
        resolve()
      })
    })
  }
  /*
    Try to add to GC.

    TODO: rename this function

    Rulez:
    * Only gc if this user is online
    * The most left element in a list must not be gc'd.
      => There is at least one element in the list

    returns true iff op was added to GC
  */
  * addToGarbageCollector (op, left) {
    if (
      op.gc == null &&
      op.deleted === true
    ) {
      var gc = false
      if (left != null && left.deleted === true) {
        gc = true
      } else if (op.content != null && op.content.length > 1) {
        op = yield* this.getInsertionCleanStart([op.id[0], op.id[1] + 1])
        gc = true
      }
      if (gc) {
        op.gc = true
        yield* this.setOperation(op)
        this.store.queueGarbageCollector(op.id)
        return true
      }
    }
    return false
  }
  removeFromGarbageCollector (op) {
    function filter (o) {
      return !Y.utils.compareIds(o, op.id)
    }
    this.gc1 = this.gc1.filter(filter)
    this.gc2 = this.gc2.filter(filter)
    delete op.gc
  }
  * destroy () {
    clearInterval(this.gcInterval)
    this.gcInterval = null
    for (var key in this.initializedTypes) {
      var type = this.initializedTypes[key]
      if (type._destroy != null) {
        type._destroy()
      } else {
        console.error('The type you included does not provide destroy functionality, it will remain in memory (updating your packages will help).')
      }
    }
  }
  setUserId (userId) {
    if (!this.userIdPromise.inProgress) {
      this.userIdPromise.inProgress = true
      var self = this
      self.requestTransaction(function * () {
        self.userId = userId
        var state = yield* this.getState(userId)
        self.opClock = state.clock
        self.userIdPromise.resolve(userId)
      })
    }
    return this.userIdPromise
  }
  whenUserIdSet (f) {
    this.userIdPromise.then(f)
  }
  getNextOpId (numberOfIds) {
    if (numberOfIds == null) {
      throw new Error('getNextOpId expects the number of created ids to create!')
    } else if (this.userId == null) {
      throw new Error('OperationStore not yet initialized!')
    } else {
      var id = [this.userId, this.opClock]
      this.opClock += numberOfIds
      return id
    }
  }
  /*
    Apply a list of operations.

    * get a transaction
    * check whether all Struct.*.requiredOps are in the OS
    * check if it is an expected op (otherwise wait for it)
    * check if was deleted, apply a delete operation after op was applied
  */
  apply (ops) {
    for (var i = 0; i < ops.length; i++) {
      var o = ops[i]
      if (o.id == null || o.id[0] !== this.y.connector.userId) {
        var required = struct[o.struct].requiredOps(o)
        if (o.requires != null) {
          required = required.concat(o.requires)
        }
        this.whenOperationsExist(required, o)
      }
    }
  }
  /*
    op is executed as soon as every operation requested is available.
    Note that Transaction can (and should) buffer requests.
  */
  whenOperationsExist (ids, op) {
    if (ids.length > 0) {
      let listener = {
        op: op,
        missing: ids.length
      }

      for (let i = 0; i < ids.length; i++) {
        let id = ids[i]
        let sid = JSON.stringify(id)
        let l = this.listenersById[sid]
        if (l == null) {
          l = []
          this.listenersById[sid] = l
        }
        l.push(listener)
      }
    } else {
      this.listenersByIdExecuteNow.push({
        op: op
      })
    }

    if (this.listenersByIdRequestPending) {
      return
    }

    this.listenersByIdRequestPending = true
    var store = this

    this.requestTransaction(function * () {
      var exeNow = store.listenersByIdExecuteNow
      store.listenersByIdExecuteNow = []

      var ls = store.listenersById
      store.listenersById = {}

      store.listenersByIdRequestPending = false

      for (let key = 0; key < exeNow.length; key++) {
        let o = exeNow[key].op
        yield* store.tryExecute.call(this, o)
      }

      for (var sid in ls) {
        var l = ls[sid]
        var id = JSON.parse(sid)
        var op
        if (typeof id[1] === 'string') {
          op = yield* this.getOperation(id)
        } else {
          op = yield* this.getInsertion(id)
        }
        if (op == null) {
          store.listenersById[sid] = l
        } else {
          for (let i = 0; i < l.length; i++) {
            let listener = l[i]
            let o = listener.op
            if (--listener.missing === 0) {
              yield* store.tryExecute.call(this, o)
            }
          }
        }
      }
    })
  }
  /*
    Actually execute an operation, when all expected operations are available.
  */
  /* :: // TODO: this belongs somehow to transaction
  store: Object;
  getOperation: any;
  isGarbageCollected: any;
  addOperation: any;
  whenOperationsExist: any;
  */
  * tryExecute (op) {
    this.store.addToDebug('yield* this.store.tryExecute.call(this, ', JSON.stringify(op), ')')
    if (op.struct === 'Delete') {
      yield* struct.Delete.execute.call(this, op)
      // this is now called in Transaction.deleteOperation!
      // yield* this.store.operationAdded(this, op)
    } else {
      // check if this op was defined
      var defined = yield* this.getInsertion(op.id)
      while (defined != null && defined.content != null) {
        // check if this op has a longer content in the case it is defined
        if (defined.id[1] + defined.content.length < op.id[1] + op.content.length) {
          var overlapSize = defined.content.length - (op.id[1] - defined.id[1])
          op.content.splice(0, overlapSize)
          op.id = [op.id[0], op.id[1] + overlapSize]
          op.left = utils.getLastId(defined)
          op.origin = op.left
          defined = yield* this.getOperation(op.id) // getOperation suffices here
        } else {
          break
        }
      }
      if (defined == null) {
        var opid = op.id
        var isGarbageCollected = yield* this.isGarbageCollected(opid)
        if (!isGarbageCollected) {
          yield* struct[op.struct].execute.call(this, op)
          yield* this.addOperation(op)
          yield* this.store.operationAdded(this, op)
          if (!utils.compareIds(opid, op.id)) {
            // operationAdded changed op
            op = yield* this.getOperation(opid)
          }
          // if insertion, try to combine with left
          yield* this.tryCombineWithLeft(op)
        }
      }
    }
  }
  /*
    * Called by a transaction when an operation is added.
    * This function is especially important for y-indexeddb, where several instances may share a single database.
    * Every time an operation is created by one instance, it is send to all other instances and operationAdded is called
    *
    * If it's not a Delete operation:
    *   * Checks if another operation is executable (listenersById)
    *   * Update state, if possible
    *
    * Always:
    *   * Call type
    */
  * operationAdded (transaction, op) {
    if (op.struct === 'Delete') {
      var target = yield* transaction.getInsertion(op.target)
      var type = this.initializedTypes[JSON.stringify(target.parent)]
      if (type != null) {
        yield* type._changed(transaction, op)
      }
    } else {
      // increase SS
      yield* transaction.updateState(op.id[0])
      var opLen = op.content != null ? op.content.length : 1
      for (let i = 0; i < opLen; i++) {
        // notify whenOperation listeners (by id)
        var sid = JSON.stringify([op.id[0], op.id[1] + i])
        var l = this.listenersById[sid]
        delete this.listenersById[sid]
        if (l != null) {
          for (var key in l) {
            var listener = l[key]
            if (--listener.missing === 0) {
              this.whenOperationsExist([], listener.op)
            }
          }
        }
      }
      var t = this.initializedTypes[JSON.stringify(op.parent)]

      // if parent is deleted, mark as gc'd and return
      if (op.parent != null) {
        var parentIsDeleted = yield* transaction.isDeleted(op.parent)
        if (parentIsDeleted) {
          yield* transaction.deleteList(op.id)
          return
        }
      }

      // notify parent, if it was instanciated as a custom type
      if (t != null) {
        let o = utils.copyOperation(op)
        yield* t._changed(transaction, o)
      }
      if (!op.deleted) {
        // Delete if DS says this is actually deleted
        var len = op.content != null ? op.content.length : 1
        var startId = op.id // You must not use op.id in the following loop, because op will change when deleted
        for (let i = 0; i < len; i++) {
          var id = [startId[0], startId[1] + i]
          var opIsDeleted = yield* transaction.isDeleted(id)
          if (opIsDeleted) {
            var delop = {
              struct: 'Delete',
              target: id
            }
            yield* this.tryExecute.call(transaction, delop)
          }
        }
      }
    }
  }
  whenTransactionsFinished () {
    if (this.transactionInProgress) {
      if (this.transactionsFinished == null) {
        var resolve
        var promise = new Promise(function (r) {
          resolve = r
        })
        this.transactionsFinished = {
          resolve: resolve,
          promise: promise
        }
        return promise
      } else {
        return this.transactionsFinished.promise
      }
    } else {
      return Promise.resolve()
    }
  }
  // Check if there is another transaction request.
  // * the last transaction is always a flush :)
  getNextRequest () {
    if (this.waitingTransactions.length === 0) {
      if (this.transactionIsFlushed) {
        this.transactionInProgress = false
        this.transactionIsFlushed = false
        if (this.transactionsFinished != null) {
          this.transactionsFinished.resolve()
          this.transactionsFinished = null
        }
        return null
      } else {
        this.transactionIsFlushed = true
        return function * () {
          yield* this.flush()
        }
      }
    } else {
      this.transactionIsFlushed = false
      return this.waitingTransactions.shift()
    }
  }
  requestTransaction (makeGen/* :any */, callImmediately) {
    this.waitingTransactions.push(makeGen)
    if (!this.transactionInProgress) {
      this.transactionInProgress = true
      setTimeout(() => {
        this.transact(this.getNextRequest())
      }, 0)
    }
  }
}
