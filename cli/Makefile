APP_NAME := lido-aragon
SUPPORTED_PLATFORMS := linux darwin
SUPPORTED_ARCHS := amd64 arm64
VERSION := $(shell git describe --tags --abbrev=0)
REVISION := $(shell git rev-parse --short HEAD)

UNAME_M := $(shell uname -m)
ARCH := $(UNAME_M)
ifeq ($(UNAME_M),x86_64)
	ARCH=amd64
endif
ifneq ($(filter %86,$(UNAME_M)),)
	ARCH=386
endif
ifneq ($(filter arm%,$(UNAME_M)),)
  ARCH=arm
endif
ifneq ($(filter $(UNAME_M),arm64 aarch64 armv8b armv8l),)
	ARCH=arm64
endif

compile-releases: clean vendor## Compile vsh binaries for multiple platforms and architectures strictly using vendor directory	
	mkdir -p ./build/
	for GOOS in $(SUPPORTED_PLATFORMS); do \
		for GOARCH in $(SUPPORTED_ARCHS); do \
			GOOS=$$GOOS GOARCH=$$GOARCH \
				go build -mod vendor -ldflags "-X lido-aragon/cmd.version=$(VERSION) -X lido-aragon/cmd.revision=$(REVISION)" -o build/${APP_NAME}_$${GOOS}_$${GOARCH}; \
		done \
	done
	cd build/ && sha256sum * > SHA256SUM

clean: ## Remove builds and vsh related docker containers
	rm ./build/* || true

vendor: ## synch dependencies in vendor/ directory
	go mod tidy
	go mod vendor