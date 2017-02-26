var test = require('tape'),
    lib = require('..')

test('create event, get metric', function(t){
  var authToken = process.env.AUTHTOKEN,
      metricId = process.env.METRIC_ID,
      client = lib(authToken),
      body = {value: 1}

  client.events.post(metricId, body, function(err, data, resp){
    console.log(err, data)
    if(err) t.fail()

    console.log(data)

    t.end()

  })

})
