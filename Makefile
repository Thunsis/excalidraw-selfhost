# ============================================================
# excalidraw-selfhost — unified command entry
# All logic lives in scripts/ (testable, callable directly).
# This Makefile is a thin, discoverable wrapper.
#
# Usage: make <target>   (see `make help`)
# ============================================================

REPO_DIR := $(shell pwd)
EXCALIDRAW_REPO ?= $(REPO_DIR)/../excalidraw

.PHONY: help install build patch patch-export backup check doctor

help: ## show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## generate config + install launchd agents (reads .env)
	./scripts/install.sh

build: ## rebuild frontend from patches (restore -> patch -> build -> restore)
	./scripts/build-frontend.sh $(EXCALIDRAW_REPO)

patch: ## apply patches to excalidraw repo for dev work
	./scripts/apply-patch.sh $(EXCALIDRAW_REPO)

patch-export: ## re-export patches from a modified excalidraw repo
	./scripts/apply-patch.sh $(EXCALIDRAW_REPO) --export

backup: ## SQLite snapshot (WAL-safe), keeps last 7
	./scripts/backup.sh

check: ## healthcheck: ports + launchd + db + optional external domain
	./scripts/healthcheck.sh

doctor: ## full self-check (onboarding / debugging)
	@echo "── ports ──"
	@lsof -nP -iTCP:3001 -sTCP:LISTEN | tail -1 || echo "caddy NOT listening"
	@lsof -nP -iTCP:3020 -sTCP:LISTEN | tail -1 || echo "ws-backend NOT listening"
	@lsof -nP -iTCP:3016 -sTCP:LISTEN | tail -1 || echo "ai-backend NOT listening"
	@echo "── launchd ──"
	@launchctl list | grep excalidraw || echo "no excalidraw jobs"
	@echo "── db ──"
	@ls -la apps/ws-server/data/ 2>/dev/null || echo "no data dir"
	@echo "── backups ──"
	@ls -la apps/ws-server/data/backups/ 2>/dev/null | tail -3 || echo "no backups yet"
