/* global getRandom, async */
'use strict'

export default Test

import utils from 'Utils.js'
import AbstractConnector from 'Connector.js'

var globalRoom = {
  users: {},
  buffers: {}, // TODO: reimplement this idea. This does not cover all cases!! Here, you have a queue which is unrealistic (i.e. think about multiple incoming connections)
  removeUser: function (user) {
    for (var i in this.users) {
      this.users[i].userLeft(user)
    }
    delete this.users[user]
    delete this.buffers[user]
  },
  addUser: function (connector) {
    this.users[connector.userId] = connector
    this.buffers[connector.userId] = {}
    for (var uname in this.users) {
      if (uname !== connector.userId) {
        var u = this.users[uname]
        u.userJoined(connector.userId, 'master')
        connector.userJoined(u.userId, 'master')
      }
    }
  },
  whenTransactionsFinished: function () {
    var ps = []
    for (var name in this.users) {
      ps.push(this.users[name].y.db.whenTransactionsFinished())
    }
    return Promise.all(ps)
  },
  flushOne: function flushOne () {
    var bufs = []
    for (var receiver in globalRoom.buffers) {
      let buff = globalRoom.buffers[receiver]
      var push = false
      for (let sender in buff) {
        if (buff[sender].length > 0) {
          push = true
          break
        }
      }
      if (push) {
        bufs.push(receiver)
      }
    }
    if (bufs.length > 0) {
      var userId = getRandom(bufs)
      let buff = globalRoom.buffers[userId]
      let sender = getRandom(Object.keys(buff))
      var m = buff[sender].shift()
      if (buff[sender].length === 0) {
        delete buff[sender]
      }
      var user = globalRoom.users[userId]
      user.receiveMessage(m[0], m[1])
      return user.y.db.whenTransactionsFinished()
    } else {
      return false
    }
  },
  flushAll: function () {
    return new Promise(function (resolve) {
      // flushes may result in more created operations,
      // flush until there is nothing more to flush
      function nextFlush () {
        var c = globalRoom.flushOne()
        if (c) {
          while (c) {
            c = globalRoom.flushOne()
          }
          globalRoom.whenTransactionsFinished().then(nextFlush)
        } else {
          setTimeout(function () {
            var c = globalRoom.flushOne()
            if (c) {
              c.then(function () {
                globalRoom.whenTransactionsFinished().then(nextFlush)
              })
            } else {
              resolve()
            }
          }, 0)
        }
      }
      globalRoom.whenTransactionsFinished().then(nextFlush)
    })
  }
}
utils.globalRoom = globalRoom

var userIdCounter = 0

class Test extends AbstractConnector {
  constructor (y, options) {
    if (options === undefined) {
      throw new Error('Options must not be undefined!')
    }
    options.role = 'master'
    options.forwardToSyncingClients = false
    super(y, options)
    this.setUserId((userIdCounter++) + '').then(() => {
      globalRoom.addUser(this)
    })
    this.globalRoom = globalRoom
    this.syncingClientDuration = 0
  }
  receiveMessage (sender, m) {
    super.receiveMessage(sender, JSON.parse(JSON.stringify(m)))
  }
  send (userId, message) {
    var buffer = globalRoom.buffers[userId]
    if (buffer != null) {
      if (buffer[this.userId] == null) {
        buffer[this.userId] = []
      }
      buffer[this.userId].push(JSON.parse(JSON.stringify([this.userId, message])))
    }
  }
  broadcast (message) {
    for (var key in globalRoom.buffers) {
      var buff = globalRoom.buffers[key]
      if (buff[this.userId] == null) {
        buff[this.userId] = []
      }
      buff[this.userId].push(JSON.parse(JSON.stringify([this.userId, message])))
    }
  }
  isDisconnected () {
    return globalRoom.users[this.userId] == null
  }
  reconnect () {
    if (this.isDisconnected()) {
      globalRoom.addUser(this)
      super.reconnect()
    }
    return utils.globalRoom.flushAll()
  }
  disconnect () {
    if (!this.isDisconnected()) {
      globalRoom.removeUser(this.userId)
      super.disconnect()
    }
    return this.y.db.whenTransactionsFinished()
  }
  flush () {
    var self = this
    return async(function * () {
      var buff = globalRoom.buffers[self.userId]
      while (Object.keys(buff).length > 0) {
        var sender = getRandom(Object.keys(buff))
        var m = buff[sender].shift()
        if (buff[sender].length === 0) {
          delete buff[sender]
        }
        this.receiveMessage(m[0], m[1])
      }
      yield self.whenTransactionsFinished()
    })
  }
}
