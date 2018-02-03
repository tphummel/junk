latex_table = require "../src/"

columns = [
  {title: "ID#", property: "id", align: "l"}
  {title: "Name", property: "name", align: "l"}
  {title: "Amount", property: "amount", align: "r"}
]

data = [
  {id: 1, name: "Tom", amount: 100}
  {id: 2, name: "Joe", amount: 250}
  {id: 3, name: "Harry", amount: 75}
]

output = latex_table
  columns: columns
  data: data
  title: "My Table Caption"

console.log "output: ", output