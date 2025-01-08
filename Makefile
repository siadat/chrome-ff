.PHONY: chrome-ff.zip
chrome-ff.zip:
	rm -f chrome-ff.zip
	zip -r chrome-ff.zip . -x "*.git*" ".gitignore" "screenshot-*.png"

clear:
	rm -f chrome-ff.zip
