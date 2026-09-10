#!/usr/bin/env bash
# Genera .env dai secret di Bitwarden Secrets Manager (progetto
# "Menu-masseria"), per lo sviluppo locale.
#
# Richiede il file .bws-token nella root del repo (mai committato, vedi
# .gitignore) con le variabili BWS_ACCESS_TOKEN, BWS_PROJECT_ID,
# BWS_SERVER_URL, e la CLI `bws` installata (`cargo install bws`).
#
# Se Bitwarden non è disponibile su questa macchina, crea .env a mano
# copiando .env.example (vedi GUIDA.md).
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
TOKEN_FILE="$REPO_ROOT/.bws-token"
ENV_FILE="$REPO_ROOT/.env"

if [ ! -f "$TOKEN_FILE" ]; then
  echo "bws-env: .bws-token non trovato in $REPO_ROOT — nessuna modifica. Crea .env a mano da .env.example." >&2
  exit 0
fi

# shellcheck disable=SC1090
source "$TOKEN_FILE"

bws secret list "$BWS_PROJECT_ID" \
  --access-token "$BWS_ACCESS_TOKEN" --server-url "$BWS_SERVER_URL" \
  -o env > "$ENV_FILE"

echo "bws-env: $ENV_FILE generato da Bitwarden Secrets Manager (progetto Menu-masseria)."
