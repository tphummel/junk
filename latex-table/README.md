### installation
  
    npm install latex-table
    
### dependencies
  
Booktabs: the output from this library uses the tags ```\toprule```, ```\midrule```, ```\bottomrule``` which are specific to the Booktabs library. This may or may not have come standard with your LaTeX installation. If not, you can [add it][0]. 

### usage

    latex_table = require "latex-table"

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

### using output

the output text is a latex snippet that can be included within a larger document via an ```\input``` such as

    \documentclass[a4paper,titlepage]{book}
    \usepackage{booktabs}

    \begin{document}
      \maketitle
      \tableofcontents \newpage
      \input{path/to/some/file}
      \input{path/to/another/file}
      \input{path/to/a/latex-table/snippet}
    \end{document}

### TODO

- column alignment on decimal point
- decouple from a particular table package (booktabs, tabular, tabularx, longtable)
- optional vertical rules
  
  [0]: http://www.ctan.org/tex-archive/macros/latex/contrib/booktabs/