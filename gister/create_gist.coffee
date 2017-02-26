GitHubApi = require "github"

github = new GitHubApi 
  version: "3.0.0"


auth = require "#{__dirname}/config/auth"

github.authenticate
  type: "oauth"
  token: auth.oauth2_token

gist = 
  description: "doop dee doo dah"
  public: false
  files: 
    "file3.txt": 
      content: "pew pew pew at #{new Date()}"

github.gists.create gist, (err, result) ->
  console.log "err: ", err if err?
  console.log "result: ", result
  


