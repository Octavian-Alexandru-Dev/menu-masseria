#!/usr/bin/env bash
# Rigenera seed-data/ (il menù demo + gli account admin/waiter/kitchen già
# pronti, importati automaticamente dentro l'immagine Docker degli
# emulatori — vedi Dockerfile.emulator) dopo aver cambiato la forma del
# menù demo in scripts/seed-emulator.js o i dati di test.
#
# Uso: npm run seed:export (poi ricorda di ricostruire l'immagine:
# npm run emulators:up -- --build, o docker compose ... build).
set -euo pipefail
cd "$(dirname "$0")/.."

CONTAINER=masseria-menu-firebase-emulators-1

npm run emulators:up
npm run seed:emulator

docker exec "$CONTAINER" firebase emulators:export /app/seed-data --project demo-masseria-test --force
rm -rf seed-data
docker cp "$CONTAINER:/app/seed-data" ./seed-data

npm run emulators:down
echo "seed-data/ rigenerato. Ricostruisci l'immagine perché il cambiamento abbia effetto:"
echo "  docker compose -f docker-compose.emulator.yml build"
