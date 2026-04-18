# syntax=docker/dockerfile:1.7
#
# moulinator Epitech runner — thin wrapper over epitechcontent/epitest-docker.
#
# Adds the tools the moulinator harness convention requires on top of the
# upstream Epitech grading image. The upstream image is NOT built by us, so
# we extend rather than replace it.
#
# Hermetic invariant: every tool the harness needs is installed at build time.
# Do NOT add apt-get / pip calls inside harness.sh.
#
# Build:
#   docker buildx build \
#     --platform linux/amd64 \
#     --file docker/runners/epitest.Dockerfile \
#     --tag ghcr.io/your-org/moulinator/runner-epitest:v1 \
#     --push .
# Then `docker buildx imagetools inspect` to pull the sha256 digest.

FROM epitechcontent/epitest-docker:latest

USER root

RUN apt-get update \
 && apt-get install --no-install-recommends -y \
      jq \
 && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

# Re-apply the unprivileged runner user expected by the Jenkinsfile (UID 2000).
# The upstream image may already have a non-root user; we add ours alongside it.
RUN groupadd --system --gid 2000 runner 2>/dev/null || true \
 && useradd  --system --uid 2000 --gid 2000 --home-dir /work --shell /bin/sh runner 2>/dev/null || true \
 && mkdir -p /work \
 && chown -R runner:runner /work

WORKDIR /work
USER runner

ENTRYPOINT ["/bin/sh", "-c"]
CMD ["exit 1 # must be invoked with a harness command"]
