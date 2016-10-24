var channels = require('./')

var stream = channels()

stream.on('channel', function (channel) {
  console.log('new channel')
  channel.on('data', console.log)
  channel.on('end', function () {
    console.log('(no more data)')
  })
})

var ch1 = stream.createChannel()
var ch2 = stream.createChannel()

ch1.write('hello')
ch2.write('world')

ch1.end()
ch2.end()

stream.pipe(stream)
