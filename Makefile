.PHONY: dev build deploy logs status ssh

dev:
	npm run dev

build:
	npm run build

deploy:
	fly deploy

logs:
	fly logs --app peckmail

status:
	fly status --app peckmail

ssh:
	fly ssh console --app peckmail
