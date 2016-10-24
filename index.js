var lpstream = require('length-prefixed-stream')
var duplexify = require('duplexify')
var inherits = require('inherits')
var varint = require('varint')
var stream = require('readable-stream')

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

  this._outgoing = []
  this._incoming = []
  this._waiting = 0
  this._encode = new Sink()
  this._decode = lpstream.decode()
  this._decode.on('data', parse)

  this.setWritable(this._decode)
  this.setReadable(this._encode)

  if (onchannel) this.on('channel', onchannel)

  function parse (data) {
    self._parse(data)
  }
}

inherits(StreamChannels, duplexify)

StreamChannels.prototype.createChannel = function (opts) {
  if (this.destroyed) return null

  var next = this._outgoing.indexOf(null)
  if (next === -1) next = this._outgoing.push(null) - 1

  var ch = new OutgoingChannel(this, next, opts)
  this._outgoing[next] = ch

  return ch
}

StreamChannels.prototype._parse = function (data) {
  if (this.destroyed) return
  if (!data.length) return

  var offset = 0
  var channel = varint.decode(data, offset)
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
  if (err) this.emit('error', err)
  this.emit('close')
}

function Sink () {
  stream.Readable.call(this)
  this._pending = []
}

inherits(Sink, stream.Readable)

Sink.prototype._read = function () {
  var pending = this._pending
  if (pending.length > 1) this._pending = []
  while (pending.length) pending.shift()()
}

Sink.prototype._push = function (data, cb) {
  if (this.push(data)) cb()
  else this._pending.push(cb)
}

function IncomingChannel (parent, channel) {
  stream.Readable.call(this)

  this.id = channel
  this.idLength = varint.encodingLength(channel)
  this.stream = parent
  this.destroyed = false

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

  if (this._preallocated) {
    this.stream._encode._push(data, cb)
  } else {
    var buf = this.preallocate(data.length)
    data.copy(buf, buf.length - data.length)
    this.stream._encode._push(buf, cb)
  }
}

function noop () {}
