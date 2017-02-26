# node.js base app

    git clone https://github.com/tphummel/node-app.git new-app-dir
    cd !$
    rm -rf .git
    git init
    git add . -am "inital commit"
    git remote add ...
    git push -u origin master


# {{app}}

[![Build Status](https://travis-ci.org/{{author}}/{{app}}.png)](https://travis-ci.org/{{author}}/{{app}})
[![NPM](https://nodei.co/npm/{{app}}.png?downloads=true)](https://nodei.co/npm/{{app}}/)

# install

    npm install {{app}}

# test

    npm test

# usage

    var app = require("{{app}}");

    app();


# auth

nmrs_ExEXSxC0krYz:
echo -n 'nmrs_ExEXSxC0krYz:' | base64

# get my metrics

curl --include --header "Authorization: Basic bm1yc19FeEVYU3hDMGtyWXo6" https://api.numerousapp.com/v1/users/me/metrics

# create new metric

curl --include \
--header "Authorization: Basic bm1yc19FeEVYU3hDMGtyWXo6" \
     --request POST \
     --header "Content-Type: application/json" \
     --data-binary "{
    \"label\": \"Tetris Lines\",
    \"description\": \"global number of tetris lines scored\",
    \"currencySymbol\":\"\",
    \"kind\": \"number\",
    \"photoId\":\"7\"
    \"value\": 0,
    \"units\": \"Lines\",
    \"private\": false,
    \"writeable\": false}"  https://api.numerousapp.com/v1/metrics

# create new metric event

curl --include \
--header "Authorization: Basic bm1yc19FeEVYU3hDMGtyWXo6" \
     --request POST \
     --header "Content-Type: application/json" \
     --data-binary "{
     \"action\":\"ADD\",
    \"value\": 1
}" \
https://api.numerousapp.com/v1/metrics/3046428180069353739/events


# create

  curl --include \
  --header "Authorization: Basic bm1yc19FeEVYU3hDMGtyWXo6" \
       --request POST \
       --header "Content-Type: application/json" \
       --data-binary "{
      \"label\": \"Account balance\",
      \"description\": \"Current balance of our checking account\",
      \"kind\": \"currency\",
      \"currencySymbol\": \"$\",
      \"value\": 3745.41,
      \"units\": \"Dollars\",
      \"photoId\": \"7\",
      \"private\": true
      \"writeable\": false\
  }" \
  https://api.numerousapp.com/v1/metrics

curl --include \
--header "Authorization: Basic bm1yc19FeEVYU3hDMGtyWXo6" \
     --request POST \
     --header "Content-Type: application/json" \
     --data-binary "{
    \"value\": 1
}" \
https://numerous.apiary-mock.com/v1/metrics/5492699301212367342/events


,
    \"action\": \"ADD\"
