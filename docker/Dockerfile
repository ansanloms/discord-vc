FROM docker.io/denoland/deno:2.7.5

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY deno.json deno.lock ./
RUN deno install

COPY . .

CMD ["deno", "task", "start"]
