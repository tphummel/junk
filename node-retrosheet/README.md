# node-retrosheet

library to decode [retrosheet][0] data files

### chadwick setup instructions (osx 10.6.8 snow leopard)

#### autoconf (optional)

version 2.6.1 of autoconf came with my version of xcode. chadwick told me it required >= autoconf 2.6.2. download latest [tarball][2] (v2.6.9 currently)

    cd autoconf/dir/ && ./configure && make && sudo make install
    sudo cp autoconf /usr/bin/
  
#### download latest chadwick [tarball][1] (v0.6.0 currently)

extract the tarball. cd into it. 
  
    ./configure
    make 
    sudo make install
    
now the cwevent binary should be available globally 

    which cwevent

### compiling event files with chadwick

run toCSV file

which converts each event file into a csv file. 

download an events.zip archive. i put mine in the data/raw directory. extract. expand with:

    cwevent -n -f 0-96 -x 0-62 -i OAK201210030 2012OAK.EVA > out.csv

### TODO
* iterate over all event files create events*.csv files
  * use chadwick/cwevent
* iterate over all roster files. create roster*.csv files
* process 'team' file
* use chadwick/cwgame
* use chadwick/cwsub
* does cwbox still exist?


  [0]: http://www.retrosheet.org
  [1]: http://chadwick.sourceforge.net/
  [2]: http://ftp.gnu.org/gnu/autoconf/