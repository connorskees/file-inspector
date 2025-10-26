import React from 'react'
import { Extension, Gif, GifImageDecoder, GifImage, GraphicsControlExtension, LogicalScreenDescriptor } from '../parse/gif'
import { bufferToString, Span } from '../parse/buffer';
import { BufferFormatter, HiddenBuffer, ColorPreview, enumFormatter, byteLengthFormatter, binaryByteFormatter, hexFormatter, stringFormatter, pxFormatter, ColorTableDisplayer } from './shared';

const DISPOSAL_METHODS = {
    0: "unspecified/not animated",
    1: "draw on top",
    2: "clear canvas",
    3: "restore to previous state"
}

function transparentColorIndexFormatter(v: number, gif: Gif, extra: GraphicsControlExtension, image?: GifImage) {
    const colorTable = image?.localColorTable ?? gif.globalColorTable;
    if (!colorTable || !extra.hasTransparentColor || !image) {
        return v;
    }

    const [r, g, b] = colorTable.colors[v];

    return <ColorPreview inline color={`rgb(${r}, ${g}, ${b})`} name={v.toString()} />
}

function backgroundColorIndexFormatter(v: number, gif: Gif, extra: LogicalScreenDescriptor) {
    if (!gif.globalColorTable || !extra.hasGlobalColorTable) {
        return v;
    }

    const [r, g, b] = gif.globalColorTable.colors[v];

    return <ColorPreview inline color={`rgb(${r}, ${g}, ${b})`} name={v.toString()} />
}

const JSON_FORMATTER_OVERRIDES: Record<string, (v: any, gif: Gif, extra: any, image?: GifImage) => React.ReactNode> = {
    width: pxFormatter,
    height: pxFormatter,
    top: pxFormatter,
    left: pxFormatter,
    disposalMethod: enumFormatter(DISPOSAL_METHODS),
    magic: hexFormatter,
    bitflags: binaryByteFormatter,
    descriptor: binaryByteFormatter,
    delayTime: (v: number) => `${v * 10}ms`,
    blockSize: byteLengthFormatter,
    text: bufferToString,
    comment: bufferToString,
    netscapeVersion: stringFormatter,
    transparentColorIndex: transparentColorIndexFormatter,
    backgroundColorIndex: backgroundColorIndexFormatter,
}

interface GifChunkRowProps {
    title: string;
    span: Span,
    body: React.ReactNode;
    gif: Gif
}

function GifChunkRow({ title, span, body, gif }: GifChunkRowProps) {
    const chunkSize = byteLengthFormatter(span.end - span.start);
    return <tr>
        <td style={{ verticalAlign: 'top', textAlign: 'left' }}>{title}</td>
        <td style={{ verticalAlign: 'top', textAlign: 'right', paddingRight: 16 }}>{chunkSize}</td>
        <td style={{ verticalAlign: 'top', textAlign: 'left', width: '48ch' }}>{body}</td>
        <td style={{ verticalAlign: 'top', textAlign: 'left', width: '48ch' }}><BufferFormatter span={span} _buffer={gif.buffer} /></td>
    </tr>
}

function JsonDisplayer({ fields, gif, image }: { fields: object, gif: Gif, image?: GifImage }) {
    return Object.entries(fields).filter(([key, _]) => key !== 'span').map(([key, value]) => {
        let data;
        const displayFunc = JSON_FORMATTER_OVERRIDES[key];
        if (displayFunc) {
            data = displayFunc(value, gif, fields, image);
        } else {
            data = JSON.stringify(value)
        }

        return <div style={{ marginBottom: 8 }} key={key}>
            <span style={{ fontWeight: 600 }}>{key}</span>: {data}
        </div>
    })
}

function ImageDataFormatter({ gif, image }: { gif: Gif, image: GifImage }) {
    const decoder = new GifImageDecoder(gif, image)

    const [codes, setCodes] = React.useState<number[] | null>(null);

    return <HiddenBuffer
        showButtonText={'show codes'}
        buffer={codes?.join(' ')}
        monospaced
        onFirstShow={() => setCodes(decoder.decode())}
    />
}

function GifExtension({ ext, gif, image }: { ext: Extension, gif: Gif, image: GifImage }) {
    const NAME_TO_KIND: Record<Extension["kind"], string> = {
        graphics: "Graphics Control Extension",
        application: "Application Extension",
        comment: "Comment Extension",
        plain: "Plaintext Extension",
    }

    const extension = { ...ext } as Partial<Extension>
    delete extension["kind"]

    return <GifChunkRow
        title={NAME_TO_KIND[ext.kind] ?? "Unrecognized Extension"}
        span={ext.span}
        body={<JsonDisplayer fields={extension} gif={gif} image={image} />}
        gif={gif}
    />
}

export function GifDisplayer({ gif }: { gif: Gif }) {
    return <>
        <div style={{ margin: '64px 16px' }}>
            <table>
                <thead>
                    <tr>
                        <th style={{ textAlign: 'left' }}>Chunk</th>
                        <th style={{ textAlign: 'right', paddingRight: 16 }}>Size</th>
                        <th style={{ textAlign: 'left' }}>Parsed Data</th>
                        <th style={{ textAlign: 'left' }}>Raw Bytes</th>
                    </tr>
                </thead>
                <tbody>
                    <GifChunkRow title="Header" span={gif.header} body={bufferToString(gif.buffer.bytesForSpan(gif.header))} gif={gif} />
                    <GifChunkRow title="Logical Screen Descriptor" span={gif.logicalScreenDescriptor.span} body={<JsonDisplayer fields={gif.logicalScreenDescriptor} gif={gif} />} gif={gif} />
                    {gif.globalColorTable && <ColorTableDisplayer file={gif} table={gif.globalColorTable} title={"Global Color Table"} />}
                    {gif.images.map((image, idx) => {
                        return <React.Fragment key={idx}>
                            {image.extensions.map(ext => <GifExtension gif={gif} ext={ext} image={image} key={ext.span.start} />)}
                            <GifChunkRow title="Image Descriptor" span={image.descriptor.span} body={<JsonDisplayer fields={image.descriptor} gif={gif} />} gif={gif} />
                            {image.localColorTable && <ColorTableDisplayer file={gif} table={image.localColorTable} title={"Local Color Table"} />}
                            <GifChunkRow title="Image Data" span={image.span} body={<ImageDataFormatter image={image} gif={gif} />} gif={gif} />
                        </React.Fragment>
                    })}
                </tbody >
            </table>
        </div>
    </>
}
