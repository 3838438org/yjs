/* @flow */
'use strict'

import AbstractConnector from './Connector.js'
Y.AbstractConnector = AbstractConnector
import AbstractDatabase from './Database.js'
Y.AbstractDatabase = AbstractDatabase
import TransactionInterface from '/Transaction.js'
Y.TransactionInterface = TransactionInterface
import struct from './Struct.js'
Y.struct = struct
import utils from './Utils.js'
Y.utils = utils
import Test from './TestConnector.js'
Y.Test = Test

var requiringModules = {}

export default Y

Y.requiringModules = requiringModules

Y.extend = function (name, value) {
  if (value instanceof Y.utils.CustomType) {
    Y[name] = value.parseArguments
  } else {
    Y[name] = value
  }
  if (requiringModules[name] != null) {
    requiringModules[name].resolve()
    delete requiringModules[name]
  }
}

Y.requestModules = requestModules
function requestModules (modules) {
  // determine if this module was compiled for es5 or es6 (y.js vs. y.es6)
  // if Insert.execute is a Function, then it isnt a generator..
  // then load the es5(.js) files..
  var extention = typeof regeneratorRuntime !== 'undefined' ? '.js' : '.es6'
  var promises = []
  for (var i = 0; i < modules.length; i++) {
    var module = modules[i].split('(')[0]
    var modulename = 'y-' + module.toLowerCase()
    if (Y[module] == null) {
      if (requiringModules[module] == null) {
        // module does not exist
        if (typeof window !== 'undefined' && window.Y !== 'undefined') {
          var imported = document.createElement('script')
          imported.src = Y.sourceDir + '/' + modulename + '/' + modulename + extention
          document.head.appendChild(imported)

          let requireModule = {}
          requiringModules[module] = requireModule
          requireModule.promise = new Promise(function (resolve) {
            requireModule.resolve = resolve
          })
          promises.push(requireModule.promise)
        } else {
          console.info('YJS: Please do not depend on automatic requiring of modules anymore! Extend modules as follows `require(\'y-modulename\')(Y)`')
          require(modulename)(Y)
        }
      } else {
        promises.push(requiringModules[modules[i]].promise)
      }
    }
  }
  return Promise.all(promises)
}

/* ::
type MemoryOptions = {
  name: 'memory'
}
type IndexedDBOptions = {
  name: 'indexeddb',
  namespace: string
}
type DbOptions = MemoryOptions | IndexedDBOptions

type WebRTCOptions = {
  name: 'webrtc',
  room: string
}
type WebsocketsClientOptions = {
  name: 'websockets-client',
  room: string
}
type ConnectionOptions = WebRTCOptions | WebsocketsClientOptions

type YOptions = {
  connector: ConnectionOptions,
  db: DbOptions,
  types: Array<TypeName>,
  sourceDir: string,
  share: {[key: string]: TypeName}
}
*/

function Y (opts/* :YOptions */) /* :Promise<YConfig> */ {
  opts.types = opts.types != null ? opts.types : []
  var modules = [opts.db.name, opts.connector.name].concat(opts.types)
  for (var name in opts.share) {
    modules.push(opts.share[name])
  }
  Y.sourceDir = opts.sourceDir
  return new Promise(function (resolve, reject) {
    setTimeout(function () {
      Y.requestModules(modules).then(function () {
        if (opts == null) reject('An options object is expected! ')
        else if (opts.connector == null) reject('You must specify a connector! (missing connector property)')
        else if (opts.connector.name == null) reject('You must specify connector name! (missing connector.name property)')
        else if (opts.db == null) reject('You must specify a database! (missing db property)')
        else if (opts.connector.name == null) reject('You must specify db name! (missing db.name property)')
        else if (opts.share == null) reject('You must specify a set of shared types!')
        else {
          var yconfig = new YConfig(opts)
          yconfig.db.whenUserIdSet(function () {
            yconfig.init(function () {
              resolve(yconfig)
            })
          })
        }
      }).catch(reject)
    }, 0)
  })
}

class YConfig {
  /* ::
  db: Y.AbstractDatabase;
  connector: Y.AbstractConnector;
  share: {[key: string]: any};
  options: Object;
  */
  constructor (opts, callback) {
    this.options = opts
    this.db = new Y[opts.db.name](this, opts.db)
    this.connector = new Y[opts.connector.name](this, opts.connector)
  }
  init (callback) {
    var opts = this.options
    var share = {}
    this.share = share
    this.db.requestTransaction(function * requestTransaction () {
      // create shared object
      for (var propertyname in opts.share) {
        var typeConstructor = opts.share[propertyname].split('(')
        var typeName = typeConstructor.splice(0, 1)
        var args = []
        if (typeConstructor.length === 1) {
          try {
            args = JSON.parse('[' + typeConstructor[0].split(')')[0] + ']')
          } catch (e) {
            throw new Error('Was not able to parse type definition! (share.' + propertyname + ')')
          }
        }
        var type = Y[typeName]
        var typedef = type.typeDefinition
        var id = ['_', typedef.struct + '_' + typeName + '_' + propertyname + '_' + typeConstructor]
        share[propertyname] = yield* this.createType(type.apply(typedef, args), id)
      }
      this.store.whenTransactionsFinished()
        .then(callback)
    })
  }
  isConnected () {
    return this.connector.isSynced
  }
  disconnect () {
    return this.connector.disconnect()
  }
  reconnect () {
    return this.connector.reconnect()
  }
  destroy () {
    if (this.connector.destroy != null) {
      this.connector.destroy()
    } else {
      this.connector.disconnect()
    }
    var self = this
    this.db.requestTransaction(function * () {
      yield* self.db.destroy()
      self.connector = null
      self.db = null
    })
  }
}
