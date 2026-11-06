#!/usr/bin/env bash
# Carga webhooks.hocon en el EMQX que corre en Docker. Se puede correr las veces que haga falta: pisa lo anterior.
# Uso: RECEPTOR_URL=http://<server-dashboard>:3000 WEBHOOK_TOKEN=<token> ./configurar.sh [container]
set -euo pipefail
: "${RECEPTOR_URL:?Falta RECEPTOR_URL}" "${WEBHOOK_TOKEN:?Falta WEBHOOK_TOKEN}"
container="${1:-emqx-lab}"

# Solo esas dos variables: el ${.} del body tiene que llegar tal cual a EMQX
envsubst '$RECEPTOR_URL $WEBHOOK_TOKEN' < "$(dirname "$0")/webhooks.hocon" \
  | docker exec -i "$container" sh -c 'cat > /tmp/webhooks.hocon && emqx ctl conf load /tmp/webhooks.hocon; s=$?; rm -f /tmp/webhooks.hocon; exit $s'
