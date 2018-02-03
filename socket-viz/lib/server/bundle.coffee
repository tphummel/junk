fs              = require 'fs'
browserify      = require 'browserify'
coffeeify       = require 'coffeeify'
sassify         = require 'sassify'
jadeify         = require 'simple-jadeify'

scripts = []

opts =
  noParse: scripts
  
if process.env.NODE_ENV is 'development'
  opts.debug = true

bundle = browserify opts

bundle.transform coffeeify
bundle.transform sassify
bundle.transform jadeify

bundle.add js for js in scripts

bundle.add './lib/client/entry.coffee'

out = fs.createWriteStream './public/browserify.js'
bundle.bundle().pipe out

module.exports = bundle
