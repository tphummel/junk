process.env.NODE_ENV = 'test'
test = require 'tape'

spec = require './spec'

test 'harness', (t) ->
  t.plan 3

  t.ok true, 'harness control'

  t.test 'test external api', (st) ->
    st.ok true, 'test lib api'
    st.end()

  t.test 'spec test', spec
