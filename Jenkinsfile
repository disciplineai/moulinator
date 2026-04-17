// =========================================================================
// moulinator — parameterized Jenkins pipeline
// =========================================================================
// Single pipeline, all projects. The NestJS API builds the parameter bundle
// per TestRun and triggers this job via the Jenkins REST API.
//
// Contract references:
//   docs/ARCHITECTURE.md       — runner flags, firewall table, credential flow
//   docs/webhook-contract.md   — HMAC signing, idempotency, payload shapes
//   docs/run-state-machine.md  — queued → running → {passed,failed,error,…}
//   project-config.schema.yaml — runner_image_digest format, allowlist shape
//
// Invariants enforced here:
//   1. Webhooks always carry X-Moulinator-Signature (sha256=<hex>) + a unique
//      X-Moulinator-Idempotency-Key (UUID v4). Retries reuse the same key.
//   2. Runner containers are launched with --pids-limit / --memory / --cpus /
//      --read-only + tmpfs /work + an explicit per-build network. No docker
//      socket ever mounted into a job container.
//   3. The workspace tarball is downloaded with a pre-signed URL — no
//      credentials. The tests-repo is cloned at a pinned SHA using a deploy
//      key mounted on the agent only (never copied into the job container).
//   4. build_started / heartbeat / build_completed / build_errored are always
//      emitted. `post { always }` guarantees cleanup + terminal event.
//
// Security: NO pipeline parameter is interpolated into a `sh """..."""` Groovy
// string. All params cross into shell ONLY through `withEnv` or env bindings,
// and all shell uses of them are "$VAR" — never `${params.X}`. This blocks
// shell/Groovy injection even against adversarial params.
// =========================================================================

pipeline {

  // Runs on the runner-plane agent labelled `moulinator-runner`.
  agent { label 'moulinator-runner' }

  options {
    disableConcurrentBuilds(abortPrevious: false)
    buildDiscarder(logRotator(numToKeepStr: '200'))
    // Hard pipeline timeout — belt-and-braces beyond the harness wall clock.
    timeout(time: 90, unit: 'MINUTES')
  }

  parameters {
    string(name: 'test_run_id',          defaultValue: '', description: 'ULID of the TestRun row the API created.')
    string(name: 'workspace_url',        defaultValue: '', description: 'Pre-signed MinIO GET URL for the credential-free workspace tarball.')
    string(name: 'tests_repo_url',       defaultValue: '', description: 'Tests-repo SSH clone URL.')
    string(name: 'tests_commit_sha',     defaultValue: '', description: 'Commit SHA in the tests-repo to pin against.')
    string(name: 'runner_image_repo',    defaultValue: '', description: 'Full OCI repo path for the runner image (e.g. ghcr.io/your-org/moulinator/runner-c). Required.')
    string(name: 'runner_image_digest',  defaultValue: '', description: 'sha256:… digest of the runner image to pull. Pulled as <runner_image_repo>@<digest>.')
    string(name: 'project_slug',         defaultValue: '', description: 'Project slug (used for tests_path + logs path).')
    string(name: 'harness_entrypoint',   defaultValue: 'tests/harness.sh', description: 'Harness path relative to <tests-repo>/<slug>/.')
    string(name: 'timeout_seconds',      defaultValue: '600', description: 'Wall-clock limit applied to the harness.')
    string(name: 'memory_mb',            defaultValue: '2048', description: 'Container memory cap (MB).')
    string(name: 'cpus',                 defaultValue: '2', description: 'Container CPU cap (fractional allowed).')
    string(name: 'pids',                 defaultValue: '512', description: 'Container PID cap.')
    booleanParam(name: 'hermetic',       defaultValue: true, description: 'If true, zero egress. Else egress_allowlist_json applies.')
    text(name: 'egress_allowlist_json',  defaultValue: '[]', description: 'JSON array [{host,ports}]. Only consulted when hermetic=false.')
    string(name: 'logs_upload_url',      defaultValue: '', description: 'Pre-signed PUT URL for the full log.')
    string(name: 'junit_upload_url',     defaultValue: '', description: 'Pre-signed PUT URL for junit.xml.')
    string(name: 'webhook_url',          defaultValue: '', description: 'NestJS endpoint: https://api.../webhooks/jenkins')
  }

  environment {
    // Derived constants — not interpolated into shells, only used as Groovy
    // locals or set into env via withEnv so shell access uses "$VAR".
    BUILD_NETWORK   = "${env.RUNNER_NETWORK_PREFIX ?: 'moulinator-run'}-${env.BUILD_NUMBER}"
    BUILD_CONTAINER = "moulinator-job-${env.BUILD_NUMBER}"
    WORKSPACE_DIR   = "${env.WORKSPACE}/build"
    TARBALL_PATH    = "${env.WORKSPACE}/workspace.tar.gz"
    TESTS_CLONE_DIR = "${env.WORKSPACE}/tests-repo"
    OUT_DIR         = "${env.WORKSPACE}/out"
    RESULT_JSON     = "${env.WORKSPACE}/result.json"
    FULL_LOG        = "${env.WORKSPACE}/full.log"
    JUNIT_XML       = "${env.WORKSPACE}/junit.xml"
    // Sidecar socket is exposed on the shared `jenkins_agent_home` volume,
    // mounted at JENKINS_AGENT_WORKDIR inside the agent. See compose file.
    FIREWALL_SOCK   = "${env.JENKINS_AGENT_WORKDIR ?: '/home/jenkins/agent'}/firewall.sock"
  }

  stages {

    // ---------------------------------------------------------------------
    stage('validate params') {
      steps {
        script {
          validateRequiredParams()
        }
      }
    }

    // ---------------------------------------------------------------------
    stage('emit build_started') {
      steps {
        script {
          emitWebhook('build_started', [
            test_run_id:           params.test_run_id,
            jenkins_build_url:     env.BUILD_URL,
            started_at:            isoNow(),
            runner_image_digest:   params.runner_image_digest,
            tests_repo_commit_sha: params.tests_commit_sha
          ])
          startHeartbeat()
        }
      }
    }

    // ---------------------------------------------------------------------
    stage('pull runner image') {
      steps {
        withEnv(["M_IMAGE_REF=${params.runner_image_repo}@${params.runner_image_digest}"]) {
          sh '''
            set -eu
            # M_IMAGE_REF is validated upstream (validateRequiredParams ensures
            # runner_image_digest matches sha256:<64hex>). Quote it on use.
            echo "pulling $M_IMAGE_REF"
            docker pull "$M_IMAGE_REF"
          '''
        }
      }
    }

    // ---------------------------------------------------------------------
    stage('prepare network + firewall') {
      steps {
        withEnv(["M_BUILD_NETWORK=${env.BUILD_NETWORK}"]) {
          // NOTE: a plain user-defined bridge (not --internal) is used so the
          // sidecar's iptables rules can DENY-by-default and ACCEPT the
          // allowlist. --internal would itself drop egress and make allowlist
          // rules unreachable.
          sh '''
            set -eu
            docker network create \
              --driver bridge \
              --opt com.docker.network.bridge.enable_icc=false \
              "$M_BUILD_NETWORK"
          '''
        }
        script {
          // Stage the request body to a file — JsonOutput is safe from injection
          // and the body is delivered to the sidecar byte-for-byte via socat.
          def payload = [
            action:    'apply',
            network:   env.BUILD_NETWORK,
            hermetic:  params.hermetic,
            allowlist: new groovy.json.JsonSlurper().parseText(params.egress_allowlist_json ?: '[]')
          ]
          def payloadText = new groovy.json.JsonOutput().toJson(payload)
          writeFile file: 'firewall-req.json', text: payloadText
          withEnv(["M_SOCK=${env.FIREWALL_SOCK}"]) {
            sh '''
              set -eu
              test -S "$M_SOCK" || { echo "firewall sidecar socket missing at $M_SOCK" >&2; exit 1; }
              # Single request, single line JSON response back. Fail the stage
              # if the sidecar reports an error or returns no ACK.
              resp=$(socat -T 10 - UNIX-CONNECT:"$M_SOCK" < firewall-req.json)
              echo "firewall response: $resp"
              status=$(printf '%s' "$resp" | jq -r '.status // "error"')
              if [ "$status" != "ok" ]; then
                echo "firewall sidecar rejected apply request: $resp" >&2
                exit 1
              fi
            '''
          }
        }
      }
    }

    // ---------------------------------------------------------------------
    stage('fetch workspace') {
      steps {
        withEnv([
          "M_WORKSPACE_URL=${params.workspace_url}",
          "M_WORKSPACE_DIR=${env.WORKSPACE_DIR}",
          "M_TARBALL_PATH=${env.TARBALL_PATH}"
        ]) {
          sh '''
            set -eu
            mkdir -p "$M_WORKSPACE_DIR"
            # Pre-signed URL — no creds on disk.
            curl --fail --silent --show-error --max-time 120 \
                 --output "$M_TARBALL_PATH" \
                 "$M_WORKSPACE_URL"
            tar -xzf "$M_TARBALL_PATH" -C "$M_WORKSPACE_DIR"
          '''
        }
      }
    }

    // ---------------------------------------------------------------------
    stage('clone tests-repo') {
      steps {
        withEnv([
          "M_TESTS_REPO_URL=${params.tests_repo_url}",
          "M_TESTS_COMMIT_SHA=${params.tests_commit_sha}",
          "M_TESTS_CLONE_DIR=${env.TESTS_CLONE_DIR}",
          "M_DEPLOY_KEY=${env.TESTS_REPO_DEPLOY_KEY_PATH ?: ''}",
          "M_KNOWN_HOSTS=${env.TESTS_REPO_KNOWN_HOSTS_PATH ?: ''}"
        ]) {
          sh '''
            set -eu
            # Harden against invalid commit SHA input — validateRequiredParams
            # already enforces a 40-char hex, but keep the invariant local.
            case "$M_TESTS_COMMIT_SHA" in
              ([0-9a-f]*) : ok ;;
              (*) echo "tests_commit_sha must be lowercase hex" >&2; exit 1 ;;
            esac
            rm -rf "$M_TESTS_CLONE_DIR"

            # F10: detect SSH-schemed tests-repo URLs — `git@host:path` or
            # `ssh://...`. These go over SSH and MUST have a pinned known_hosts
            # file regardless of whether a deploy key is supplied. A public
            # SSH tests-repo without a deploy key is still vulnerable to
            # first-connection MITM; refuse TOFU uniformly.
            is_ssh=0
            case "$M_TESTS_REPO_URL" in
              git@*|ssh://*) is_ssh=1 ;;
            esac

            if [ "$is_ssh" = "1" ]; then
              if [ -z "$M_KNOWN_HOSTS" ] || [ ! -r "$M_KNOWN_HOSTS" ]; then
                echo "TESTS_REPO_KNOWN_HOSTS_PATH must point to a readable known_hosts file for SSH tests-repo URLs (got: '$M_KNOWN_HOSTS')" >&2
                exit 1
              fi
              if [ -n "$M_DEPLOY_KEY" ]; then
                export GIT_SSH_COMMAND="ssh -i $M_DEPLOY_KEY -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$M_KNOWN_HOSTS -o IdentitiesOnly=yes"
              else
                export GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$M_KNOWN_HOSTS"
              fi
            fi

            # Reproducibility invariant: the pinned SHA MUST be reachable. We
            # initialize an empty repo and fetch the exact SHA — servers that
            # support uploadpack.allowReachableSHA1InWant (GitHub does) serve it
            # directly; for servers that don't, we fall back to progressive
            # `--deepen` until the commit is present or the server has nothing
            # more to give.
            git init --quiet "$M_TESTS_CLONE_DIR"
            git -C "$M_TESTS_CLONE_DIR" remote add origin "$M_TESTS_REPO_URL"

            if git -C "$M_TESTS_CLONE_DIR" fetch --depth 1 origin "$M_TESTS_COMMIT_SHA" 2>/dev/null; then
              : # server supports fetch-by-sha; perfect — this is the expected path on GitHub.
            else
              # F13: bounded fallback. On GitHub with uploadpack.allowReachableSHA1InWant
              # (the default) the shallow fetch-by-sha above always works, so this
              # branch is near-dead code in normal operation. Cap the deepen at 200
              # and fail loudly rather than slurping the entire repo history —
              # unbounded `--unshallow` is a network + disk DoS waiting to happen
              # on a misconfigured pin. Operators who legitimately need the
              # unshallow fallback (e.g., self-hosted gitea without SHA-in-want)
              # set ALLOW_TESTS_REPO_UNSHALLOW=1 in the runner-plane env.
              git -C "$M_TESTS_CLONE_DIR" fetch --depth 50 origin
              if ! git -C "$M_TESTS_CLONE_DIR" rev-parse --verify "$M_TESTS_COMMIT_SHA^{commit}" >/dev/null 2>&1; then
                git -C "$M_TESTS_CLONE_DIR" fetch --deepen 200 origin || true
              fi
              if ! git -C "$M_TESTS_CLONE_DIR" rev-parse --verify "$M_TESTS_COMMIT_SHA^{commit}" >/dev/null 2>&1; then
                if [ "${ALLOW_TESTS_REPO_UNSHALLOW:-0}" = "1" ]; then
                  echo "tests_commit_sha not in last 200 commits — unshallowing (ALLOW_TESTS_REPO_UNSHALLOW=1)" >&2
                  git -C "$M_TESTS_CLONE_DIR" fetch --unshallow origin || git -C "$M_TESTS_CLONE_DIR" fetch origin
                else
                  echo "tests_commit_sha $M_TESTS_COMMIT_SHA not reachable within depth 200; refusing to unshallow (set ALLOW_TESTS_REPO_UNSHALLOW=1 to opt in)" >&2
                  exit 1
                fi
              fi
            fi

            if ! git -C "$M_TESTS_CLONE_DIR" rev-parse --verify "$M_TESTS_COMMIT_SHA^{commit}" >/dev/null 2>&1; then
              echo "tests_commit_sha $M_TESTS_COMMIT_SHA is not reachable in the remote repo" >&2
              exit 1
            fi

            git -C "$M_TESTS_CLONE_DIR" checkout --detach -- "$M_TESTS_COMMIT_SHA"
            actual=$(git -C "$M_TESTS_CLONE_DIR" rev-parse HEAD)
            if [ "$actual" != "$M_TESTS_COMMIT_SHA" ]; then
              echo "tests-repo pin mismatch: expected $M_TESTS_COMMIT_SHA, got $actual" >&2
              exit 1
            fi
          '''
        }
      }
    }

    // ---------------------------------------------------------------------
    stage('run harness') {
      steps {
        script {
          // Prepare result dir ahead of mount.
          sh 'mkdir -p "$OUT_DIR" && chmod 0777 "$OUT_DIR"'
        }
        // IMPORTANT: docker args are passed as arrayed CLI arguments via env
        // vars, not concatenated into a shell string. This denies shell
        // injection through `project_slug`, `harness_entrypoint`, etc.
        withEnv([
          "M_CONTAINER=${env.BUILD_CONTAINER}",
          "M_NETWORK=${env.BUILD_NETWORK}",
          "M_PIDS=${params.pids}",
          "M_MEM=${params.memory_mb}",
          "M_CPUS=${params.cpus}",
          "M_TIMEOUT=${params.timeout_seconds}",
          "M_IMAGE_REF=${params.runner_image_repo}@${params.runner_image_digest}",
          "M_WORKSPACE_DIR=${env.WORKSPACE_DIR}",
          "M_TESTS_CLONE_DIR=${env.TESTS_CLONE_DIR}",
          "M_OUT_DIR=${env.OUT_DIR}",
          "M_SLUG=${params.project_slug}",
          "M_HARNESS=${params.harness_entrypoint}",
          "M_FULL_LOG=${env.FULL_LOG}"
        ]) {
          // `sh` here is a single-quoted Groovy string — NO interpolation.
          // Every `$VAR` is resolved by the shell at runtime from env.
          // We use `docker run` argv (no shell inside the container beyond the
          // base-image entrypoint, which we invoke with `-c` + a fixed format
          // string that references env vars only — never concatenated with
          // params).
          script {
            def rc = sh(returnStatus: true, script: '''
              set -u
              # Defensive: slug + harness path must not contain control chars.
              case "$M_SLUG" in
                (*[!A-Za-z0-9._-]*) echo "project_slug has illegal chars" >&2; exit 1 ;;
              esac
              case "$M_HARNESS" in
                (*/../*|../*|*/..|..) echo "harness_entrypoint escapes tests-repo" >&2; exit 1 ;;
                (*[!A-Za-z0-9._/-]*)  echo "harness_entrypoint has illegal chars" >&2; exit 1 ;;
              esac

              # Pass slug + harness path as env vars INTO the container, and
              # invoke sh -c with a fixed script that references them — so the
              # image entrypoint sees `$SLUG` / `$HARNESS`, never a literal
              # command string assembled from user input.
              #
              # F12: /work is tmpfs with `nosuid,nodev`. `noexec` is NOT set
              # because C projects compile student code into /work and then
              # exec the resulting binaries; noexec would break that path.
              # nosuid + nodev are safe invariants regardless of language
              # (no setuid binaries, no device files in a scratch workspace).
              docker run --rm \
                --name "$M_CONTAINER" \
                --network "$M_NETWORK" \
                --pids-limit "$M_PIDS" \
                --memory "${M_MEM}m" \
                --memory-swap "${M_MEM}m" \
                --cpus "$M_CPUS" \
                --read-only \
                --tmpfs "/work:rw,size=${M_MEM}m,mode=1777,nosuid,nodev" \
                --cap-drop ALL \
                --security-opt no-new-privileges \
                --user 2000:2000 \
                -v "${M_WORKSPACE_DIR}:/work/src:ro" \
                -v "${M_TESTS_CLONE_DIR}:/work/tests:ro" \
                -v "${M_OUT_DIR}:/work/out:rw" \
                -e "MOULINATOR_SLUG=$M_SLUG" \
                -e "MOULINATOR_HARNESS=$M_HARNESS" \
                -e "MOULINATOR_TIMEOUT=$M_TIMEOUT" \
                -e MOULINATOR_RESULT_JSON=/work/out/result.json \
                -e MOULINATOR_JUNIT_XML=/work/out/junit.xml \
                -e MOULINATOR_FULL_LOG=/work/out/full.log \
                "$M_IMAGE_REF" \
                'timeout -s TERM "$MOULINATOR_TIMEOUT" /bin/sh "/work/tests/$MOULINATOR_SLUG/$MOULINATOR_HARNESS"' \
                > "$M_FULL_LOG" 2>&1
            ''')
            env.HARNESS_EXIT = rc.toString()
          }
          sh '''
            set -eu
            if [ -f "$OUT_DIR/result.json" ]; then
              cp "$OUT_DIR/result.json" "$RESULT_JSON"
            fi
            [ -f "$OUT_DIR/junit.xml"   ] && cp "$OUT_DIR/junit.xml" "$JUNIT_XML" || true
          '''
          // A missing/empty result.json is the contract violation: the harness
          // is required to always write result.json, even when all cases fail.
          // Its absence means the runner itself crashed/timed out. Treat that
          // as an infrastructure error so the state machine flips to `error`,
          // not `passed` or `failed`.
          script {
            def resultExists = sh(returnStatus: true, script: '[ -s "$RESULT_JSON" ]') == 0
            if (!resultExists) {
              error("harness exited (rc=${env.HARNESS_EXIT}) without writing result.json — treating as build_errored")
            }
          }
        }
      }
    }

    // ---------------------------------------------------------------------
    stage('upload artifacts') {
      steps {
        withEnv([
          "M_LOGS_URL=${params.logs_upload_url}",
          "M_JUNIT_URL=${params.junit_upload_url}"
        ]) {
          sh '''
            set -eu
            if [ -n "$M_LOGS_URL" ] && [ -f "$FULL_LOG" ]; then
              curl --fail --silent --show-error --max-time 300 -T "$FULL_LOG" "$M_LOGS_URL"
            fi
            if [ -n "$M_JUNIT_URL" ] && [ -f "$JUNIT_XML" ]; then
              curl --fail --silent --show-error --max-time 120 -T "$JUNIT_XML" "$M_JUNIT_URL"
            fi
          '''
        }
      }
    }

    // ---------------------------------------------------------------------
    stage('emit build_completed') {
      steps {
        script {
          stopHeartbeat()
          def resultText = sh(returnStdout: true, script: 'cat "$RESULT_JSON"').trim()
          def result = new groovy.json.JsonSlurper().parseText(resultText)
          def cases = (result.cases instanceof List) ? result.cases : []
          def artifacts = [
            [ kind: 'logs',  s3_key: "logs/${params.test_run_id}/full.log", size_bytes: fileSize(env.FULL_LOG) ]
          ]
          if (sh(returnStatus: true, script: '[ -s "$JUNIT_XML" ]') == 0) {
            artifacts << [ kind: 'junit', s3_key: "junit/${params.test_run_id}/junit.xml", size_bytes: fileSize(env.JUNIT_XML) ]
          }
          emitWebhook('build_completed', [
            test_run_id: params.test_run_id,
            finished_at: isoNow(),
            cases:       cases,
            artifacts:   artifacts
          ])
        }
      }
    }
  }

  // =======================================================================
  // Post — always runs. Guarantees we emit a terminal event and clean up.
  // =======================================================================
  post {
    failure {
      script {
        stopHeartbeat()
        emitWebhook('build_errored', [
          test_run_id: params.test_run_id,
          finished_at: isoNow(),
          error:       'pipeline_failure',
          detail:      "stage failed in build ${env.BUILD_NUMBER}"
        ])
      }
    }
    aborted {
      script {
        stopHeartbeat()
        emitWebhook('build_errored', [
          test_run_id: params.test_run_id,
          finished_at: isoNow(),
          error:       'pipeline_aborted',
          detail:      "build ${env.BUILD_NUMBER} was aborted"
        ])
      }
    }
    always {
      script {
        stopHeartbeat()
      }
      withEnv([
        "M_SOCK=${env.FIREWALL_SOCK}",
        "M_BUILD_NETWORK=${env.BUILD_NETWORK}",
        "M_BUILD_CONTAINER=${env.BUILD_CONTAINER}"
      ]) {
        sh '''
          set +e
          if [ -S "$M_SOCK" ]; then
            printf '{"action":"cleanup","network":"%s"}\n' "$M_BUILD_NETWORK" | socat - UNIX-CONNECT:"$M_SOCK" || true
          fi
          docker rm -f "$M_BUILD_CONTAINER" 2>/dev/null || true
          docker network rm "$M_BUILD_NETWORK" 2>/dev/null || true
          # Wipe everything in the agent workspace for this build — not just
          # the known subdirs. `workspaceDir`/tarball/tests-clone/out-dir +
          # top-level result.json, full.log, junit.xml, webhook-*.json, pid
          # files. Leaving these accumulates data from prior builds.
          rm -rf "$WORKSPACE_DIR" "$TARBALL_PATH" "$TESTS_CLONE_DIR" "$OUT_DIR" \
                 "$RESULT_JSON" "$FULL_LOG" "$JUNIT_XML" \
                 "$WORKSPACE"/webhook-*.json "$WORKSPACE"/firewall-req.json \
                 "$WORKSPACE"/heartbeat.pid "$WORKSPACE"/heartbeat.sh
          set -e
        '''
      }
    }
  }
}

// =========================================================================
// Helpers
// =========================================================================

// Defence in depth — all of these are also validated on the NestJS side
// before the job is triggered. Keeping the checks here means a compromised
// or mis-configured API cannot weaponise the pipeline.
def validateRequiredParams() {
  def required = ['test_run_id', 'workspace_url', 'tests_repo_url',
                  'tests_commit_sha', 'runner_image_repo', 'runner_image_digest', 'webhook_url']
  required.each { name ->
    if (!params[name]) { error("missing required parameter: ${name}") }
  }
  // F9: reject the placeholder digest fixtures ship with. If this digest
  // reaches the pipeline it means CI hasn't yet built + pushed the runner
  // image and updated the fixture. Fail loudly rather than attempting a
  // `docker pull` of a non-existent image. Same machine code as backend-core's
  // corresponding guard in runs.orchestrator.ts: runner_image_digest_placeholder.
  if (params.runner_image_digest ==~ /^sha256:0{64}$/) {
    error("runner_image_digest_placeholder: runner image not yet published by CI (placeholder digest ${params.runner_image_digest})")
  }
  if (!(params.runner_image_digest ==~ /^sha256:[a-f0-9]{64}$/)) {
    error("runner_image_digest must be sha256:<64 hex>")
  }
  // OCI repo path — registry/path segments, no tags, no digest.
  if (!(params.runner_image_repo ==~ /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?(:[0-9]+)?(\/[a-z0-9]([a-z0-9._-]*[a-z0-9])?)+$/)) {
    error("runner_image_repo must be a valid OCI repo path without a tag or digest")
  }
  // ULID-ish: Crockford base32 uppercase, 26 chars.
  if (!(params.test_run_id ==~ /^[0-9A-HJKMNP-TV-Z]{26}$/)) {
    error("test_run_id must be a 26-char ULID")
  }
  // Git commit SHA — 40 lowercase hex.
  if (!(params.tests_commit_sha ==~ /^[0-9a-f]{40}$/)) {
    error("tests_commit_sha must be 40 hex chars")
  }
  // Slug — kebab-case, matches project-config.schema.yaml.
  if (!(params.project_slug ==~ /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)) {
    error("project_slug must be kebab-case")
  }
  // Harness path — no traversal, restricted charset.
  if (!(params.harness_entrypoint ==~ /^[A-Za-z0-9._\/-]+\.sh$/) || params.harness_entrypoint.contains('..')) {
    error("harness_entrypoint must be a safe .sh path without traversal")
  }
  // Webhook + workspace URLs must be HTTPS in production. HTTP is permitted
  // ONLY for localhost/127.0.0.1 (local dev against `docker compose up`).
  // Every other plaintext URL is refused.
  def urlAcceptable = { String v ->
    if (!v) return true
    if (v ==~ /^https:\/\/[^\s"']+$/) return true
    if (v ==~ /^http:\/\/(localhost|127\.0\.0\.1|jenkins-controller|api|minio|host\.docker\.internal)(:[0-9]+)?(\/[^\s"']*)?$/) return true
    return false
  }
  ['webhook_url', 'workspace_url', 'logs_upload_url', 'junit_upload_url'].each { k ->
    if (!urlAcceptable(params[k])) {
      error("${k} must be https:// (or http:// only on localhost/compose hostnames)")
    }
  }
  // Tests-repo URL — git@host:path.git or https://host/path.git.
  def tru = params.tests_repo_url
  if (!(tru ==~ /^(git@[A-Za-z0-9._-]+:[A-Za-z0-9._\/-]+\.git|https?:\/\/[^\s"']+)$/)) {
    error("tests_repo_url has invalid shape")
  }
  // Numeric knobs with sane upper/lower bounds — matches the ranges in
  // project-config.schema.yaml and protects the runner host from a
  // malicious/misconfigured project requesting absurd values.
  def intParam = { String k, int min, int max ->
    if (!(params[k] ==~ /^[0-9]+$/)) { error("${k} must be an integer") }
    def v = params[k] as Integer
    if (v < min || v > max) { error("${k}=${v} out of range [${min}, ${max}]") }
  }
  intParam('timeout_seconds', 30, 3600)
  intParam('memory_mb',       64, 8192)
  intParam('pids',            32, 4096)
  if (!(params.cpus ==~ /^[0-9]+(\.[0-9]+)?$/)) {
    error("cpus must be numeric")
  }
  def cpusValue = params.cpus as BigDecimal
  if (cpusValue < 0.25 || cpusValue > 8) {
    error("cpus=${cpusValue} out of range [0.25, 8]")
  }
  // Allowlist JSON — reject anything non-array.
  try {
    def parsed = new groovy.json.JsonSlurper().parseText(params.egress_allowlist_json ?: '[]')
    if (!(parsed instanceof List)) { error('egress_allowlist_json must be a JSON array') }
  } catch (ignored) {
    error('egress_allowlist_json is not valid JSON')
  }
}

// Emit a signed webhook. Passes every value into the shell via env so that
// Groovy string interpolation never touches shell boundaries.
def emitWebhook(String event, Map payload) {
  def body = groovy.json.JsonOutput.toJson(payload)
  def idempotencyKey = java.util.UUID.randomUUID().toString()
  def bodyFile = "webhook-${event}-${idempotencyKey}.json"
  writeFile file: bodyFile, text: body
  withCredentials([string(credentialsId: 'jenkins-webhook-secret', variable: 'M_SECRET')]) {
    withEnv([
      "M_EVENT=${event}",
      "M_KEY=${idempotencyKey}",
      "M_BODY_FILE=${bodyFile}",
      "M_URL=${params.webhook_url}"
    ]) {
      sh '''
        set -eu
        sig=$(openssl dgst -sha256 -hmac "$M_SECRET" -hex < "$M_BODY_FILE" | awk '{print $NF}')
        final_status=000
        delivered=0
        for attempt in 1 2 3 4 5 6; do
          status=$(curl --silent --show-error --max-time 15 \
            --output /dev/stderr --write-out '%{http_code}' \
            -X POST "$M_URL" \
            -H "Content-Type: application/json" \
            -H "X-Moulinator-Signature: sha256=$sig" \
            -H "X-Moulinator-Idempotency-Key: $M_KEY" \
            -H "X-Moulinator-Event: $M_EVENT" \
            --data-binary @"$M_BODY_FILE") || status=000
          final_status="$status"
          case "$status" in
            200|202|409|410)
              # 2xx = accepted; 409 = duplicate (retry reused the same key —
              # that IS success); 410 = terminal on server. Stop retrying.
              delivered=1
              break
              ;;
            401|404|422)
              # 401/404 = misconfig; 422 = payload rejected. All are terminal
              # failures and the control plane did NOT register this event.
              # Fail the build rather than lie.
              echo "webhook $M_EVENT hard-rejected with $status" >&2
              exit 1
              ;;
            *)
              # 5xx or network error: backoff and retry with same idempotency key.
              sleep $((2 ** attempt))
              ;;
          esac
        done
        echo "webhook $M_EVENT final status $final_status"
        if [ "$delivered" -ne 1 ]; then
          echo "webhook $M_EVENT failed to deliver after 6 attempts (last status $final_status)" >&2
          exit 1
        fi
      '''
    }
  }
}

// Background heartbeat — emitted every HEARTBEAT_INTERVAL_SECONDS. Implemented
// as a backgrounded shell loop so it's tolerant of Groovy scope teardown.
def startHeartbeat() {
  def interval = env.HEARTBEAT_INTERVAL_SECONDS ?: '30'
  withCredentials([string(credentialsId: 'jenkins-webhook-secret', variable: 'M_SECRET')]) {
    withEnv([
      "M_INTERVAL=${interval}",
      "M_TEST_RUN_ID=${params.test_run_id}",
      "M_URL=${params.webhook_url}"
    ]) {
      sh '''
        set -u
        # Heartbeat script uses only env vars — NO params are interpolated.
        cat > "$WORKSPACE/heartbeat.sh" <<'HB'
#!/bin/sh
set -u
while :; do
  sleep "$M_INTERVAL"
  uuid=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || python3 -c 'import uuid;print(uuid.uuid4())')
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  body=$(printf '{"test_run_id":"%s","heartbeat_at":"%s","stage":"running_tests"}' "$M_TEST_RUN_ID" "$ts")
  sig=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$M_SECRET" -hex | awk '{print $NF}')
  curl --silent --max-time 10 -X POST "$M_URL" \
    -H "Content-Type: application/json" \
    -H "X-Moulinator-Signature: sha256=$sig" \
    -H "X-Moulinator-Idempotency-Key: $uuid" \
    -H "X-Moulinator-Event: heartbeat" \
    --data-binary "$body" || true
done
HB
        chmod +x "$WORKSPACE/heartbeat.sh"
        M_SECRET="$M_SECRET" M_TEST_RUN_ID="$M_TEST_RUN_ID" M_URL="$M_URL" M_INTERVAL="$M_INTERVAL" \
          nohup "$WORKSPACE/heartbeat.sh" >/dev/null 2>&1 &
        echo $! > "$WORKSPACE/heartbeat.pid"
      '''
    }
  }
}

def stopHeartbeat() {
  sh '''
    set +e
    if [ -f "$WORKSPACE/heartbeat.pid" ]; then
      kill "$(cat "$WORKSPACE/heartbeat.pid")" 2>/dev/null || true
      rm -f "$WORKSPACE/heartbeat.pid" "$WORKSPACE/heartbeat.sh"
    fi
    set -e
  '''
}

def isoNow() {
  return new Date().format("yyyy-MM-dd'T'HH:mm:ss'Z'", TimeZone.getTimeZone('UTC'))
}

// fileSize must run on the AGENT (that's where the file is) rather than the
// Jenkins controller's JVM, which is where groovy `new File(…)` would resolve.
// Uses env passing (no Groovy interpolation into shell) so file-size paths
// can never smuggle shell metacharacters.
def fileSize(String path) {
  def out
  withEnv(["M_FILE=${path}"]) {
    def rc = sh(returnStatus: true, script: '[ -f "$M_FILE" ]')
    if (rc != 0) return 0L
    out = sh(returnStdout: true, script: 'wc -c < "$M_FILE" | tr -d " \n"').trim()
  }
  return out.isLong() ? (out as Long) : 0L
}
