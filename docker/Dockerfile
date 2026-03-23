FROM docker.io/denoland/deno:debian-2.7.7

RUN <<EOF
apt-get update
apt-get install -y --no-install-recommends ffmpeg
rm -rf /var/lib/apt/lists/*
EOF

WORKDIR /app

COPY deno.json deno.lock ./
RUN deno install

COPY . .

CMD ["deno", "task", "start"]
