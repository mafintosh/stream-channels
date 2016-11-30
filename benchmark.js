var bench = require('nanobench')
var zero = require('dev-zero-stream')
var channels = require('stream-channels')

bench('1 channel with 1gb data', function (b) {
  var ch = channels(function (stream) {
    stream.resume()
    stream.on('end', function () {
      b.end()
    })
  })

  zero(1024 * 1024 * 1024).pipe(ch.createChannel())

  ch.pipe(ch)
})

bench('5 channels with 1gb data each', function (b) {
  var missing = 5

  var ch = channels(function (stream) {
    stream.resume()
    stream.on('end', function () {
      if (!--missing) b.end()
    })
  })

  for (var i = 0; i < 5; i++) {
    zero(1024 * 1024 * 1024).pipe(ch.createChannel())
  }

  ch.pipe(ch)
})

bench('1 channel with 1gb data (preallocated)', function (b) {
  var ch = channels(function (stream) {
    stream.resume()
    stream.on('end', function () {
      b.end()
    })
  })

  var stream = ch.createChannel({preallocated: true})
  var buf = stream.preallocate(65532)

  zero(1024 * 1024 * 1024, buf).pipe(stream)

  ch.pipe(ch)
})

bench('5 channel with 1gb data each (preallocated)', function (b) {
  var missing = 5

  var ch = channels(function (stream) {
    stream.resume()
    stream.on('end', function () {
      if (!--missing) b.end()
    })
  })

  for (var i = 0; i < 5; i++) {
    var stream = ch.createChannel({preallocated: true})
    var buf = stream.preallocate(65532)
    zero(1024 * 1024 * 1024, buf).pipe(stream)
  }

  ch.pipe(ch)
})
