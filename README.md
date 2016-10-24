# stream-channels

Simple one-way stream multiplexer with very few features.
For two-way (full duplex) multiplexing see the [multiplex](https:/github.com/maxogden/multiplex) module.

```
npm install stream-channels
```

[![build status](http://img.shields.io/travis/mafintosh/stream-channels.svg?style=flat)](http://travis-ci.org/mafintosh/stream-channels)

## Usage

``` js
var channels = require('stream-channels')
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
```

## API

#### `var stream = channels([options], [onchannel])`

Create a new instance. Options include:

``` js
{
  limit: maxChannelsAllowedOpen // defaults to 1024
}
```

#### `var writeableStream = stream.createChannel()`

Create a new channel.

#### `stream.on('channel', readableStream)`

Emitted when a remote creates a new channel. Will emit the data the remote writes to it.

## Wire Protocol

The wire protocol is as follows.

```
------------------------------
| length | channel-id | data |
------------------------------
```

* Length is a [varint](https://github.com/chrisdickinson/varint) containing the binary length of channel-id and data.
* Channel id is a [varint](https://github.com/chrisdickinson/varint) representing the current channel.
* Data is the buffer you wrote to a channel

Channels are lazily opened., The first time you receive data on a channel id, that channel is opened.
Receiving an empty data buffer indicates that the channel is closed.

## Back pressure

Back pressure will trigger on all channels when the *slowest* channel starts to back pressure.

## License

MIT
