# SPDX-License-Identifier: GPL-3.0-or-later
VERSION := $(shell cat VERSION)
ARCHES := x86_64 aarch64 armv7l riscv64

CC_x86_64 ?= $(shell command -v x86_64-linux-gnu-gcc >/dev/null 2>&1 && echo x86_64-linux-gnu-gcc || echo gcc)
CC_aarch64 ?= aarch64-linux-gnu-gcc
CC_armv7l ?= arm-linux-gnueabihf-gcc
CC_riscv64 ?= riscv64-linux-gnu-gcc

# The module links against nothing: every symbol it uses is already loaded
# in Phosh, so one binary per CPU works with glibc and musl alike.
MODULE_CFLAGS := -O2 -fPIC -shared -nostdlib -fno-stack-protector -fvisibility=hidden \
	-Wall -Wextra -Werror -Wl,--build-id=none -Wl,-z,noexecstack -s
MODULE_SRC := src/module/gnosh-module.c

.PHONY: all module modules prebuilt check-prebuilt dist lint test unit-test clean

all: module

module: build/libgnosh-phosh-$(shell uname -m).so

build/libgnosh-phosh-%.so: $(MODULE_SRC)
	@mkdir -p build
	$(CC_$*) $(MODULE_CFLAGS) -o $@ $<

modules: $(foreach a,$(ARCHES),build/libgnosh-phosh-$(a).so)

# Prebuilt modules are committed so installing from a git checkout needs no
# compiler. They must be rebuilt whenever the module source changes.
prebuilt: modules
	@for a in $(ARCHES); do mkdir -p modules/prebuilt/$$a; cp build/libgnosh-phosh-$$a.so modules/prebuilt/$$a/libgnosh-phosh.so; done
	sha256sum $(MODULE_SRC) | cut -d' ' -f1 > modules/prebuilt/SOURCE_SHA256

check-prebuilt:
	@test "$$(sha256sum $(MODULE_SRC) | cut -d' ' -f1)" = "$$(cat modules/prebuilt/SOURCE_SHA256)" || \
		{ echo "modules/prebuilt is out of date: run 'make prebuilt'" >&2; exit 1; }
	@for a in $(ARCHES); do test -f modules/prebuilt/$$a/libgnosh-phosh.so || { echo "missing prebuilt module for $$a" >&2; exit 1; }; done
	@echo "prebuilt modules match $(MODULE_SRC)"

dist: modules
	rm -rf build/dist && mkdir -p build/dist/gnosh-$(VERSION)
	cp -R bin runtime setup.sh LICENSE README.md VERSION build/dist/gnosh-$(VERSION)/
	echo "$(VERSION)" > build/dist/gnosh-$(VERSION)/runtime/VERSION
	sed -i 's/^VERSION = "dev"/VERSION = "$(VERSION)"/' build/dist/gnosh-$(VERSION)/bin/gnosh
	for a in $(ARCHES); do mkdir -p build/dist/gnosh-$(VERSION)/modules/$$a; \
		cp build/libgnosh-phosh-$$a.so build/dist/gnosh-$(VERSION)/modules/$$a/libgnosh-phosh.so; done
	tar -C build/dist --owner=0 --group=0 --sort=name -czf build/gnosh-$(VERSION).tar.gz gnosh-$(VERSION)
	cd build && sha256sum gnosh-$(VERSION).tar.gz > gnosh-$(VERSION).tar.gz.sha256
	@echo "built build/gnosh-$(VERSION).tar.gz"

lint:
	shellcheck -s sh setup.sh tests/integration/*.sh tests/integration/steps/*.sh tests/device/*.sh tools/*.sh
	python3 -m py_compile bin/gnosh
	python3 -m json.tool runtime/data/compat.json >/dev/null
	tools/check-js-syntax.sh

unit-test:
	gjs -m tests/unit/run.js
	python3 -m unittest discover -s tests/unit -p 'test_*.py'

test: lint unit-test check-prebuilt

clean:
	rm -rf build
