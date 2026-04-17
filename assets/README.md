# AutoIngest — Build Assets

Place the following icon files in this directory before running `npm run dist`:

## Required files

| File        | Platform | Size      | Notes                                              |
|-------------|----------|-----------|----------------------------------------------------|
| `mac.icns`  | macOS    | —         | Multi-resolution ICNS bundle (1024×1024 max)       |
| `win.ico`   | Windows  | —         | Multi-resolution ICO (16, 32, 48, 64, 128, 256 px) |

## How to generate from a PNG source

### macOS — mac.icns
```bash
# Requires macOS (iconutil is built in)
mkdir AppIcon.iconset
sips -z 16   16   icon.png --out AppIcon.iconset/icon_16x16.png
sips -z 32   32   icon.png --out AppIcon.iconset/icon_16x16@2x.png
sips -z 32   32   icon.png --out AppIcon.iconset/icon_32x32.png
sips -z 64   64   icon.png --out AppIcon.iconset/icon_32x32@2x.png
sips -z 128  128  icon.png --out AppIcon.iconset/icon_128x128.png
sips -z 256  256  icon.png --out AppIcon.iconset/icon_128x128@2x.png
sips -z 256  256  icon.png --out AppIcon.iconset/icon_256x256.png
sips -z 512  512  icon.png --out AppIcon.iconset/icon_256x256@2x.png
sips -z 512  512  icon.png --out AppIcon.iconset/icon_512x512.png
sips -z 1024 1024 icon.png --out AppIcon.iconset/icon_512x512@2x.png
iconutil -c icns AppIcon.iconset -o assets/mac.icns
```

### Windows — win.ico
```bash
# Using ImageMagick (brew install imagemagick / choco install imagemagick)
magick icon.png -define icon:auto-resize="256,128,64,48,32,16" assets/win.ico
```

## Build commands

```bash
npm run dist        # build both macOS (.dmg) and Windows (.exe)
npm run dist:mac    # macOS only
npm run dist:win    # Windows only
```

Output goes to the `dist/` directory.

## Notes

- macOS builds produce universal binaries (x64 + arm64) for both Intel and Apple Silicon.
- Windows builds produce a 64-bit NSIS installer with a custom install directory option.
- electron-builder is already installed as a devDependency — no extra install needed.
