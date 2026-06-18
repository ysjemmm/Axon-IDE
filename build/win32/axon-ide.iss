; Axon IDE Windows 安装包 — Inno Setup 脚本
; CI 通过 iscc /DAppDir=... /DOutputDir=... 传递路径

#ifndef AppDir
  #define AppDir "..\..\..\VSCode-win32-x64"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\.build"
#endif

#define AppName     "Axon IDE"
#define AppVersion  "0.1.0"
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
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
WizardStyle=modern
AllowNoIcons=yes
UninstallDisplayName={#AppName}

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
