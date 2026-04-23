FROM node:18

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Asia/Shanghai

# 浣跨敤娓呭崕澶у闀滃儚婧?
RUN echo "deb http://mirrors.tuna.tsinghua.edu.cn/debian/ bookworm main contrib non-free" > /etc/apt/sources.list
RUN echo "deb http://mirrors.tuna.tsinghua.edu.cn/debian/ bookworm-updates main contrib non-free" >> /etc/apt/sources.list
RUN echo "deb http://mirrors.tuna.tsinghua.edu.cn/debian-security/ bookworm-security main contrib non-free" >> /etc/apt/sources.list

RUN apt-get update && apt-get install -y \
    reprepro \
    gnupg2 \
    apt-mirror \
    cron \
    curl \
    wget \
    net-tools \
    iputils-ping \
    dnsutils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir -p /app/repos/default/conf /app/uploads /app/mirror-configs /app/mirror-syncs /app/mirror-logs /app/backups

# 璁剧疆鐩綍鏉冮檺
RUN chmod -R 777 /app/mirror-configs /app/mirror-syncs /app/mirror-logs /app/backups

RUN echo "Origin: Kylin Desktop" > /app/repos/default/conf/distributions && \
    echo "Label: Kylin Desktop" >> /app/repos/default/conf/distributions && \
    echo "Codename: focal" >> /app/repos/default/conf/distributions && \
    echo "Architectures: amd64 i386 arm64 loongarch64 source" >> /app/repos/default/conf/distributions && \
    echo "Components: main" >> /app/repos/default/conf/distributions && \
    echo "Description: Kylin Desktop 鍖呯鐞嗕粨搴? >> /app/repos/default/conf/distributions

RUN echo -e "verbose\nbasedir .\n" > /app/repos/default/conf/options

RUN ls -la /app/repos/default/conf/

EXPOSE 3000

ENTRYPOINT ["bash", "-c"]
CMD ["npm start"]