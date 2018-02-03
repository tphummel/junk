url = require "url"
xhr = require "xhr"

module.exports = getUserStars = (user, cb) ->
  starUrl = url.format 
    protocol: "https"
    hostname: "api.github.com"
    pathname: "/users/#{user}/watched"
  
  xhrOpts = 
    method: "GET"
    uri: starUrl

  xhr xhrOpts, (e,r,b) -> 
    payload = null

    try 
      payload = JSON.parse b
    catch e
      return cb e, null

    cb e, payload
