#!/usr/bin/env bash
# Carica landing_page/ su Tophost via FTPS.
# Richiede il file .ftp-credentials nella root del repo (mai committato, vedi .gitignore)
# con le variabili FTP_HOST, FTP_USERNAME, FTP_PASSWORD.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
CRED_FILE="$REPO_ROOT/.ftp-credentials"

if [ ! -f "$CRED_FILE" ]; then
  echo "FTP deploy: file .ftp-credentials non trovato in $REPO_ROOT, salto il deploy." >&2
  exit 0
fi

# shellcheck disable=SC1090
source "$CRED_FILE"

cd "$REPO_ROOT/landing_page"
for f in *; do
  [ -f "$f" ] || continue
  echo "FTP deploy: carico $f"
  # TLS 1.2 forzato: questo ProFTPD (Tophost) interrompe con "426 Transfer aborted"
  # i trasferimenti su TLS 1.3 per file oltre poche decine di KB.
  # -k: il certificato del server FTP è un wildcard condiviso (*.th.seeweb.it),
  # non specifico per questo dominio: è atteso su hosting condiviso.
  curl -sS --ssl-reqd -k --tlsv1.2 --tls-max 1.2 \
    -T "$f" "ftp://${FTP_HOST}/$f" \
    --user "${FTP_USERNAME}:${FTP_PASSWORD}"
done

echo "FTP deploy: landing_page/ pubblicata su ${FTP_HOST}."
