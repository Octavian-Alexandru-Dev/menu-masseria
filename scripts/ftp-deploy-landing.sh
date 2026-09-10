#!/usr/bin/env bash
# Carica landing_page/ su Tophost via FTPS.
#
# Credenziali: se invocato tramite `bws run` (vedi .githooks/pre-push),
# FTP_HOST/FTP_USERNAME/FTP_PASSWORD sono già nell'ambiente. Altrimenti,
# fallback al file .ftp-credentials nella root del repo (mai committato,
# vedi .gitignore).
#
# Un fallimento di rete/FTP non fa fallire questo script: un deploy non
# riuscito non deve mai bloccare `git push`. Rilancia questo script a mano
# quando la rete lo consente per completare il deploy.
set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

if [ -z "${FTP_HOST:-}" ] || [ -z "${FTP_USERNAME:-}" ] || [ -z "${FTP_PASSWORD:-}" ]; then
  CRED_FILE="$REPO_ROOT/.ftp-credentials"
  if [ ! -f "$CRED_FILE" ]; then
    echo "FTP deploy: né Bitwarden Secrets Manager né .ftp-credentials sono disponibili, salto il deploy." >&2
    exit 0
  fi
  # shellcheck disable=SC1090
  source "$CRED_FILE"
fi

cd "$REPO_ROOT/landing_page"

FAILED=0
FIRST=1
for f in *; do
  [ -f "$f" ] || continue
  echo "FTP deploy: carico $f"
  # --connect-timeout: se la porta FTP (21) non è raggiungibile, fallisce in
  # pochi secondi invece di lasciare il TCP SYN ritentare per oltre un minuto.
  # TLS 1.2 forzato: questo ProFTPD (Tophost) interrompe con "426 Transfer aborted"
  # i trasferimenti su TLS 1.3 per file oltre poche decine di KB.
  # -k: il certificato del server FTP è un wildcard condiviso (*.th.seeweb.it),
  # non specifico per questo dominio: è atteso su hosting condiviso.
  if ! curl -sS --connect-timeout 10 --ssl-reqd -k --tlsv1.2 --tls-max 1.2 \
    -T "$f" "ftp://${FTP_HOST}/$f" \
    --user "${FTP_USERNAME}:${FTP_PASSWORD}"; then
    echo "FTP deploy: upload di $f fallito." >&2
    if [ "$FIRST" = "1" ]; then
      echo "FTP deploy: server FTP non raggiungibile, interrompo qui invece di ritentare per ogni file. Il push su git è comunque andato a buon fine: rilancia 'scripts/ftp-deploy-landing.sh' da una rete che raggiunge la porta FTP (21) in uscita per completare la pubblicazione." >&2
      exit 0
    fi
    FAILED=1
  fi
  FIRST=0
done

if [ "$FAILED" = "1" ]; then
  echo "FTP deploy: alcuni file non sono stati caricati. Rilancia 'scripts/ftp-deploy-landing.sh' per ritentare." >&2
  exit 0
fi

echo "FTP deploy: landing_page/ pubblicata su ${FTP_HOST}."
