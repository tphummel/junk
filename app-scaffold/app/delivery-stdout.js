'use strict'
var url = require('url')

function deliveryStdout (tokenToSend, uidToSend, recipient, cb) {
  var loginUrl = url.format({
    protocol: 'http',
    hostname: process.env.HOST,
    port: process.env.PORT,
    pathname: '/login-return',
    query: {
      token: tokenToSend,
      uid: uidToSend
    }
  })

  console.log(`
    link: ${loginUrl.toString()}
    recipient: ${recipient}
  `)
  return cb(null)
}

module.exports = deliveryStdout
