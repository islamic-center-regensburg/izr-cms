.PHONY: up down restart reseed logs

up:
	docker compose -p izr-cms up --build -d

down:
	docker compose -p izr-cms down

restart:
	docker compose -p izr-cms restart

# Wipes the database (and uploads/schema-state) volumes so the next start
# re-applies schemas and re-seeds example data from scratch. Requires
# CMS_ENV=dev; destroys all existing data, including anything added outside
# the seeds.
reseed:
	docker compose -p izr-cms down -v
	docker compose -p izr-cms up --build -d

logs:
	docker compose -p izr-cms logs -f
