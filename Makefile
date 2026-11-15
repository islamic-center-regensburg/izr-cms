.PHONY: up down restart logs

up:
	docker compose -p izr-cms up --build -d

down:
	docker compose -p izr-cms down

restart:
	docker compose -p izr-cms restart

logs:
	docker compose -p izr-cms logs -f
