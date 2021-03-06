var lpstream = require('length-prefixed-stream')
var duplexify = require('duplexify')
var inherits = require('inherits')
var varint = require('varint')
var stream = require('readable-stream')

var KEEP_ALIVE = new Buffer([0])

module.exports = StreamChannels

function StreamChannels (opts, onchannel) {
  if (!(this instanceof StreamChannels)) return new StreamChannels(opts, onchannel)
  if (typeof opts === 'function') {
    onchannel = opts
    opts = null
  }
  if (!opts) opts = {}

  duplexify.call(this)

  var self = this

  this.destroyed = false
  this.limit = opts.limit || 1024
  this.state = null // set by someone else. here for perf

  this._outgoing = []
  this._incoming = []
  this._waiting = 0
  this._encode = new Sink()
  this._decode = lpstream.decode({allowEmpty: true, limit: opts.messageLimit || 5 * 1024 * 1024})
  this._decode.on('data', parse)

  this._keepAlive = 0
  this._remoteKeepAlive = 0
  this._interval = null

  this.on('finish', this._finalize)
  this.on('close', this._finalize)

  this.setWritable(this._decode)
  this.setReadable(this._encode)

  if (onchannel) this.on('channel', onchannel)

  function parse (data) {
    self._parse(data)
  }
}

inherits(StreamChannels, duplexify)

StreamChannels.prototype.setTimeout = function (ms, ontimeout) {
  if (this.destroyed) return

  if (ontimeout) this.once('timeout', ontimeout)

  var self = this

  this._keepAlive = 0
  this._remoteKeepAlive = 0

  clearInterval(this._interval)
  this._interval = setInterval(kick, (ms / 4) | 0)
  if (this._interval.unref) this._interval.unref()

  function kick () {
    self._kick()
  }
}

StreamChannels.prototype.createChannel = function (opts) {
  if (this.destroyed) return null

  var next = this._outgoing.indexOf(null)
  if (next === -1) next = this._outgoing.push(null) - 1

  var ch = new OutgoingChannel(this, next, opts)
  this._outgoing[next] = ch

  return ch
}

StreamChannels.prototype._parse = function (data) {
  this._remoteKeepAlive = 0

  if (this.destroyed) return
  if (!data.length) return

  var offset = 0
  var channel = decodeVarint(data, offset)
  if (channel === -1) return this.destroy(new Error('Invalid channel id'))

  offset += varint.decode.bytes

  if (channel >= this.limit) return this.destroy(new Error('Too many open channels'))
  while (channel >= this._incoming.length) this._incoming.push(null)

  var ch = this._incoming[channel]

  if (!ch) { // new channel
    ch = new IncomingChannel(this, channel)
    this._incoming[channel] = ch
    this.emit('channel', ch)
  }

  if (data.length === offset) { // channel close
    this._incoming[channel] = null
  }

  ch._push(data.slice(offset))
}

StreamChannels.prototype.destroy = function (err) {
  if (this.destroyed) return
  this.destroyed = true

  clearInterval(this._interval)

  if (err) this.emit('error', err)
  this.emit('close')

  var i = 0

  for (i = 0; i < this._incoming.length; i++) {
    if (this._incoming[i]) this._incoming[i].destroy()
  }

  for (i = 0; i < this._outgoing.length; i++) {
    if (this._outgoing[i]) this._outgoing[i].destroy()
  }
}

StreamChannels.prototype.finalize = function () {
  this._encode.end()
}

StreamChannels.prototype._kick = function () {
  if (this._remoteKeepAlive > 4) {
    clearInterval(this._interval)
    this.emit('timeout')
    return
  }

  this.emit('tick')
  this._remoteKeepAlive++

  if (this._keepAlive > 2) {
    this._encode.push(KEEP_ALIVE)
    this._keepAlive = 0
  } else {
    this._keepAlive++
  }
}

StreamChannels.prototype._finalize = function () {
  this.destroy()
}

function Sink () {
  stream.Readable.call(this)
  this._pending = []
  this._ended = false
}

inherits(Sink, stream.Readable)

Sink.prototype._read = function () {
  var pending = this._pending
  if (pending.length > 1) this._pending = []
  while (pending.length) pending.shift()()
}

Sink.prototype._push = function (data, cb) {
  if (this._ended) return cb()
  if (this.push(data)) cb()
  else this._pending.push(cb)
}

Sink.prototype.end = function () {
  this._ended = true
  this.push(null)
}

function IncomingChannel (parent, channel) {
  stream.Readable.call(this)

  this.id = channel
  this.idLength = varint.encodingLength(channel)
  this.stream = parent
  this.destroyed = false
  this.state = null // set by someone else. here for perf

  this._waiting = 0
}

inherits(IncomingChannel, stream.Readable)

IncomingChannel.prototype.destroy = function (err) {
  if (this.destroyed) return
  this.destroyed = true
  if (err) this.emit('error', err)
  this.emit('close')
}

IncomingChannel.prototype._push = function (data) {
  if (this.destroyed) return

  if (!data.length) {
    this.push(null)
    this.destroy()
    return
  }

  if (!this.push(data)) {
    this.stream._waiting++
    this._waiting++
    if (this.stream._waiting === 1) this.stream._decode.pause()
  }
}

IncomingChannel.prototype._read = function () {
  if (!this._waiting) return
  this.stream._waiting -= this._waiting
  this._waiting = 0
  if (this.stream._waiting === 0) this.stream._decode.resume()
}

function OutgoingChannel (parent, channel, opts) {
  stream.Writable.call(this, opts)

  this.id = channel
  this.idLength = varint.encodingLength(channel)
  this.stream = parent
  this.destroyed = false
  this.state = null // set by someone else. here for perf

  this._preallocated = !!(opts && opts.preallocated)
  this.on('finish', this._finalize)
}

inherits(OutgoingChannel, stream.Writable)

OutgoingChannel.prototype.destroy = function (err) {
  if (this.destroyed) return
  this.destroyed = true
  this.stream._encode._push(this.preallocate(0), noop)
  this.stream._outgoing[this.id] = null
  if (err) this.emit('error', err)
  this.emit('close')
}

OutgoingChannel.prototype.preallocate = function (length) {
  var payload = this.idLength + length
  var buf = new Buffer(varint.encodingLength(payload) + payload)
  var offset = 0

  varint.encode(payload, buf, offset)
  offset += varint.encode.bytes

  varint.encode(this.id, buf, offset)
  offset += varint.encode.bytes

  return buf
}

OutgoingChannel.prototype._finalize = function () {
  this.destroy()
}

OutgoingChannel.prototype._write = function (data, enc, cb) {
  if (this.stream.destroyed) return cb()

  this.stream._keepAlive = 0

  if (this._preallocated) {
    this.stream._encode._push(data, cb)
  } else {
    var buf = this.preallocate(data.length)
    data.copy(buf, buf.length - data.length)
    this.stream._encode._push(buf, cb)
  }
}

function noop () {}

function decodeVarint (buf, offset) {
  try {
    return varint.decode(buf, offset)
  } catch (err) {
    return -1
  }
}
