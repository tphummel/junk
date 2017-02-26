# retro-level

building a leveldb with retrosheet, lahman, and other data sources

# install

    git clone [repo]
    cd [repo]
    git clone https://github.com/chadwickbureau/retrosheet.git data/
    wget http://seanlahman.com/files/database/lahman-csv_2013-12-10.zip lahman/
    npm i
    node index.js 

# data

### archives
git@github.com:chadwickbureau/retrosheet.git
git@github.com:chadwickbureau/baseballdatabank

### in season
http://sourceforge.net/projects/baseballonastic/

# tools
git@github.com:chadwickbureau/chadwick.git

# setup
cd 
cwevent -n -y 2012 -i OAK201210030 -f 0-96 -x 0-62 2012OAK.EVA

# API

### resources

players
managers
coaches
umpires
transactions

ballparks
franchises

leagues

games (schedule)
seasons

tm_pit_gm
tm_bat_gm

tm_bat_yr
tm_pit_yr

pl_pit_gm
pl_bat_gm

pl_bat_yr
pl_pit_yr

award_winners