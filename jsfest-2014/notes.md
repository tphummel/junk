# jsfest 2014 notes

## saturday

### webrtc conf @ joyent

webrtc (web real time communication) allows browsers to communicate directly without a server in between. early applications have been for video/audio communication. but more web-rtc "data channels" exposes the underlying data stream and can transmit anything. the protocol itself is p2p, does not do multicasting. services like google hangouts, assemble the individual streams and send a single unified stream down to each client. 

led by @adambrault (&yet) and @feross. @feross created [peercdn][0] (which will attempt to serve static assets from other people viewing your site over webrtc and fall back to traditional static file serving if unable) and sold it to yahoo in december 2013. His current project is [web torrent][1] - a standard browser-based bittorrent client that aims to eventually be an inroad for bittorrent filesharing over webrtc. 

web-rtc is generally supported by current versions of chrome, firefox, and opera. [iswebrtcreadyyet.com][2]

major issue is discovery between clients or "signalling". still generally requires a trusted server between clients in current architectures to connect clients initially. then removes itself once connection completed. clients need to exchange information about which video codecs they support and other information. 

@feross speculated that eventually central servers should be unnecessary to connect clients. Once a client is bootstrapped with one single client connection, it can ask for introductions to other clients until it finds the client it wants. And stores references to other clients and in turn provides that info to other clients looking for introductions. concept of "Distributed Hash Tables" maintain a record of client locations, or torrents, or other info specific to the application across clients instead of a central server. Relies on long-lived clients to keep this information available and healthy. 

NAT traversal is a non-trivial problem as well. most clients connect to the internet via a router which assigns the device a private ip address and brokers traffic to and from the underlying devices. but for webrtc communication between clients you need the public ip and port of each client. that gets complicated with routers in between. 

in most cases this can be mitigated using a STUN service (lightweight ip discovery). my understanding is that clients can ping a STUN server to learn its public ip and use that in webrtc connection init. [public STUN servers][3]

a further edge case exists for about ~8% of clients where STUN server isn't enough and a heavier service (TURN) is required to figure out the info required to connect.

[talky.io][5] is a good example of webrtc in action

### reject.js @ joyent - talks that wouldn't fit for space during sunday and monday's programs

[schedule][4]

---

"Object Oriented JS" - Hadiyah Mujhid (@DiyahM)

basic intro to OOP and using prototypes in JS

---

"The Model ORM" - Matthew Eernisse (@mde)

"ORM's: the vietnam war of computer science". [Model][6] is the ORM in the [Geddy web framework][7]. Can be used with or without Geddy. ORM's in other platforms are very mature (such as ActiveRecord). Node's ORM's are still relatively young. ORM's originally were designed to let you model your domain using an OO approach and then map those classes to a relational model. Nowadays it also sits atop object databases such as Mongo. The ORM also handles relationships between different classes/entities (hasOne, hasMany, belongsToMany... ). Idea being your application interacts with the ORM and hides away the implementation/api of the underlying DB (ex: your app should not be creating SQL statements). The ORM also gives you data santization and data field validation (should be an email address, should be > 8 chars). Also allows for "seamlessly" swapping DB vendors without impacting the application itself. 

This ORM struck me as having similar issues as other ORMs. It is a very hard problem to allow a single interface for both object DBs and relational DBs. Complications increase with the complexity of the data model. How do you handle accessing related data. Eager or lazy? Will seemingly harmless property accessors kick off massive data queries in the background? How do you allow access to the underlying data libraries for complex queries not supported by the ORM? 

The main reason ORM's are attractive to me is to be able to swap in a in-memory db for testing that gets blown away immediately while still using persistent dbs in other environments. 

I think the takeaway is: don't build your own ORM. Evaluate the existing ones for your platform and use one if the application's data model is simple enough. Simple data models for general CRUD apps are a good fit for ORMs. More complicated than that and you probably want to evaluate a more customized approach. One tailored to the strengths and weaknesses of the particular DB vendor you're using. 

---

"The Path of the NodeBases Jedi" - Bryce Baril (@brycebaril)

Nodebases goal: do for databases what npm did for web applications. Small composable pieces of functionality.

intro to nodebases, API (get, put, batch). commonly used packages.

The Dark Side of Nodebases: 
- Incomplete experiments
- Competing efforts
- Land grabs
- Overpromising
- Combinatorial compatibility issues as you combine more and more modules
- Missing a solid Replication story (for those building at that scale)

Help us realize the potential: 
- Use it, try it, push the limits, but favor science over mad science.
- Label project status, point to similar projects, use the modules you write.

--- 

"Scaling games using zones" - Jorge Zaccaro (@jorgezaccaro)

[https://github.com/jorgezaccaro/zonegrid](zonegrid)

scaling massive online game worlds horizontally across multiple websocket servers. handing off clients from one zone to another gracefully. handling visibility across zone borders. 

--- 

"CSS Modules" - Kristofer Joseph (@kristoferjoseph). works at Adobe, deals with large projects with tons of css and separate teams each writing their own style files that have to coexist. 

[resin][8] - css preprocessor that gives you variables, imports, namespacing/prefixing with vanilla css

[resinate][9] - browserify-like cli for bundling css files

somebody asked why he didn't talk about sass or less during his talk and he said nested css is evil. and especially evil if it has more than one level of nesting. I'm not sure 

not sure exactly how this fits with our approach to stylesheets in nebraska-web, but it sounds like an interesting approach that a lot of thought has gone into

--- 

"Productivity Up" - Thorsten Lorenz (@thlorenz)

use VIM. pimp your editor. snippets. focus on things that make you more productive. fast iteration loops. fast feedback. jshint plugins to quickly find syntax errors without a browser roundtrip. limit build steps. he had a snippet that dumped out an entire util.inherits+events.EventEmitter template. 

---

"The reactive programming revolution" - Rich Harris (@Rich-Harris)

ractive.js

## Sunday - Evolution of Experience

Taking over the NES with JavaScript - Michael Matuzak (@mmatuzak)

Mike's (from js.la) fun talk about using node to generate 6502 assembler code to run on an NES. [nesly][10], and [nesly-split][11] [nesly-sprite][12]. 


---

Pixel Art On The Wall - Vince Allen (@vinceallenvince)

really great presentation. huge visualizations and audio. using css box shadows to create pixel art. Anton, Vince lives in Brooklyn. I bet he frequents brooklyn/nyc area js meetups. 

[thisisnotflash.com][18], [demo][23], [demo][24], [demo][25]

---

Evolution of a Graph - Andrei Kashcha (@anvaka)

[ngraph][13], a collection of graphing algorithms usable with any renderer including pixi.js, fabric.js, gephi, or the terminal.

[rad viz][14] of entire npm network

--- 

Testing for the Browser and the Server - James Halliday (@substack)

generally you want to write software in small modules. each small module contains a pristine, algorithmic core. this core is free of i/o. this core is perfectly testable. and then you wrap this core in an i/o shell if necessary.

"when did using globals in test harnesses become ok"? particulary "bdd" with describe() and it(). 

this idea that "business types" will be able to write tests in some english-like sugary spec language is unlikely. 

use tap. tape is tap but with some comforts that help it play more nicely in the browser. 

try this code coverage browserify transform: [coverify][15]

automatically add travis-ci hooks to new repos: [travisify][16]

automatically add testling-ci hooks to new repos: [testlingify][17]

---

Hyperaudio - Weaving Audio into the Fabric of the Web - Mark Boas

linking video transcript text to mm:ss spots in the video. remixing, sharing. 


---

Elijah Insua - Cut your way to the future

demo'd a travel cnc. working on npm modules to open source tool paths, CAD, CAM - things that have traditionally been available only in expensive commercial software. 

--- 

Raquel Velez - Evolution of a Developer. 

A look at her metamorphosis from advanced robotics in academia to a software intern in 2012, to being approached by Isaac to join NPM inc just recently. Community is what makes node.js so special. That includes conferences, irc, mailing lists, npm, github, blogs. Reach out to the community. Make open source things. Contribute to other peoples' open source things. 

## Monday - Scaling Up and Down

Sheetsee.js - Jessica Lord (@jllord)

jlord/sheetsee.js

sheetsee.js ontop of tabletop.js. power of spreadsheets (google sheets). 

[Fork-n-go][19]: quick one-off websites ontop of googlesheets. 

IFTTT pull data into sheet. Google App Script can push data to github to git-ify it.


---

webrtc intro - Feross Aboukhadijeh (@feross)
revisting webrtc for those not at webrtc camp. reused many of the same slides. 

(I think this replaced "Building Offline First" on short notice)

[localStorage hack][20]

--- 

browse like xerces, god-king of the persians. Mike MacCana (@mikemaccana)

fun with chrome extensions. creative license with history.

---

NPM Up and Down - Isaac Schlueter (@izs)

tradeoffs with package environments. closed vs open. large core vs. large userland. shapes the 

package environment curated or open. curated doesn't scale well. open sets bar for entry low but quality tends to be lower. duplication of modules, need for good indexing, tagging, search is downside to open ecosystem like npm. but solvable. 

talked about how couchdb wound up being the datastore for npm. "mikeal wrote it for me" and couchbase hosted it for free. Great for json meta data. Not good for tarballs. 

"there are two types of databases: 1) those i love. 2) those I hate. Every DB i've ever used goes under DBs I hate."

"We pretty much dropped a month of npm usage data on the floor". re: download counts. 

---

Together.js - Ian Bicking (@ianbicking)

mozilla's site collab plugin. add script to your page and it works. see jsbin. not web-rtc though they tried and couldn't get it to work. websocket server listens to client events, broadcasts to other listeners

--- 

react.js - Christopher Chedeau (@Vjeux)

demo'd how it only updates/renders only the elements of the page that get changed. performance boost in large documents.

i scribbled down "mutation summary" in my notes

---

Let's Build a 3D Engine - Matt Keas (@matthiasak)

He built a 3d rendering engine using vanilla js and svg.

---

core http, the web framework (@raynos)

missed it. [slides][21]

---


Keynote (@ednapirahna)

missed it



  [0]: https://peercdn.com/
  [1]: http://webtorrent.io/
  [2]: http://iswebrtcreadyyet.com/
  [3]: https://gist.github.com/zziuni/3741933
  [4]: https://github.com/Techwraith/jsfest2014-rejectjs
  [5]: https://talky.io/
  [6]: https://github.com/geddy/model
  [7]: http://geddyjs.org/
  [8]: https://github.com/kristoferjoseph/resin
  [9]: https://github.com/kristoferjoseph/resinate
  [10]: https://github.com/emkay/nesly
  [11]: https://github.com/emkay/nesly-split
  [12]: https://github.com/emkay/nesly-sprite
  [13]: https://github.com/anvaka/ngraph
  [14]: http://anvaka.github.io/allnpmviz.an/
  [15]: https://github.com/substack/travisify
  [16]: https://github.com/substack/coverify
  [17]: https://github.com/thlorenz/testlingify
  [18]: http://thisisnotflash.com
  [19]: http://jlord.us/fork-n-go/
  [20]: http://feross.org/fill-disk/
  [21]: http://raynos.github.io/jsfest2014-talk
  [23]: http://www.bitshadowmachine.com/projects/animationblur/
  [24]: http://www.bitshadowmachine.com/projects/redrepeller002/
  [25]: http://www.bitshadowmachine.com/projects/blueagents001/
