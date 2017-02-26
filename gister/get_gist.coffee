GitHubApi = require "github"

github = new GitHubApi 
  version: "3.0.0"

auth = require "#{__dirname}/config/auth"

github.authenticate
  type: "oauth"
  token: auth.oauth2_token

gist_id = "3971021"

gist = 
  id: gist_id

github.gists.get gist, (err, result) ->
  console.log "err: ", err if err?
  console.log "result: ", result