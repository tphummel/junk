Creating Your Internet Legacy
or
How to Achieve Digital Immortality

slides:
- a problem: I want to keep a website up. forever. for. ever.
- what website? umm. gifs! (html, img, (maybe some css, js?). with a domain.
- great. shared hosting: $1.99 a month. $10 a year for a domain. done. maybe not.
- forever=. 1 year. easy. 5 years. :-/? 100 years??? 500 years???
- the more you think about it, the more your realize it is impossible to predict the future with any certainty
- risks:
  - technology:
    - your hosting company goes out of business
    - your hosting service is deprecated
    - your domain registrar goes out of business
    - your bank goes out of business
    - you run out of money
    - breaking changes to internet document formats, browser compliance/protocols?



- a solution:
- step 1: make the best choices today with the technology options we have, with an eye to: longevity, stability, maturity, costly
- step 1 solution:
  - amazon simple storage service
  - godaddy registrar, dns
  - conservative content html, images, css

- step 2: set up a "self-healing organization" that can withstand any of the risks
  - digital "estate", org structure
  - hierarchical?
    - godfather: buffered layers
  - linear?
    - joker heist: buffer, each helper knows just enough to accomplish their task
  - requirements:
    - balance of power
    - safety against bad actors

  - some hypotheticals:
    - a team of anonymous virtual task workers
    - every 3 months. launch a series of checks with remediations.
      - is our website up? if no:
        - launch a dns check
        - launch registrar check
        - launch a hosting service check
        - launch a bank account health check

      - need secure access to bank account, tech provider accounts

      - general ecosystem checks. mech turk, polls.
        - is our virtual assistant service shutting down?
        - is our hosting provider shutting down?
        - is our hosting service deprecated?
        - is our domain registrar shutting down?
        - is our bank shutting down?
        - is our banking product being deprecated?
      - for each
      - evaluate replacements
      - arrange migration

    - final course correction:
      - is our bank account < 1% of its original balance?
      - make final preparations
        - move to the best completely free option





Problem: I've got a website that I want to exist *forever*

need a funny example. make sure nobody forgets XXXX, ever. shooter gifs.
html, img, css, js

overview:
- problem definition:
  - html+images (optionally css+js, minimal)
  - shootermcgavin.com
- topics of risk: what things will cause a site to go down or be unviewable?
  - economic
    - running out of money
    - your bank shutting down
  - technology
    - companies goes out of business
    - service is discontinued
    - file formats change, browser support changes
- assumptions
  - the united states, the US dollar, us banking system will survive
  - can't predict the future. s3, blogger

- solution:
  - content:
    - "future proof" markup, images, css, js. (conservative)
  - content hosting:
    - Option A: blogger (free)
    - Option B: s3
  - banking:
    - capitalone 360 online checking account
  - domain registrar:
    - godaddy paid with checking account
  - dns:
    - aws route53

- team:
  - risks:
   - abuse, steal $$$
  - org types
    -






constraints:


assumptions:
- checks
- we can't predict the future


SaaS: google sites, google blogger, facebook pages
- pros: cheap, easy, automatic software updates, high stability, very low skill needed for maintenance
- cons: portable-ish

PaaS: heroku, google app engine
- wrong tool for hosting static files.
- exposure to deprecation
- fragility of a running process
- more portable than SaaS, but less than IaaS/static
- forces us to make a bet on a platform: python, node.js, go, ruby, java?

IaaS: amazon web services, rackspace, google compute, azure
- very portable, linux-based stability, ubiquity
- potentially more fragile than PaaS if managing a process
- requires high-skilled maintenance, updates
- most costly, likely overkill

static file hosting services: github, divshot, s3, google cloud storage
- most portable of all. just a filesystem
- no running process to manage. solid state



timeline view
my lifetime, the lifetime of anybody you personally know.

------------------------------->
|s3             |
05    10    15    20    25    30

how likely is it that Amazon Web Services will exist in 2020, 2030, 2040, 2050?
how likely is it that AWS Simple Storage Service will exist in 2020, 30, 40, 50?
how

1980    90    2000    10    20    30    40    50    60    70    80    90    2100    2110    2120    2130
|                                                               |


what can we predict right now? not much
stands to reason in 100 years it will be equally hard to predict the future
so let's say we were to launch a website right now and had to keep it functional for 500 years

assumptions:
- i'm not going to live for 500 years
- nobody i know is going to live for 500 years
-
