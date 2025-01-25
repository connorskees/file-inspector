import React, { ChangeEvent } from 'react'
import './App.css'
import { Png, PngParser } from './parse/png'
import { PngDisplayer, } from './display/png'
import { Gif, GifImageDecoder, GifParser, Image } from './parse/gif';
import { GifDisplayer } from './display/gif';
import { ZipFile, ZipParser } from './parse/zip';
import { ZipDisplayer } from './display/zip';

function createCanvasFromRGBAData(data: number[][], width: number, height: number, canvas: HTMLCanvasElement) {
  if (width * height !== data.length) throw new Error("width*height should equal data.length");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const imgData = ctx.createImageData(width, height);
  for (let i = 0; i < data.length; i++) {
    if (!data[i]) {
      console.log({ len: data.length, last: data[data.length - 1], i, data })
    }
    imgData.data[i * 4 + 0] = data[i][0];
    imgData.data[i * 4 + 1] = data[i][1];
    imgData.data[i * 4 + 2] = data[i][2];
    imgData.data[i * 4 + 3] = data[i][3] ?? 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

export function GifFrame({ gif, image }: { gif: Gif, image?: Image }) {
  const canvasRef = React.useRef(null);


  React.useEffect(() => {
    (async () => {
      if (!canvasRef.current) {
        return;
      }

      const images = image ? [image] : gif.images;

      while (true) {
        let frame = Array(gif.logicalScreenDescriptor.width * gif.logicalScreenDescriptor.height).fill([0, 0, 0, 0]);

        for (const image of images) {
          const decoder = new GifImageDecoder(gif, image)
          const gce = image.extensions.find((ext) => ext.kind === "graphics")
          const transparentColorIndex: number | undefined = gce?.transparentColorIndex
          const colorTable = image.localColorTable?.colors ?? gif.globalColorTable?.colors;
          decoder.decode().map((idx, pixelidx) => {
            // todo: likely bogus
            if (idx === transparentColorIndex) {
              // frame[pixelidx] = [0, 0, 0, 0]
              return;
            }
            const color = colorTable?.[idx]
            if (color === undefined) {
              console.error('color index oob', idx)
            }

            frame[pixelidx] = color ?? [255, 0, 0, 255];

            return color ?? [255, 0, 0, 255]
          })

          createCanvasFromRGBAData(frame, image.descriptor.width, image.descriptor.height, canvasRef.current)
          await new Promise(r => setTimeout(r, (gce?.delayTime ?? 0) * 10));
        }
        await new Promise(r => setTimeout(r, 5000));
      }


    })()
  }, [gif, canvasRef])


  return <canvas ref={canvasRef}></canvas>
}

type File =
  { kind: "png", file: Png }
  | { kind: "gif", file: Gif }
  | { kind: "zip", file: ZipFile }

function App() {
  const [file, setFile] = React.useState<File | null>(null);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [imageSource, setImageSource] = React.useState<string | undefined>();

  const cb = React.useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) {
      return;
    }
    setImageSource(URL.createObjectURL(file));
    const buffer = await file.arrayBuffer()

    setFile(null)
    setFileName(file.name);

    if (file.type === "image/gif") {
      const parser = new GifParser(new Uint8Array(buffer))
      const gif = parser.parse()
      setFile({ kind: "gif", file: gif });
    }

    if (file.type === "image/png") {
      const parser = new PngParser(new Uint8Array(buffer))
      setFile({ kind: "png", file: parser.parse() });
    }

    if (file.type === "application/zip") {
      const parser = new ZipParser(new Uint8Array(buffer))
      setFile({ kind: "zip", file: parser.parse() });
      setImageSource(undefined);
    }
  }, [])

  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    const dropZone = document.querySelector('body');

    if (!dropZone) {
      return;
    }

    const dropCb = (e: any) => {
      if (inputRef.current) {
        inputRef.current.files = e.dataTransfer.files;
        e.preventDefault()
        cb({ target: inputRef.current } as any)
      }
    };

    const cancelCb = (e: Event) => e.preventDefault();

    dropZone.addEventListener('drop', dropCb);
    dropZone.addEventListener('dragenter', cancelCb);
    dropZone.addEventListener('dragover', cancelCb);

    return () => dropZone.removeEventListener('drop', dropCb);
  }, [inputRef.current])

  return (
    <>
      <div style={{ display: 'flex' }}>
        <input type="file" accept="image/*" onChange={cb} ref={inputRef} />
        {imageSource && <img src={imageSource} height={75} style={{ marginLeft: 8 }} />}
      </div>
      {file?.file && <>
        {file.kind === "gif" && <GifDisplayer key={fileName} gif={file.file} />}
        {file.kind === "png" && <PngDisplayer key={fileName} png={file.file} />}
        {file.kind === "zip" && <ZipDisplayer key={fileName} zip={file.file} />}
      </>}
    </>
  )
}

export default App
