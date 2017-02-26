require 'minitest/spec'

describe_recipe 'sec-base::test' do

  it "installed the build-essential package" do
    package("build-essential").must_be_installed
  end

  it "installed the apt package" do
    package("apt").must_be_installed
  end

  it "installed the git package" do
    package("git").must_be_installed
  end

  it "installed the fail2ban package" do
    package("fail2ban").must_be_installed
  end

  it "installed the ufw package" do
    package("ufw").must_be_installed
  end

 end