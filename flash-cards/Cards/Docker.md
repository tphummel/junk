# Docker

- Build an image from a Dockerfile: `docker build -t {{c1::<image-name>}} {{c2::.}}`.
- Run a container in the foreground: `docker run -it --rm {{c1::<image>}} {{c2::<command>}}`.
- Start a container in the background: `docker run -d --name {{c1::<name>}} {{c2::<image>}}`.
- List running containers: `docker {{c1::ps}}`.
- List all containers: `docker ps {{c1::-a}}`.
- Stop a running container: `docker {{c1::stop}} {{c2::<container>}}`.
- Remove a container: `docker {{c1::rm}} {{c2::<container>}}`.
- Remove an image: `docker {{c1::rmi}} {{c2::<image>}}`.
- Show images: `docker {{c1::images}}`.
- Follow logs from a container: `docker logs {{c1::-f}} {{c2::<container>}}`.
- Execute a command in a running container: `docker exec -it {{c1::<container>}} {{c2::<command>}}`.
