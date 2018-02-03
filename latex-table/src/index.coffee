{version} = require "../package.json"

objectToTable = (opts) ->
  data = opts.data
  return "can't create latex table, no data" unless data

  title = opts.title
  
  columns = opts.columns
  
  warning = "% auto compiled by latex-table v#{version} at #{new Date}\n\n"
  
  aligns = [] 
  for column in columns
    aligns.push column.align
  
  columnAligns = aligns.join " "
  
  tableType = "tabular"
  
  preamble = "\\begin{table} \n"
  preamble += "\t\\caption{#{title}} \n"
  preamble += "\t\\begin{#{tableType}}{ #{columnAligns} } \\toprule "
  
  for column, i in columns
    # align = if i is 0 then "|c|" else "c|"
    align = "c"
    preamble += "\n\t\t \\multicolumn{1}{#{align}}{\\textbf{#{column.title}}}"
    preamble += " &" unless i is (columns.length - 1)
    
  preamble += "\\\\ \\midrule\n"
  
  body = ""
  for row in data
    for column, j in columns
      body += row[column.property]
      body += if j is (columns.length - 1) then " \\\\\n " else " & "
      
  body += "\\bottomrule\n"
  
  footer = "\\end{#{tableType}}\n \\end{table}"
  
  fullTable = warning + preamble
  fullTable += body + footer
  return fullTable

module.exports = objectToTable