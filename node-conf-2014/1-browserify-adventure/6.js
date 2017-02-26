var domify = require('domify')

module.exports = Widget

function Widget(){
  if (!(this instanceof Widget))
    return new Widget()

  this.el = document.createElement('div')
  this.el.innerHTML = 'Hello <span class="name"></span>!'
  return this
}

Widget.prototype.setName = function(name){
  this.el.innerHTML = 'Hello <span class="name">'+name+'</span>!'
}

Widget.prototype.appendTo = function(target){
  target.appendChild(this.el)
}
