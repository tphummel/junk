require("coffee-script")
require("./lib/server")
if(process.env.NODE_ENV === "development"){
  require("deadreload")
}