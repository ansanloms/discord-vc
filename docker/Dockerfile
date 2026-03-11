FROM docker.io/denoland/deno:2.7.5

WORKDIR /app

COPY deno.json deno.lock ./
RUN deno install

COPY . .

CMD ["deno", "task", "start"]
