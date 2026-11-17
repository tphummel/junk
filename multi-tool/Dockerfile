FROM arm64v8/debian:bullseye-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    apt-transport-https \
    ca-certificates \
    curl \
    tar \
    gnupg2 \
    software-properties-common \
    wget \
    jq \
    unzip \
    vim \
    less \
    python3 \
    python3-pip \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | apt-key add - \
  && echo "deb https://apt.kubernetes.io/ kubernetes-xenial main" | tee -a /etc/apt/sources.list.d/kubernetes.list \
  && wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | apt-key add - \
  && echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/6.0 multiverse" | tee /etc/apt/sources.list.d/mongodb-org-6.0.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    postgresql-client \
    redis-tools \
    lynis \
    kubectl \
    mongodb-mongosh \
    bats \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install \
    && curl -sLO "https://github.com/weaveworks/eksctl/releases/latest/download/eksctl_Linux_arm64.tar.gz" \
    && tar -xzf eksctl_Linux_arm64.tar.gz -C /tmp && rm eksctl_Linux_arm64.tar.gz \
    && mv /tmp/eksctl /usr/local/bin

COPY kits/ /kits/

CMD ["bash"]
