# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['app/super_pinkie.py'],
    pathex=[],
    binaries=[],
    datas=[('prompts', 'prompts'), ('proxy/ur-rewrite-proxy.py', 'proxy')],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='超级碧琪',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['/Applications/来啦～老弟.app/Contents/Resources/PinkieAppIcon.icns'],
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='超级碧琪',
)
app = BUNDLE(
    coll,
    name='超级碧琪.app',
    icon='/Applications/来啦～老弟.app/Contents/Resources/PinkieAppIcon.icns',
    bundle_identifier='com.cle0726.superpinkie',
)
