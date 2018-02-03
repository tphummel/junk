var count, getPerf, lines, names, redis, sendPerf, time;

redis = require("redis").createClient();
names = ["Neela", "JD", "Dan", "Tom"];
lines = 0;
time = 0;
count = 1;

getPerf = function() {
  var name, perf;
  name = names[count % 4];
  lines += 1 + Math.floor((Math.random() * 100) % count);
  time += 1 + Math.floor((Math.random() * 100) % count);
  count += 1;
  perf = {
    name: name,
    lines: lines,
    time: time,
    erank: 2,
    wrank: 1
  };
  if (lines > 300) {
    lines = 0;
  }
  if (time > 300) {
    time = 0;
  }
  return perf;
};

module.exports = sendPerf = function() {
  redis.publish("tetris:performances", JSON.stringify(getPerf()));
  return setTimeout(sendPerf, 1500);
};


