# syntax=docker/dockerfile:1.7
#
# moulinator Jenkins agent — extends jenkins/inbound-agent with the CLIs the
# Jenkinsfile calls directly on the agent: docker (CE CLI only), curl, git,
# socat, openssl, jq, ca-certificates.
#
# The stock inbound-agent is a pure remoting agent. We need a toolbox-agent.

FROM jenkins/inbound-agent:3327.v868139a_d00e0-5

USER root

# docker.io provides the `docker` CLI; we do NOT install dockerd because the
# socket is bind-mounted from the host.
RUN apt-get update \
 && apt-get install --no-install-recommends -y \
      ca-certificates \
      curl \
      git \
      jq \
      openssl \
      socat \
      docker.io \
 && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

USER jenkins
