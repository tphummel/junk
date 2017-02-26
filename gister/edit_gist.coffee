GitHubApi = require "github"

github = new GitHubApi 
  version: "3.0.0"

auth = require "#{__dirname}/config/auth"

github.authenticate
  type: "oauth"
  token: auth.oauth2_token

# gist_id = "d3c1897462088d20ad31"
gist_id = "3971021"

gist = 
  id: gist_id
  files: 
    "file3.txt": 
      content: "Some new text EDITED gist contents at #{new Date()}"

console.log "gist: ", gist

github.gists.edit gist, (err, result) ->
  console.log "err: ", err if err?
  console.log "result: ", result