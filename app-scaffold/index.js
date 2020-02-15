'use strict'

var express = require('express')
var session = require('express-session')
var bodyParser = require('body-parser')
var morgan = require('morgan')
var bole = require('bole')

var passwordless = require('passwordless')

process.env.HOST = process.env.HOST || 'localhost'
process.env.PORT = process.env.PORT || '3000'
process.env.NODE_ENV = process.env.NODE_ENV || 'dev'

var app = express()
app.set('view engine', 'pug')
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({extended: false}))

app.use(session({
  secret: 'app-scaffold',
  // https://www.npmjs.com/package/express-session#saveuninitialized
  saveUninitialized: false,
  // https://github.com/expressjs/session#resave
  resave: false,
  cookie: {
    secure: 'auto'
  }
}))

// must come after initializing express-session
app.use(passwordless.sessionSupport())

var requestLogger
var sessionStore
var loginTokenDelivery

if (process.env.NODE_ENV === 'dev') {
  requestLogger = morgan('dev')
  bole.output({
    level: 'debug',
    stream: process.stdout
  })
  sessionStore = require('passwordless-memorystore')
  loginTokenDelivery = require('./app/delivery-stdout')
} else if (process.env.NODE_ENV === 'prod') {
  requestLogger = morgan('common')
  sessionStore = require('passwordless-memorystore')
  loginTokenDelivery = require('./app/delivery-stdout')
}

bole.output(boleConfig)

app.use(requestLogger)
passwordless.init(sessionStore)
passwordless.addDelivery(loginTokenDelivery)

app.get('/', function (req, res) {
  res.render('index', { pageTitle: 'index' })
})

app.get('/login', function (req, res) {
  res.render('login', { pageTitle: 'login' })
})

app.post('/login',
  passwordless.requestToken(function (user, delivery, cb, req) {
    // find existing or create new user
    return cb(null, user)
  }),
  function (req, res) {
    res.render('login-sent', {
      pageTitle: 'login submitted'
    })
  }
)

app.get('/login-return', passwordless.acceptToken({
  successRedirect: '/home'
}), function (req, res) {
  res.render('login-return', {
    pageTitle: 'login submitted'
  })
})

app.get('/logout', passwordless.logout(), function (req, res) {
  res.redirect('/')
})

app.get('/home', passwordless.restricted(), function (req, res) {
  res.render('home', {
    user: req.user
  })
})

app.listen(process.env.PORT, function (err) {
  if (err) {
    console.error(err)
    return process.exit(1)
  }

  console.log(`server listening at: http://${process.env.HOST}:${process.env.PORT}`)
})
