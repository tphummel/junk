test = require("tape"),
path = require("path");

test("canonical harness control test", function(t) {
  t.plan(1);
  t.equal(1+2, 3);
});

require(path.join(__dirname, "./specs/data-build/franchises"));
require(path.join(__dirname, "./specs/data-build/franchise-years/primary"));
require(path.join(__dirname, "./specs/data-build/franchise-years/by-year"));