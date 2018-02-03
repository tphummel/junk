# Socket-Viz

redis pub-sub, socket.io, d3 scatterplot

[an intro](http://tomhummel.com/2013/10/13/realtime-data-client/)

![scatterplot demo](http://i.imgur.com/TBqnf7j.png "scatterplot demo")

## install
    git clone https://github.com/tphummel/socket-viz.git
    cd socket-viz
    npm install

## demo
    node_modules/.bin/coffee test/helpers/redis-pub-sim.coffee
    CONF=demo bin/dev
    open http://localhost:3000


## TODO

round totals
  - total lines
  - ratio
  - games 
  - wins/ win pct
  - "S" rounds
  - "natural" rounds

best/worst: 
  - high/low
    - lines/time/ratio
      - < 60s, < 120s
