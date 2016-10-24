var tape = require('tape')
var channels = require('./')

tape('create channel', function (t) {
  var stream = channels(function (channel) {
    channel.on('data', function (data) {
      t.same(data, new Buffer('hello'), 'first buffer is hello')
    })
    channel.on('end', function () {
      t.pass('stream ended')
      t.end()
    })
  })

  var channel = stream.createChannel()

  channel.write('hello')
  channel.end()

  stream.pipe(stream)
})

tape('create multiple channels', function (t) {
  t.plan(10)

  var stream = channels(function (channel) {
    channel.on('data', function (data) {
      t.same(data, new Buffer('hello #' + channel.id), 'first buffer is hello')
    })
    channel.on('end', function () {
      t.pass('stream ended')
    })
  })

  for (var i = 0; i < 5; i++) {
    var channel = stream.createChannel()
    channel.write('hello #' + i)
    channel.end()
  }

  stream.pipe(stream)
})

tape('limit exceeded', function (t) {
  var stream = channels({limit: 1}, function (channel) {
    channel.resume()
  })

  for (var i = 0; i < 2; i++) {
    var channel = stream.createChannel()
    channel.write('hello #' + i)
    channel.end()
  }

  stream.on('error', function (err) {
    t.ok(err, 'too many channels')
    t.end()
  })

  stream.pipe(stream)
})

tape('re-use channels', function (t) {
  t.plan(10)

  var runs = 0
  var stream = channels(function (channel) {
    t.same(channel.id, 0, 'channel id is re-used')
  })

  loop()

  function loop () {
    if (runs++ === 10) return
    var channel = stream.createChannel()
    channel.on('finish', loop)
    channel.write('hello')
    channel.end()
  }

  stream.pipe(stream)
})

tape('back pressure', function (t) {
  var stream = channels()

  var a = stream.createChannel()
  var b = stream.createChannel()
  var buf = new Buffer(4 * 1024)

  for (var i = 0; i < 1000; i++) {
    a.write(buf)
    b.write(buf)
  }

  t.notOk(a.write('more'), 'a hit hwm')
  t.notOk(b.write('more'), 'b hit hwm')

  a.once('drain', function () {
    t.fail('a should not drain')
  })

  b.once('drain', function () {
    t.fail('b should not drain')
  })

  setTimeout(function () {
    t.end()
  }, 100)

  stream.pipe(stream)
})

tape('back pressure (slowest one is the bottleneck)', function (t) {
  var stream = channels(function (channel) {
    if (channel.id) channel.resume()
    else channel.pause()
  })

  var a = stream.createChannel()
  var b = stream.createChannel()
  var buf = new Buffer(4 * 1024)

  for (var i = 0; i < 1000; i++) {
    a.write(buf)
    b.write(buf)
  }

  t.notOk(a.write('more'), 'a hit hwm')
  t.notOk(b.write('more'), 'b hit hwm')

  a.once('drain', function () {
    t.fail('a should not drain')
  })

  b.once('drain', function () {
    t.fail('b should not drain')
  })

  setTimeout(function () {
    t.end()
  }, 100)

  stream.pipe(stream)
})

tape('back pressure resumes', function (t) {
  t.plan(4)

  var resumed = false
  var stream = channels(function (channel) {
    if (channel.id) channel.resume()
    else channel.pause()

    setTimeout(function () {
      resumed = true
      channel.resume()
    }, 200)
  })

  var a = stream.createChannel()
  var b = stream.createChannel()
  var buf = new Buffer(4 * 1024)

  for (var i = 0; i < 1000; i++) {
    a.write(buf)
    b.write(buf)
  }

  t.notOk(a.write('more'), 'a hit hwm')
  t.notOk(b.write('more'), 'b hit hwm')

  a.once('drain', function () {
    t.ok(resumed, 'a drains after resume')
  })

  b.once('drain', function () {
    t.ok(resumed, 'b drains after resume')
  })

  stream.pipe(stream)
})
