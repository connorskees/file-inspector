import React, { ChangeEvent } from 'react'
import './App.css'
import { Png, PngParser } from './parse/png'
import { PngDisplayer, } from './display/png'
import { Gif, GifImageDecoder, GifParser } from './parse/gif';
import { GifDisplayer } from './display/gif';

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

function GifFrame({ gif }: { gif: Gif }) {
  const canvasRef = React.useRef(null);


  React.useEffect(() => {
    (async () => {
      if (!canvasRef.current) {
        return;
      }

      while (true) {
        let frame = Array(gif.logicalScreenDescriptor.width * gif.logicalScreenDescriptor.height).fill([0, 0, 0, 0]);

        for (const image of gif.images) {
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
          // break;
        }
        await new Promise(r => setTimeout(r, 5000));
      }


    })()
  }, [gif, canvasRef])


  return <canvas ref={canvasRef}></canvas>
}

function App() {
  const [png, setPng] = React.useState<Png | null>(null);
  const [gif, setGif] = React.useState<Gif | null>(null);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [imageSource, setImageSource] = React.useState<string | undefined>();

  const cb = React.useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) {
      return;
    }
    setImageSource(URL.createObjectURL(file));
    const buffer = await file.arrayBuffer()

    setPng(null)
    setGif(null)

    setFileName(file.name);

    if (file.type === "image/gif") {
      const parser = new GifParser(new Uint8Array(buffer))
      const gif = parser.parse()
      setGif(gif)
    }

    if (file.type === "image/png") {
      const parser = new PngParser(new Uint8Array(buffer))
      setPng(parser.parse());
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

  const f = false;

  return (
    <>
      {f && gif && <GifFrame gif={gif} />}
      <div style={{ display: 'flex' }}>
        <input type="file" accept="image/*" onChange={cb} ref={inputRef} />
        {imageSource && <img src={imageSource} height={75} style={{ marginLeft: 8 }} />}
      </div>
      {gif && <GifDisplayer key={fileName} gif={gif} />}
      {png && <PngDisplayer key={fileName} png={png} />}
    </>
  )
}

export default App
