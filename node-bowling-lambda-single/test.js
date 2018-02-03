var test = require('tape')
var lib = require('./')

test('happy path', function (t) {
  var event = [
    '81', '9-', '9/',
    '71', '9-', 'X',
    '90', '70', 'x',
    '7-'
  ]

  var context = {
    succeed: function (result) {
      t.ok(result, 'success should receive a result')
      t.end()
    }
  }
  lib.handler(event, context)
})
