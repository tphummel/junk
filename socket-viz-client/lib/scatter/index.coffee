ScatterView = require "./view.coffee"

sv = new ScatterView 
  selector: ".scatter"
  windowHeight: window.innerHeight
  windowWidth: window.innerWidth

module.exports = sv