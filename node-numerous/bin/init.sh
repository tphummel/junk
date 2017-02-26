#! /bin/sh
if [ -z $1 ]; then
  echo "[err]: enter an app name as first arg"
  exit
fi

git clone https://github.com/tphummel/node-app.git $1 && \

cd ./$1 && rm -rf .git && git init && \
git add . && git commit -m "a start" && \
echo "app $1 ready...";