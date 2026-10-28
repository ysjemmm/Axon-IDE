; Axon IDE Windows 安装包 — Inno Setup 脚本
; CI 通过 iscc /DAppDir=... /DOutputDir=... 传递路径

#ifndef AppDir
  #define AppDir "..\..\..\VSCode-win32-x64"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\.build"
#endif

#define AppName     "Axon IDE"
; 版本由 CI 通过 /DAppVersion=<product.json 的 version> 传入，与 About 对话框、发布 tag 同源；
; 这里的缺省值仅供本地试打包使用，不参与正式发布。
#ifndef AppVersion
  #define AppVersion  "1.106.211"
#endif
#define AppExeName  "Axon IDE.exe"

[Setup]
AppId={{A7B6C5D4-E3F2-4101-9876-54321FEDCBA0}}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Axon
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
OutputDir={#OutputDir}
OutputBaseFilename=Axon-IDE-win32-x64-setup
Compression=lzma2/ultra64
SolidCompression=yes
; LZMA2 多线程压缩（CI 机器 4 核）：打安装包从约 4.5 分钟降到 1~2 分钟，体积代价通常在 1%~3%
LZMAUseSeparateProcess=yes
LZMANumBlockThreads=4
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
WizardStyle=modern
AllowNoIcons=yes
UninstallDisplayName={#AppName}
; 自动更新（updateService.axon.ts 以 /silent 运行本安装包）时，旧进程可能还没完全退出：
; 让 Restart Manager 检测并关掉占用文件的进程，graceful 关不掉就强制关，避免覆盖到一半静默失败、
; 下次启动加载的仍是旧文件。默认过滤只看 *.exe,*.dll,*.chm，补上原生模块 .node 与 .asar。
CloseApplications=force
CloseApplicationsFilter=*.exe,*.dll,*.node,*.asar
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "快捷方式:"; Flags: unchecked

[Files]
Source: "{#AppDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{userdesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "启动 Axon IDE"; Flags: nowait postinstall skipifsilent
; 自动更新走的是静默安装，上一行被 skipifsilent 跳过——点了「重启以更新」后应用关掉就再也没起来，
; 用户只能自己去点快捷方式。静默安装时直接把新装好的这份拉起来。
Filename: "{app}\{#AppExeName}"; Flags: nowait; Check: WizardSilent
