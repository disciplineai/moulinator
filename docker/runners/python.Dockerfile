# syntax=docker/dockerfile:1.7
#
# moulinator Python runner — hermetic base image.
#
# Same rules as c.Dockerfile: tools baked in at build time, no package manager
# at runtime, no curl/wget, run as unprivileged user, --read-only friendly.

FROM python:3.12-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    LC_ALL=C.UTF-8 \
    LANG=C.UTF-8 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Build tools kept minimal. If a project needs a wheel at run time, pre-bake it
# here — do NOT pip install in the harness.
RUN apt-get update \
 && apt-get install --no-install-recommends -y \
      build-essential \
      gcc \
      make \
      git \
      jq \
      bats \
      ca-certificates \
      tzdata \
 && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

# Python test stack pinned. pytest-json-report gives the harness a machine-readable
# result file which the pipeline uploads as the junit artifact.
RUN pip install --no-cache-dir \
      pytest==8.3.3 \
      pytest-json-report==1.5.0 \
      pytest-timeout==2.3.1 \
      hypothesis==6.115.3 \
 && apt-get purge -y --auto-remove build-essential gcc make \
 && rm -f /usr/bin/apt* /usr/bin/dpkg \
          /usr/bin/curl /usr/bin/wget \
 && rm -rf /root/.cache /tmp/* /var/tmp/*

RUN groupadd --system --gid 2000 runner \
 && useradd  --system --uid 2000 --gid 2000 --home-dir /work --shell /bin/sh runner \
 && mkdir -p /work \
 && chown -R runner:runner /work

WORKDIR /work
USER runner

ENTRYPOINT ["/bin/sh", "-c"]
CMD ["exit 1 # must be invoked with a harness command"]
