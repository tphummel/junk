require "style-bootstrap"
async = require "async"

starsByUser = require "./github-stars.coffee"

navEl = document.querySelector "ul.nav.navbar-nav"

userTemplate = require "./user.jade"

user = (document.location.hash?.split "#")?[1] or "tphummel"
userEl = userTemplate user: user

navEl.innerHTML = userEl

scrollInterval = 5000

repoTemplate = require "./repo.jade"
repoEl = document.querySelector ".container.repo"

starsByUser = starsByUser.bind this, user

displayRepo = (repo, cb) ->
  repoEl.innerHTML = repoTemplate repo
  setTimeout cb, scrollInterval

displayRepos = (repos, cb) ->

  async.eachSeries repos, displayRepo, cb

doRun = (done) ->
  async.waterfall [
    starsByUser
    displayRepos
  ], done

async.forever doRun, (err) -> console.error err
