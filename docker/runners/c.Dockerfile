# syntax=docker/dockerfile:1.7
#
# moulinator C runner — hermetic base image.
#
# Hermetic invariant: every tool the harness needs is installed at build time.
# At run time the container is launched with --read-only + tmpfs workspace and,
# when hermetic=true in the project config, zero network egress. No curl/wget,
# no package manager, no shell history tools.
#
# Built in CI and pushed to the runner registry; referenced by digest in
# ProjectDefinition.runner_image_digest. Tag-based references are forbidden.
#
# Build:
#   docker buildx build \
#     --platform linux/amd64 \
#     --file docker/runners/c.Dockerfile \
#     --tag ghcr.io/your-org/moulinator/runner-c:v1 \
#     --push .
# Then `docker buildx imagetools inspect` to pull the sha256 digest for the fixture.

FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    LC_ALL=C.UTF-8 \
    LANG=C.UTF-8

# Toolchain needed for C-pool style harnesses: gcc, make, valgrind, checkers, busybox.
# bats-core gives the harness a structured way to emit pass/fail per case.
RUN apt-get update \
 && apt-get install --no-install-recommends -y \
      build-essential \
      gcc \
      g++ \
      make \
      libc6-dev \
      valgrind \
      bsdmainutils \
      coreutils \
      findutils \
      diffutils \
      patch \
      git \
      gdb \
      bats \
      jq \
      ca-certificates \
      tzdata \
 && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* \
 && apt-get purge -y --auto-remove \
 && rm -f /usr/bin/apt* /usr/bin/dpkg \
          /usr/bin/curl /usr/bin/wget \
 && rm -rf /root/.cache /tmp/* /var/tmp/*

# Unprivileged user — harness runs here. UID/GID fixed for audit predictability.
RUN groupadd --system --gid 2000 runner \
 && useradd  --system --uid 2000 --gid 2000 --home-dir /work --shell /bin/sh runner \
 && mkdir -p /work \
 && chown -R runner:runner /work

# --read-only at runtime keeps / immutable. /work is tmpfs-mounted at launch.
WORKDIR /work
USER runner

# The harness path is provided by the pipeline as an argument. Default entrypoint
# is /bin/sh so the pipeline can wrap the invocation with `timeout` + arg-forwarding.
ENTRYPOINT ["/bin/sh", "-c"]
CMD ["exit 1 # must be invoked with a harness command"]
