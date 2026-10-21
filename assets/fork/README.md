# Fork icons

`paint-icon-1024.png` and `bonsai-icon-1024.png` are the fork's supplied 1024px RGBA artwork. They are independent of upstream's Icon Composer exports. Linux and Windows packages use Paint by default; the desktop artwork setting selects Paint or Bonsai at runtime, with Scribble and Off using Paint.

Regenerate the Windows ICO from the repository root with ImageMagick:

```sh
convert assets/fork/paint-icon-1024.png -define icon:auto-resize=256,128,64,48,32,16 assets/fork/paint-windows.ico
```
