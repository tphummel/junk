fs = require "fs"
browserify = require "browserify"

{version}       = require '../../package.json'

opts = {}

bundle = browserify opts
bundle.prepend "window.VERSION = '#{version}';"

includes = [
  "ember-1.0.0-rc.2.min.js"
]

preBlock = []

for js in includes
  preBlock.push ";"
  preBlock.push "\n// File: #{js} \n"
  preBlock.push fs.readFileSync "./lib/client/vendor/#{js}"

bundle.prepend preBlock.join "\n"

bundle.addEntry './lib/client/entry.coffee'

fs.writeFileSync './public/js/browserify.js', bundle.bundle()

module.exports = bundle