# syntax=docker/dockerfile:1.7
#
# moulinator firewall sidecar image.
#
# Provides the toolchain firewall.sh needs:
#   - iptables      (rule management)
#   - socat         (unix-socket accept loop)
#   - jq            (JSON parsing)
#   - docker CLI    (look up bridge interface for a user network)
#
# Docker socket is bind-mounted read-only by the compose file.
# Build context must be the repo root so `scripts/firewall.sh` is reachable.

FROM alpine:3.20

RUN apk add --no-cache \
      iptables \
      ip6tables \
      socat \
      jq \
      docker-cli \
      coreutils \
      bash

COPY scripts/firewall.sh /usr/local/bin/firewall.sh
RUN chmod 0755 /usr/local/bin/firewall.sh

ENTRYPOINT ["/usr/local/bin/firewall.sh"]
