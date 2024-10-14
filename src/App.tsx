import React, { ChangeEvent } from 'react'
import './App.css'
import { Chunk, Png, PngParser } from './parse/png'
import { getDisplayFunc, } from './display/png'
import { Gif, GifImageDecoder, GifParser } from './parse/gif';
import { GifDisplayer } from './display/gif-display';

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


interface ChunkDataFieldProps {
  png: Png,
  chunk: Chunk;
  fieldName: string;
  data: any;
}

function ChunkDataField({ png, chunk, fieldName, data }: ChunkDataFieldProps) {
  if (!fieldName) {
    console.log({ chunk, fieldName })

  }
  const displayFunc = getDisplayFunc(chunk.name(), fieldName)
  if (displayFunc) {
    data = displayFunc(data, png, chunk);
  } else {
    data = JSON.stringify(data)
  }

  const hideKey = false; // Object.keys(chunk.parsedData ?? {}).length === 1 && data.type?.name === 'HiddenBuffer'

  return <div style={{ marginBottom: 8, display: hideKey ? 'inline' : undefined }}>
    <span style={{ fontWeight: 600 }}>{fieldName}</span>: {data}
  </div>
}

function App() {
  const [png, setPng] = React.useState<Png | null>(null);
  const [gif, setGif] = React.useState<Gif | null>(null);
  const [imageSource, setImageSource] = React.useState<string | undefined>();

  const cb = React.useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) {
      return;
    }
    setImageSource(URL.createObjectURL(file));
    const buffer = await file.arrayBuffer()

    if (file.type === "image/gif") {
      const parser = new GifParser(new Uint8Array(buffer))
      const gif = parser.parse()
      setGif(gif)
      setPng(null)
    }

    if (file.type === "image/png") {
      const parser = new PngParser(new Uint8Array(buffer))
      setPng(parser.parse());
      setGif(null)
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

  const idatChunks = png?.chunks.filter(chunk => chunk.name() === 'IDAT');
  const nonIdatChunks = png?.chunks.filter(chunk => chunk.name() !== 'IDAT');

  const [idatExpanded, setIdatExpanded] = React.useState(false)

  const chunks = idatChunks && idatChunks?.length > 3 ? nonIdatChunks : png?.chunks;

  const canvasRef = React.useRef(null)

  React.useEffect(() => {
    (async () => {
      if (!canvasRef.current || !gif) {
        return;
      }

      console.log({ gif })

      while (true) {
        for (const image of gif.images) {
          const decoder = new GifImageDecoder(gif, image)
          const gce = image.extensions.find((ext) => ext.kind === "graphics")
          const transparentColorIndex: number | undefined = gce?.transparentColorIndex
          const colorTable = image.localColorTable?.colors ?? gif.globalColorTable?.colors;
          const pixels = decoder.decode().map(idx => {
            // todo: likely bogus
            if (idx === transparentColorIndex) {
              return [0, 0, 0, 0]
            }
            const color = colorTable?.[idx]
            if (color === undefined) {
              console.error('color index oob', idx)
            }
            return color ?? [255, 0, 0, 255]
          })

          createCanvasFromRGBAData(pixels, image.descriptor.width, image.descriptor.height, canvasRef.current)
          await new Promise(r => setTimeout(r, 110));
        }
      }

    })()
  }, [gif, canvasRef])

  return (
    <>
      {/* <canvas id="canvas" ref={canvasRef}></canvas> */}
      <div style={{ display: 'flex' }}>
        <input type="file" accept="image/*" onChange={cb} ref={inputRef} />
        {imageSource && <img src={imageSource} height={75} style={{ marginLeft: 8 }} />}
      </div>
      {gif && <GifDisplayer gif={gif} />}
      {png &&
        <div>
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Chunk</th>
                <th style={{ textAlign: 'right', paddingRight: 16 }}>Size</th>
                <th style={{ textAlign: 'left' }}>Data</th>
              </tr>
            </thead>
            <tbody>
              {chunks?.map(chunk => {
                const isSingle = false; // Object.keys(chunk.parsedData ?? {}).length === 1
                const verticalAlign = isSingle ? 'middle' : "top";
                return <tr key={chunk.span.start + chunk.name()}>
                  <td style={{ verticalAlign, textAlign: 'left' }}>{chunk.name()}</td>
                  <td style={{ verticalAlign, textAlign: 'right', paddingRight: 16 }}>{chunk.size()} bytes</td>
                  <td style={{ verticalAlign, textAlign: 'left', width: '80ch' }}>{Object.entries(chunk.parsedData ?? {}).map(([key, value]) => {
                    return <ChunkDataField key={chunk.span.start + key} png={png} chunk={chunk} fieldName={key} data={value} />
                  })}</td>
                </tr>
              })}
              {idatChunks && idatChunks?.length > 3 && <tr>
                <td colSpan={3} style={{ verticalAlign: "top", textAlign: 'center', padding: 32 }}><button onClick={() => setIdatExpanded(v => !v)}>{idatExpanded ? 'Hide' : 'Show'} IDAT</button></td>
              </tr>}
              {idatChunks && idatChunks?.length > 3 && idatExpanded && idatChunks?.map(chunk => {
                return <tr>
                  <td style={{ verticalAlign: "top", textAlign: 'left' }}>{chunk.name()}</td>
                  <td style={{ verticalAlign: "top", textAlign: 'right', paddingRight: 16 }}>{chunk.size()} bytes</td>
                  <td style={{ verticalAlign: "top", textAlign: 'left', width: '80ch' }}>{Object.entries(chunk.parsedData ?? {}).map(([key, value]) => {
                    return <ChunkDataField png={png} chunk={chunk} fieldName={key} data={value} />
                  })}</td>
                </tr>
              })}
            </tbody>
          </table>
        </div>}
    </>
  )
}

export default App
