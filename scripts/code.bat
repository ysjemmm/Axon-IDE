@echo off
setlocal

title VSCode Dev

pushd %~dp0\..

:: Get electron, compile, built-in extensions
if "%VSCODE_SKIP_PRELAUNCH%"=="" (
	node build/lib/preLaunch.ts
)

set "NAMESHORT="
for /f "tokens=2 delims=:," %%a in ('findstr /R /C:"\"nameShort\":.*" product.json') do if not defined NAMESHORT set "NAMESHORT=%%~a"
set NAMESHORT=%NAMESHORT: "=%
set NAMESHORT=%NAMESHORT:"=%.exe
set CODE=".build\electron\%NAMESHORT%"

:: Manage built-in extensions
if "%~1"=="--builtin" goto builtin

:: Configuration
set NODE_ENV=development
set VSCODE_DEV=1
set VSCODE_CLI=1
set ELECTRON_ENABLE_LOGGING=1
set ELECTRON_ENABLE_STACK_DUMPING=1

set DISABLE_TEST_EXTENSION="--disable-extension=vscode.vscode-api-tests"
for %%A in (%*) do (
	if "%%~A"=="--extensionTestsPath" (
		set DISABLE_TEST_EXTENSION=""
	)
)

:: GPU: 白屏根因大概率是 Todesk 虚拟显示适配器干扰 Chromium GPU 进程初始化（AMD 780M 核显
:: + 虚拟适配器枚举冲突），而非 GPU 本身问题。全局 --disable-gpu 会把光栅化压到 CPU，
:: Monaco 滚动/长列表/动画明显卡顿。
::
:: 改用精确开关：强制 ANGLE 走 D3D11（绕开自动后端选择踩到虚拟适配器）、关 GPU 沙箱
:: （远程驱动场景下沙箱与驱动的交互是另一崩溃源）。若仍白屏，追加 --disable-gpu 退回。
%CODE% . --use-angle=d3d11 --disable-gpu-sandbox %DISABLE_TEST_EXTENSION% %*
goto end

:builtin
%CODE% build/builtin

:end

popd

endlocal
