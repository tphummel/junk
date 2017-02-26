(function(){
  var test = require("tape"),
      login = require("../lib/login"),
      jar = require("../lib/jar");

  test("login", function(t){
    t.plan(3);

    loginOpts = {
      user_id: "tphummel",
      password: "testpassword"
    };

    login(loginOpts, function(err, res, body){
      t.notOk(err, "err should be falsy");
      
      t.equal(jar.cookies[0].name, "_web_session", "cookie 1 name");
      t.equal(jar.cookies[1].name, "_csrf_token", "cookie 2 name");
      
      t.end();
    });
  });
})();