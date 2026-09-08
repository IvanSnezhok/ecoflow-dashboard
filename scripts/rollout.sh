#!/usr/bin/env bash
#
# rollout.sh — зрощення zstd-стиснення raw_data у живій БД Ecoflow Dashboard.
#
# Виконувати НА ХОСТІ (де є docker і контейнер панелі), з кореня репо:
#
#   ./scripts/rollout.sh                # повний роллаут (precheck + migrate + speed)
#   ./scripts/rollout.sh precheck       # тільки перевірка середовища
#   ./scripts/rollout.sh migrate        # checkpoint + backup + backfill + verify + restart
#   ./scripts/rollout.sh speed          # dbSpeedCheck (read-only)
#   ./scripts/rollout.sh final          # --verify --final (випадає raw_data, VACUUM) — ПОСЛІДНО
#   ./scripts/rollout.sh rollback       # відновлює останній backup і перезапускає панель
#
# Опції:
#   --dry-run   показати команди, нічого не виконувати
#   --yes       не питати підтвердження
#
# Еко-змінні:
#   ECOFLOW_CONTAINER   назва контейнера (за замовчуванням ecoflow-dashboard)
#   ECOFLOW_PORT        публічний порт панелі (за замовчуванням 3001)
#   ECOFLOW_DB          шлях до БД ВМІСНІ КОНТЕЙНЕРІ (за замовчуванням /app/server/data/ecoflow.db)
#
# Етапи:
#   1. precheck — docker, контейнер, образ, mount БД, словник, вільне місце
#   2. migrate  — stop → checkpoint → backup → migrate --verify → start → health
#   3. speed    — dbSpeedCheck до/після (read-only)
#   4. final    — stop → migrate --verify --final → start → health   (розокремлює ~29 GiB)
#
# Rollback:  ./scripts/rollout.sh rollback   (останній backup у server/data)
#
set -euo pipefail

CONTAINER="${ECOFLOW_CONTAINER:-ecoflow-dashboard}"
PORT="${ECOFLOW_PORT:-3001}"
DB_IN_CONTAINER="${ECOFLOW_DB:-/app/server/data/ecoflow.db}"
DB_NAME="$(basename "$DB_IN_CONTAINER")"
DB_DIR_IN_CONTAINER="$(dirname "$DB_IN_CONTAINER")"   # каталог БД (там же лежать backup'и)
DATA_DIR_IN_CONTAINER="/app/server/data"              # destination mount-а (з Dockerfile/compose)
MIGRATE_JS="dist/scripts/migrateRawData.js"   # відносно /app/server в образі
SCRIPTS_MOUNT="/opt/rollout-scripts"          # монтуємо scripts/ репо (read-only)
# Корінь репо = каталог, що містить цей скрипт (scripts/..)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_KEEP_NOTE="Старі backup'и НЕ видаляються автоматично (по 30 GiB). Почистити вручну."

DRY_RUN=0
ASSUME_YES=0
STAGE="all"
IMAGE=""
VOL_NAME=""      # джерело для docker -v: ім'я тому або шлях на хості (bind)
MOUNT_TYPE=""    # volume | bind
HOST_DIR=""      # каталог БД на хості (для df/du)
BACKUP_FILE=""

# ---------------------------------------------------------------- logging

log()  { printf '\033[1;32m[rollout]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[rollout]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[rollout:ERROR]\033[0m %s\n' "$*" >&2; exit 1; }

run() {
  # run <cmd...> — виконує; у dry-run лише показує (нічого не запускає)
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run] %s\n' "$*"
    return 0
  fi
  "$@"
}

confirm() {
  local msg="$1"
  if [ "$ASSUME_YES" -eq 1 ] || [ "$DRY_RUN" -eq 1 ]; then
    log "  (confirm) $msg"
    return 0
  fi
  printf '%s [y/N] ' "$msg"
  local ans
  read -r ans || ans=""
  case "$ans" in
    y|Y|yes|YES) return 0 ;;
    *) warn "Скасовано користувачем."; exit 1 ;;
  esac
}

usage() { sed -n '2,24p' "$0"; exit 1; }

# ---------------------------------------------------------------- args

for a in "$@"; do
  case "$a" in
    precheck|migrate|final|speed|rollback|all) STAGE="$a" ;;
    --dry-run) DRY_RUN=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    -h|--help) usage ;;
    *) die "Невідомий аргумент: $a (див. --help)" ;;
  esac
done
[ $# -eq 0 ] && STAGE="all"

# ---------------------------------------------------------------- discovery

# З'ясовуємо image та mount-им'я БД з живого контейнера.
# У dry-run без docker — використовуємо плейсхолдери, щоб показати команди.
discover() {
  if ! command -v docker >/dev/null 2>&1; then
    if [ "$DRY_RUN" -eq 1 ]; then
      IMAGE="${IMAGE:-<image>}"
      VOL_NAME="${VOL_NAME:-<volume>}"
      MOUNT_TYPE="${MOUNT_TYPE:-volume}"
      return 0
    fi
    die "docker не знайдено в PATH"
  fi
  docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER" \
    || die "контейнер '$CONTAINER' не знайдено (docker ps -a)"
  IMAGE=$(docker inspect "$CONTAINER" --format '{{.Config.Image}}') \
    || die "не вдалось дізнатись image контейнера"
  [ -n "$IMAGE" ] || die "порожній image у контейнера '$CONTAINER'"
  # mount, destination РІВНО = /app/server/data (інші mount-и, напр. логи, не підходять).
  # У bind-mount .Name порожній — джерелом для -v служить .Source (шлях на хості).
  local m spec
  m=$(docker inspect "$CONTAINER" --format \
    '{{range .Mounts}}{{.Type}}{{"|"}}{{.Name}}{{"|"}}{{.Source}}{{"|"}}{{.Destination}}{{"\n"}}{{end}}') \
    || die "docker inspect '$CONTAINER' не вдався"
  spec=$(printf '%s\n' "$m" | awk -F'|' -v d="$DATA_DIR_IN_CONTAINER" \
    '$4==d { if ($1=="volume" && $2!="") print "volume|" $2; else print "bind|" $3; exit }')
  [ -n "$spec" ] || die "не знайдено mount на $DATA_DIR_IN_CONTAINER у контейнері '$CONTAINER'"
  MOUNT_TYPE="${spec%%|*}"
  VOL_NAME="${spec#*|}"
  [ -n "$VOL_NAME" ] || die "порожнє джерело mount-а на $DATA_DIR_IN_CONTAINER"
  if [ "$MOUNT_TYPE" = "bind" ]; then
    HOST_DIR="$VOL_NAME"
  else
    HOST_DIR="/var/lib/docker/volumes/$VOL_NAME/_data"
  fi
}

# ---------------------------------------------------------------- precheck

precheck() {
  log "Precheck: container=$CONTAINER port=$PORT db=$DB_IN_CONTAINER"
  discover
  log "  image: $IMAGE"
  log "  mount: ${MOUNT_TYPE:-?} $VOL_NAME -> $DATA_DIR_IN_CONTAINER"

  # У dry-run без docker — не можна inspect; показуємо лише план і виходимо.
  if ! command -v docker >/dev/null 2>&1; then
    log "  (dry-run без docker) пропускаю inspect/вільне-місце/health"
    return 0
  fi

  # Вільне місце: VACUUM потребує повної копії БД + запас.
  # host-каталог БД уже знайдено в discover (bind: .Source, том: .../volumes/<name>/_data).
  if [ -n "$HOST_DIR" ] && [ -d "$HOST_DIR" ]; then
    local free_kb db_kb need_kb
    free_kb=$(df -Pk "$HOST_DIR" 2>/dev/null | awk 'NR==2 {print $4}') || free_kb=""
    db_kb=$(du -sk "$HOST_DIR/$DB_NAME" 2>/dev/null | awk 'NR==1 {print $1}') || db_kb=""
    case "${free_kb:-x}" in *[!0-9]*) free_kb="" ;; esac
    case "${db_kb:-x}"   in *[!0-9]*) db_kb="" ;; esac
    if [ -z "$db_kb" ]; then
      warn "  не видно $HOST_DIR/$DB_NAME — пропуск перевірки вільного місця"
    elif [ -z "$free_kb" ]; then
      warn "  df не дав вільного місця для $HOST_DIR — пропуск перевірки"
    else
      need_kb=$(( db_kb * 2 + 10 * 1024 * 1024 ))   # 2× БД + 10 GiB запасу
      log "  db: $(( db_kb / 1024 / 1024 )) GiB, free: $(( free_kb / 1024 / 1024 )) GiB, need: $(( need_kb / 1024 / 1024 )) GiB"
      if [ "$free_kb" -lt "$need_kb" ]; then
        die "мало вільного місця: треба $(( need_kb / 1024 / 1024 )) GiB, є $(( free_kb / 1024 / 1024 )) GiB"
      fi
    fi
  else
    warn "  не знайдено host-каталогу БД (${HOST_DIR:-?}) — пропуск перевірки вільного місця"
  fi

  # Обов'язкові файли в образі: migrate script + dict
  local probe=""
  if [ "$DRY_RUN" -eq 0 ]; then
    probe=$(docker run --rm "$IMAGE" sh -c \
      "test -f /app/server/$MIGRATE_JS && test -s /app/server/dict/zstd.dict && echo OK" || true)
    [ "$probe" = "OK" ] || die "в образі немає /app/server/$MIGRATE_JS або /app/server/dict/zstd.dict — збуди/перевір image $IMAGE"
  fi
  log "  image: migrate script + dict $([ -n "$probe" ] && echo OK || echo 'dry-run')"

  # Порт панелі
  if command -v curl >/dev/null 2>&1; then
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 \
      "http://127.0.0.1:$PORT/api/health" || true)
    log "  panel http://127.0.0.1:$PORT/api/health -> ${code:-000}"
  fi
  log "Precheck OK"
}

# ---------------------------------------------------------------- helpers

# one-shot контейнер з того самого образу, той самий mount БД + scripts/ репо (read-only)
docker_exec_in_image() {
  local -a cmd=(docker run --rm \
    -v "${VOL_NAME}:/app/server/data" \
    -v "${REPO_ROOT}/scripts:${SCRIPTS_MOUNT}:ro" \
    -w /app/server \
    "$IMAGE" "$@")
  run "${cmd[@]}"
}

backup_now() {
  local ts bname tmp
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  # $$ — щоб два запуски в ту саму секунду не отримали одне ім'я (backup'и не перетираємо)
  bname="$DB_NAME.backup-$ts-$$"
  # крапка спереду: недокопійований файл не потрапляє під glob відновлення
  tmp=".$bname.partial"
  BACKUP_FILE="$bname"
  log "Backup: $DB_NAME -> $bname"
  docker_exec_in_image sh -c "set -e; cd '$DB_DIR_IN_CONTAINER'; \
    if [ -e '$bname' ]; then echo 'backup вже існує: $bname' >&2; exit 1; fi; \
    cp -f '$DB_NAME' '$tmp'; mv '$tmp' '$bname'; ls -lh '$bname'"
}

restore_backup() {
  local latest
  if [ "$DRY_RUN" -eq 1 ]; then
    latest="$DB_NAME.backup-LATEST"
  else
    # тільки завершені backup'и (часткові лежать як .<name>.partial і сюди не попадають);
    # glob не збігається ні з самою БД, ні з $DB_NAME-wal/-shm
    latest=$(docker_exec_in_image sh -c \
      "cd '$DB_DIR_IN_CONTAINER' && ls -1 '$DB_NAME'.backup-* 2>/dev/null | sort | tail -1")
    [ -n "$latest" ] || die "немає жодного $DB_NAME.backup-* для відновлення"
  fi
  confirm "Відновити $latest поверх $DB_NAME? (контейнер має бути зупинений)"
  log "Restore: $latest -> $DB_NAME"
  # -wal/-shm від новішої БД треба прибрати, інакше SQLite накотить їх на відновлений файл
  docker_exec_in_image sh -c "set -e; cd '$DB_DIR_IN_CONTAINER'; \
    cp -f '$latest' '$DB_NAME'; rm -f '$DB_NAME-wal' '$DB_NAME-shm'"
}

wait_health() {
  if [ "$DRY_RUN" -eq 1 ]; then
    log "  (dry-run) health: curl http://127.0.0.1:$PORT/api/health (очікуємо 200)"
    return 0
  fi
  local tries=15 i code
  for i in $(seq 1 "$tries"); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 \
      "http://127.0.0.1:$PORT/api/health" || true)
    if [ "$code" = "200" ]; then
      log "Health OK (спроб $i)"
      return 0
    fi
    sleep 2
  done
  warn "Health не прийшов за $(( tries * 2 )) c — перевір вручну: docker logs $CONTAINER"
}

speed_check() {
  local label="$1"
  log "Speed check ($label):"
  docker_exec_in_image node "${SCRIPTS_MOUNT}/dbSpeedCheck.mjs" --db "$DB_IN_CONTAINER"
}

# ---------------------------------------------------------------- stages

stage_precheck() { precheck; }

stage_migrate() {
  discover
  confirm "Зупинити контейнер '$CONTAINER' і почати миграцію?" || exit 1

  log "1/6 docker stop $CONTAINER"
  run docker stop "$CONTAINER"

  log "2/6 checkpoint (WAL -> main file)"
  docker_exec_in_image node "${SCRIPTS_MOUNT}/checkpointDb.mjs" "$DB_IN_CONTAINER"

  log "3/6 backup"
  backup_now

  log "4/6 migrate --verify (backfill raw_data_z + spot-check)"
  docker_exec_in_image node "$MIGRATE_JS" --db "$DB_IN_CONTAINER" --verify \
    || die "миграція впала — контейнер '$CONTAINER' ЛИШИВСЯ ЗУПИНЕНИМ; відновити: ./scripts/rollout.sh rollback"

  log "5/6 docker start $CONTAINER"
  run docker start "$CONTAINER"

  log "6/6 health"
  wait_health
  log "Migrate завершено. Backup: $BACKUP_FILE"
}

stage_final() {
  discover
  confirm "FINAL: випадає колона raw_data + VACUUM (безповоротне без backup). Продовжити?" || exit 1

  log "1/4 docker stop"
  run docker stop "$CONTAINER"

  log "2/4 migrate --verify --final"
  docker_exec_in_image node "$MIGRATE_JS" --db "$DB_IN_CONTAINER" --verify --final \
    || die "final впав — контейнер '$CONTAINER' ЛИШИВСЯ ЗУПИНЕНИМ; відновити: ./scripts/rollout.sh rollback"

  log "3/4 docker start"
  run docker start "$CONTAINER"

  log "4/4 health"
  wait_health
  log "Final завершено: raw_data видалено, VACUUM виконано"
}

stage_speed() {
  discover
  speed_check "after migration"
}

stage_rollback() {
  discover
  log "1/4 docker stop $CONTAINER (відновлювати можна лише без живого writer-а)"
  run docker stop "$CONTAINER" || warn "docker stop не вдався (вже зупинений?) — продовжую"
  log "2/4 restore"
  restore_backup
  log "3/4 docker start $CONTAINER"
  run docker start "$CONTAINER"
  log "4/4 health"
  wait_health
}

stage_all() {
  stage_precheck
  speed_check "before migration"
  stage_migrate
  stage_speed
  log "Роллаут (precheck+migrate+speed) завершено."
  log "Далі за бажанням:  ./scripts/rollout.sh final   (розокремлює ~29 GiB)"
}

case "$STAGE" in
  precheck) stage_precheck ;;
  migrate)  stage_migrate ;;
  final)    stage_final ;;
  speed)    stage_speed ;;
  rollback) stage_rollback ;;
  all)      stage_all ;;
esac

log "Готово. $BACKUP_KEEP_NOTE"
