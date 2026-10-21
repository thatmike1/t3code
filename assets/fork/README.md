# Fork icons

`paint-icon-1024.png` and `bonsai-icon-1024.png` are the fork's supplied 1024px RGBA artwork. They are independent of upstream's Icon Composer exports. Linux and Windows packages use Paint by default; the desktop artwork setting selects Paint or Bonsai at runtime, with Scribble and Off using Paint.

Regenerate the Windows ICO from the repository root with ImageMagick:

```sh
convert assets/fork/paint-icon-1024.png -define icon:auto-resize=256,128,64,48,32,16 assets/fork/paint-windows.ico
```

`sizes/` holds the same two icons pre-scaled for the hicolor theme. On Linux the app copies them over themed icons already installed as `hicolor/<size>/apps/com.t3tools.T3Code.png` or `t3code.png`, for launchers whose `Icon=` is a theme name rather than a path. Regenerate them with:

```sh
for a in paint bonsai; do for s in 16 22 24 32 48 64 128 256 512; do magick assets/fork/$a-icon-1024.png -filter Lanczos -resize ${s}x${s} -strip assets/fork/sizes/$a-icon-$s.png; done; done
```
