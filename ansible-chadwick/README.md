# ansible-chadwick

Ansible role for building [chadwick](http://chadwick-bureau.com/) [command-line tools](http://chadwick.sourceforge.net/).

## Requirements

`make`

## Platforms

Tested on ubuntu 14.04

## Usage

Clone this repo to your roles directory:

`git clone https://github.com/tphummel/ansible-chadwick.git roles/chadwick`

This role's defaults should make it runnable without overriding any settings. With future chadwick releases (newer than 0.6.3), version settings can be set explicitlly (see `defaults/main.yml`).

## Example Playbook

    - hosts: servers
      roles:
         - chadwick

## License

MIT
