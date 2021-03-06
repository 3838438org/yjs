const CDELETE = 0
const CINSERT = 1
const CLIST = 2
const CMAP = 3
const CXML = 4

/*
 An operation also defines the structure of a type. This is why operation and
 structure are used interchangeably here.

 It must be of the type Object. I hope to achieve some performance
 improvements when working on databases that support the json format.

 An operation must have the following properties:

 * encode
     - Encode the structure in a readable format (preferably string- todo)
 * decode (todo)
     - decode structure to json
 * execute
     - Execute the semantics of an operation.
 * requiredOps
     - Operations that are required to execute this operation.
*/
export default function extendStruct (Y) {
  let Struct = {}
  Y.Struct = Struct
  Struct.binaryDecodeOperation = function (decoder) {
    let code = decoder.peekUint8()
    if (code === CDELETE) {
      return Struct.Delete.binaryDecode(decoder)
    } else if (code === CINSERT) {
      return Struct.Insert.binaryDecode(decoder)
    } else if (code === CLIST) {
      return Struct.List.binaryDecode(decoder)
    } else if (code === CMAP) {
      return Struct.Map.binaryDecode(decoder)
    } else if (code === CXML) {
      return Struct.Xml.binaryDecode(decoder)
    } else {
      throw new Error('Unable to decode operation!')
    }
  }

  /* This is the only operation that is actually not a structure, because
  it is not stored in the OS. This is why it _does not_ have an id

  op = {
    target: Id
  }
  */
  Struct.Delete = {
    encode: function (op) {
      return {
        target: op.target,
        length: op.length || 0,
        struct: 'Delete'
      }
    },
    binaryEncode: function (encoder, op) {
      encoder.writeUint8(CDELETE)
      encoder.writeOpID(op.target)
      encoder.writeVarUint(op.length || 0)
    },
    binaryDecode: function (decoder) {
      decoder.skip8()
      return {
        target: decoder.readOpID(),
        length: decoder.readVarUint(),
        struct: 'Delete'
      }
    },
    requiredOps: function (op) {
      return [] // [op.target]
    },
    execute: function (op) {
      return this.deleteOperation(op.target, op.length || 1)
    }
  }

  /* {
      content: [any],
      opContent: Id,
      id: Id,
      left: Id,
      origin: Id,
      right: Id,
      parent: Id,
      parentSub: string (optional), // child of Map type
    }
  */
  Struct.Insert = {
    encode: function (op/* :Insertion */) /* :Insertion */ {
      // TODO: you could not send the "left" property, then you also have to
      // "op.left = null" in $execute or $decode
      var e/* :any */ = {
        id: op.id,
        left: op.left,
        right: op.right,
        origin: op.origin,
        parent: op.parent,
        struct: op.struct
      }
      if (op.parentSub != null) {
        e.parentSub = op.parentSub
      }
      if (op.hasOwnProperty('opContent')) {
        e.opContent = op.opContent
      } else {
        e.content = op.content.slice()
      }

      return e
    },
    binaryEncode: function (encoder, op) {
      encoder.writeUint8(CINSERT)
      // compute info property
      let contentIsText = op.content != null && op.content.every(c => typeof c === 'string' && c.length === 1)
      let originIsLeft = Y.utils.compareIds(op.left, op.origin)
      let info =
        (op.parentSub != null ? 1 : 0) |
        (op.opContent != null ? 2 : 0) |
        (contentIsText ? 4 : 0) |
        (originIsLeft ? 8 : 0) |
        (op.left != null ? 16 : 0) |
        (op.right != null ? 32 : 0) |
        (op.origin != null ? 64 : 0)
      encoder.writeUint8(info)
      encoder.writeOpID(op.id)
      encoder.writeOpID(op.parent)
      if (info & 16) {
        encoder.writeOpID(op.left)
      }
      if (info & 32) {
        encoder.writeOpID(op.right)
      }
      if (!originIsLeft && info & 64) {
        encoder.writeOpID(op.origin)
      }
      if (info & 1) {
        // write parentSub
        encoder.writeVarString(op.parentSub)
      }
      if (info & 2) {
        // write opContent
        encoder.writeOpID(op.opContent)
      } else if (info & 4) {
        // write text
        encoder.writeVarString(op.content.join(''))
      } else {
        // convert to JSON and write
        encoder.writeVarString(JSON.stringify(op.content))
      }
    },
    binaryDecode: function (decoder) {
      let op = {
        struct: 'Insert'
      }
      decoder.skip8()
      // get info property
      let info = decoder.readUint8()

      op.id = decoder.readOpID()
      op.parent = decoder.readOpID()
      if (info & 16) {
        op.left = decoder.readOpID()
      } else {
        op.left = null
      }
      if (info & 32) {
        op.right = decoder.readOpID()
      } else {
        op.right = null
      }
      if (info & 8) {
        // origin is left
        op.origin = op.left
      } else if (info & 64) {
        op.origin = decoder.readOpID()
      } else {
        op.origin = null
      }
      if (info & 1) {
        // has parentSub
        op.parentSub = decoder.readVarString()
      }
      if (info & 2) {
        // has opContent
        op.opContent = decoder.readOpID()
      } else if (info & 4) {
        // has pure text content
        op.content = decoder.readVarString().split('')
      } else {
        // has mixed content
        let s = decoder.readVarString()
        op.content = JSON.parse(s)
      }
      return op
    },
    requiredOps: function (op) {
      var ids = []
      if (op.left != null) {
        ids.push(op.left)
      }
      if (op.right != null) {
        ids.push(op.right)
      }
      if (op.origin != null && !Y.utils.compareIds(op.left, op.origin)) {
        ids.push(op.origin)
      }
      // if (op.right == null && op.left == null) {
      ids.push(op.parent)

      if (op.opContent != null) {
        ids.push(op.opContent)
      }
      return ids
    },
    getDistanceToOrigin: function (op) {
      if (op.left == null) {
        return 0
      } else {
        var d = 0
        var o = this.getInsertion(op.left)
        while (!Y.utils.matchesId(o, op.origin)) {
          d++
          if (o.left == null) {
            break
          } else {
            o = this.getInsertion(o.left)
          }
        }
        return d
      }
    },
    /*
    # $this has to find a unique position between origin and the next known character
    # case 1: $origin equals $o.origin: the $creator parameter decides if left or right
    #         let $OL= [o1,o2,o3,o4], whereby $this is to be inserted between o1 and o4
    #         o2,o3 and o4 origin is 1 (the position of o2)
    #         there is the case that $this.creator < o2.creator, but o3.creator < $this.creator
    #         then o2 knows o3. Since on another client $OL could be [o1,o3,o4] the problem is complex
    #         therefore $this would be always to the right of o3
    # case 2: $origin < $o.origin
    #         if current $this insert_position > $o origin: $this ins
    #         else $insert_position will not change
    #         (maybe we encounter case 1 later, then this will be to the right of $o)
    # case 3: $origin > $o.origin
    #         $this insert_position is to the left of $o (forever!)
    */
    execute: function (op) {
      var i // loop counter

      // during this function some ops may get split into two pieces (e.g. with getInsertionCleanEnd)
      // We try to merge them later, if possible
      var tryToRemergeLater = []

      if (op.origin != null) { // TODO: !== instead of !=
        // we save in origin that op originates in it
        // we need that later when we eventually garbage collect origin (see transaction)
        var origin = this.getInsertionCleanEnd(op.origin)
        if (origin.originOf == null) {
          origin.originOf = []
        }
        origin.originOf.push(op.id)
        this.setOperation(origin)
        if (origin.right != null) {
          tryToRemergeLater.push(origin.right)
        }
      }
      var distanceToOrigin = i = Struct.Insert.getDistanceToOrigin.call(this, op) // most cases: 0 (starts from 0)

      // now we begin to insert op in the list of insertions..
      var o
      var parent
      var start

      // find o. o is the first conflicting operation
      if (op.left != null) {
        o = this.getInsertionCleanEnd(op.left)
        if (!Y.utils.compareIds(op.left, op.origin) && o.right != null) {
          // only if not added previously
          tryToRemergeLater.push(o.right)
        }
        o = (o.right == null) ? null : this.getOperation(o.right)
      } else { // left == null
        parent = this.getOperation(op.parent)
        let startId = op.parentSub ? parent.map[op.parentSub] : parent.start
        start = startId == null ? null : this.getOperation(startId)
        o = start
      }

      // make sure to split op.right if necessary (also add to tryCombineWithLeft)
      if (op.right != null) {
        tryToRemergeLater.push(op.right)
        this.getInsertionCleanStart(op.right)
      }

      // handle conflicts
      while (true) {
        if (o != null && !Y.utils.compareIds(o.id, op.right)) {
          var oOriginDistance = Struct.Insert.getDistanceToOrigin.call(this, o)
          if (oOriginDistance === i) {
            // case 1
            if (o.id[0] < op.id[0]) {
              op.left = Y.utils.getLastId(o)
              distanceToOrigin = i + 1 // just ignore o.content.length, doesn't make a difference
            }
          } else if (oOriginDistance < i) {
            // case 2
            if (i - distanceToOrigin <= oOriginDistance) {
              op.left = Y.utils.getLastId(o)
              distanceToOrigin = i + 1 // just ignore o.content.length, doesn't make a difference
            }
          } else {
            break
          }
          i++
          if (o.right != null) {
            o = this.getInsertion(o.right)
          } else {
            o = null
          }
        } else {
          break
        }
      }

      // reconnect..
      var left = null
      var right = null
      if (parent == null) {
        parent = this.getOperation(op.parent)
      }

      // reconnect left and set right of op
      if (op.left != null) {
        left = this.getInsertion(op.left)
        // link left
        op.right = left.right
        left.right = op.id

        this.setOperation(left)
      } else {
        // set op.right from parent, if necessary
        op.right = op.parentSub ? parent.map[op.parentSub] || null : parent.start
      }
      // reconnect right
      if (op.right != null) {
        // TODO: wanna connect right too?
        right = this.getOperation(op.right)
        right.left = Y.utils.getLastId(op)

        // if right exists, and it is supposed to be gc'd. Remove it from the gc
        if (right.gc != null) {
          if (right.content != null && right.content.length > 1) {
            right = this.getInsertionCleanEnd(right.id)
          }
          this.store.removeFromGarbageCollector(right)
        }
        this.setOperation(right)
      }

      // update parents .map/start/end properties
      if (op.parentSub != null) {
        if (left == null) {
          parent.map[op.parentSub] = op.id
          this.setOperation(parent)
        }
        // is a child of a map struct.
        // Then also make sure that only the most left element is not deleted
        // We do not call the type in this case (this is what the third parameter is for)
        if (op.right != null) {
          this.deleteOperation(op.right, 1, true)
        }
        if (op.left != null) {
          this.deleteOperation(op.id, 1, true)
        }
      } else {
        if (right == null || left == null) {
          if (right == null) {
            parent.end = Y.utils.getLastId(op)
          }
          if (left == null) {
            parent.start = op.id
          }
          this.setOperation(parent)
        }
      }

      // try to merge original op.left and op.origin
      for (i = 0; i < tryToRemergeLater.length; i++) {
        var m = this.getOperation(tryToRemergeLater[i])
        this.tryCombineWithLeft(m)
      }
    }
  }

  /*
  {
    start: null,
    end: null,
    struct: "List",
    type: "",
    id: this.os.getNextOpId(1)
  }
  */
  Struct.List = {
    create: function (id) {
      return {
        start: null,
        end: null,
        struct: 'List',
        id: id
      }
    },
    encode: function (op) {
      var e = {
        struct: 'List',
        id: op.id,
        type: op.type
      }
      return e
    },
    binaryEncode: function (encoder, op) {
      encoder.writeUint8(CLIST)
      encoder.writeOpID(op.id)
      encoder.writeVarString(op.type)
    },
    binaryDecode: function (decoder) {
      decoder.skip8()
      let op = {
        id: decoder.readOpID(),
        type: decoder.readVarString(),
        struct: 'List',
        start: null,
        end: null
      }
      return op
    },
    requiredOps: function () {
      /*
      var ids = []
      if (op.start != null) {
        ids.push(op.start)
      }
      if (op.end != null){
        ids.push(op.end)
      }
      return ids
      */
      return []
    },
    execute: function (op) {
      op.start = null
      op.end = null
    },
    ref: function (op, pos) {
      if (op.start == null) {
        return null
      }
      var res = null
      var o = this.getOperation(op.start)

      while (true) {
        if (!o.deleted) {
          res = o
          pos--
        }
        if (pos >= 0 && o.right != null) {
          o = this.getOperation(o.right)
        } else {
          break
        }
      }
      return res
    },
    map: function (o, f) {
      o = o.start
      var res = []
      while (o != null) { // TODO: change to != (at least some convention)
        var operation = this.getOperation(o)
        if (!operation.deleted) {
          res.push(f(operation))
        }
        o = operation.right
      }
      return res
    }
  }

  /*
    {
      map: {},
      struct: "Map",
      type: "",
      id: this.os.getNextOpId(1)
    }
  */
  Struct.Map = {
    create: function (id) {
      return {
        id: id,
        map: {},
        struct: 'Map'
      }
    },
    encode: function (op) {
      var e = {
        struct: 'Map',
        type: op.type,
        id: op.id,
        map: {} // overwrite map!!
      }
      return e
    },
    binaryEncode: function (encoder, op) {
      encoder.writeUint8(CMAP)
      encoder.writeOpID(op.id)
      encoder.writeVarString(op.type)
    },
    binaryDecode: function (decoder) {
      decoder.skip8()
      let op = {
        id: decoder.readOpID(),
        type: decoder.readVarString(),
        struct: 'Map',
        map: {}
      }
      return op
    },
    requiredOps: function () {
      return []
    },
    execute: function (op) {
      op.start = null
      op.end = null
    },
    /*
      Get a property by name
    */
    get: function (op, name) {
      var oid = op.map[name]
      if (oid != null) {
        var res = this.getOperation(oid)
        if (res == null || res.deleted) {
          return void 0
        } else if (res.opContent == null) {
          return res.content[0]
        } else {
          return this.getType(res.opContent)
        }
      }
    }
  }

  /*
    {
      map: {},
      start: null,
      end: null,
      struct: "Xml",
      type: "",
      id: this.os.getNextOpId(1)
    }
  */
  Struct.Xml = {
    create: function (id, args) {
      let nodeName = args != null ? args.nodeName : null
      return {
        id: id,
        map: {},
        start: null,
        end: null,
        struct: 'Xml',
        nodeName
      }
    },
    encode: function (op) {
      var e = {
        struct: 'Xml',
        type: op.type,
        id: op.id,
        map: {},
        nodeName: op.nodeName
      }
      return e
    },
    binaryEncode: function (encoder, op) {
      encoder.writeUint8(CXML)
      encoder.writeOpID(op.id)
      encoder.writeVarString(op.type)
      encoder.writeVarString(op.nodeName)
    },
    binaryDecode: function (decoder) {
      decoder.skip8()
      let op = {
        id: decoder.readOpID(),
        type: decoder.readVarString(),
        struct: 'Xml',
        map: {},
        start: null,
        end: null,
        nodeName: decoder.readVarString()
      }
      return op
    },
    requiredOps: function () {
      return []
    },
    execute: function () {},
    ref: Struct.List.ref,
    map: Struct.List.map,
    /*
      Get a property by name
    */
    get: Struct.Map.get
  }
}
