#!/usr/bin/env bash
# Axon IDE 打包瘦身：在 gulp 打包、拷入 Axon 扩展之后、签名/打安装包之前运行。
#
# 只删「用户永远用不到」的文件，不砍功能：
#   1. Axon 扩展的 source map（webview 前端 + 扩展本体，约 65MB，仅调试用）
#   2. 其他平台 / 架构的原生二进制（node-pty 预编译包、mxc-sdk 沙箱程序）
#   3. 中英文以外的 Chromium 界面语言包（Chromium 自带的右键菜单等文案；VS Code 自身的多语言不受影响，
#      缺失时 Chromium 回退英文）
#
# 用法：slim-package.sh <应用根目录> <resources/app 目录> <win32|darwin> <x64|arm64>
set -euo pipefail

APP_ROOT="$1"
APP_RES="$2"
PLATFORM="$3"
ARCH="$4"

[ -d "$APP_RES" ] || { echo "::error::resources/app not found: $APP_RES"; exit 1; }

size_of() { du -sk "$1" 2>/dev/null | cut -f1; }
BEFORE=$(size_of "$APP_ROOT")

# ── 1. source map ──
if [ -d "$APP_RES/extensions/axon-ide" ]; then
	find "$APP_RES/extensions/axon-ide" -type f -name '*.map' -delete
fi

# ── 2. 其他平台 / 架构的原生二进制 ──
PTY_PREBUILDS="$APP_RES/node_modules/node-pty/prebuilds"
if [ -d "$PTY_PREBUILDS" ]; then
	for d in "$PTY_PREBUILDS"/*/; do
		name="$(basename "$d")"
		[ "$name" = "$PLATFORM-$ARCH" ] || rm -rf "$d"
	done
fi

MXC_BIN="$APP_RES/node_modules/@microsoft/mxc-sdk/bin"
if [ -d "$MXC_BIN" ]; then
	for d in "$MXC_BIN"/*/; do
		name="$(basename "$d")"
		[ "$name" = "$ARCH" ] || rm -rf "$d"
	done
	if [ -d "$MXC_BIN/$ARCH" ]; then
		if [ "$PLATFORM" = "darwin" ]; then
			# macOS 只用 mxc-exec-mac；其余是 Windows / Linux 的程序
			find "$MXC_BIN/$ARCH" -maxdepth 1 -type f ! -name 'mxc-exec-mac' -delete
		else
			# Windows 不需要 Linux / macOS 的程序
			rm -f "$MXC_BIN/$ARCH/lxc-exec" "$MXC_BIN/$ARCH/linux-test-proxy" "$MXC_BIN/$ARCH/mxc-exec-mac"
		fi
	fi
fi

# ── 3. Chromium 语言包：只留英文与中文 ──
if [ "$PLATFORM" = "win32" ] && [ -d "$APP_ROOT/locales" ]; then
	find "$APP_ROOT/locales" -maxdepth 1 -type f -name '*.pak' \
		! -name 'en-US.pak' ! -name 'zh-CN.pak' ! -name 'zh-TW.pak' -delete
fi
if [ "$PLATFORM" = "darwin" ]; then
	# Electron Framework 里每个 *.lproj 一份 locale.pak。必须在 codesign 之前删，否则签名失效。
	find "$APP_ROOT" -path '*Electron Framework.framework*' -type d -name '*.lproj' \
		! -name 'en.lproj' ! -name 'en_GB.lproj' ! -name 'zh_CN.lproj' ! -name 'zh_TW.lproj' ! -name 'Base.lproj' \
		-prune -exec rm -rf {} +
fi

AFTER=$(size_of "$APP_ROOT")
echo "Slimmed $APP_ROOT: $((BEFORE / 1024))MB -> $((AFTER / 1024))MB (saved $(((BEFORE - AFTER) / 1024))MB)"
