.PHONY: dev build deploy logs status ssh

dev:
	npm run dev

build:
	npm run build

deploy:
	fly deploy

logs:
	fly logs --app perchpad

status:
	fly status --app perchpad

ssh:
	fly ssh console --app perchpad
