GitHubApi = require "github"

github = new GitHubApi 
  version: "3.0.0"

my_auth_info = require __dirname+"/config/auth"

github.authenticate
  type: 'basic'
  username: my_auth_info.username
  password: my_auth_info.password

authorization = 
  scopes: ["gist"]
  note: "Gister local"
  
github.authorization.create authorization, (err, result) ->
  console.log "err: ", err if err?
  console.log "result: ", result
  


