# syntax=docker/dockerfile:1.7
#
# moulinator Jenkins controller — extends the LTS image with:
#   - JCasC + auth plugins (security-bootstrap from config/jenkins.yaml)
#   - Pipeline plugins the Jenkinsfile uses
#   - curl for healthchecks
#
# Security bootstrap happens at first boot via /var/jenkins_home/jenkins.yaml,
# which the configuration-as-code plugin reads. JENKINS_ADMIN_PASSWORD must
# be supplied via env (set in Dokploy secrets).

FROM jenkins/jenkins:2.504.1-lts-jdk21

USER root

RUN apt-get update \
 && apt-get install --no-install-recommends -y curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

USER jenkins

COPY plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt

COPY jenkins.yaml /var/jenkins_home/jenkins.yaml

# Point CasC at our mounted config file.
ENV CASC_JENKINS_CONFIG=/var/jenkins_home/jenkins.yaml \
    JAVA_OPTS="-Djenkins.install.runSetupWizard=false"
