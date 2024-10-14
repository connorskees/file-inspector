import React from 'react'
import { ColorTable, Extension, Gif, GifImageDecoder, Image } from '../parse/gif'
import { ColorPreview, HiddenBuffer } from './png';
import { BufferParser, Span } from '../parse/buffer';

// const GIF_CHUNK_DEFINITIONS = {
//     global_color_table: (gif: Gif) => ({
//         title: "Global Color Table",
//         span: gif.globalColorTable?.span,
//         body: <>{gif.globalColorTable && <ColorArrayDisplayer colors={gif.globalColorTable.colors} />}</>
//     }),
//     logical_screen_descriptor: (gif: Gif) => ({
//         title: "Logical Screen Descriptor",
//         span: gif.logicalScreenDescriptor.span,
//         body: <>{gif.globalColorTable && <ColorArrayDisplayer colors={gif.globalColorTable.colors} />}</>
//     }),
// }

function BufferFormatter({ span, _buffer }: { span: Span, _buffer: BufferParser }) {
    const buffer = new DataView(_buffer.bytesForSpan(span));
    const fmt = (idx: number) => buffer.getUint8(idx).toString(16).padStart(2, "0")

    const [str, setStr] = React.useState<string | null>(null);

    const createStr = React.useCallback(() => {
        if (str !== null) {
            return;
        }

        const strs = []

        for (let i = 0; i < buffer.byteLength; i += 1) {
            strs.push(fmt(i));
        }

        setStr(strs.join(' '))
    }, [span, fmt, str])

    if (str === null && buffer.byteLength < 32) {
        createStr();
    }

    if (buffer.byteLength > 32) {
        const preview = `${fmt(0)} ${fmt(1)} ... ${fmt(buffer.byteLength - 2)} ${fmt(buffer.byteLength - 1)}`
        return <HiddenBuffer monospaced preview={preview} buffer={str} onFirstShow={createStr} />
    }

    return <span style={{ fontFamily: 'monospace' }}>{`<${str}>`}</span>

}

interface GifChunkRowProps {
    title: string;
    span: Span,
    body: React.ReactNode;
    gif: Gif
}

function GifChunkRow({ title, span, body, gif }: GifChunkRowProps) {
    return <tr>
        <td style={{ verticalAlign: 'top', textAlign: 'left' }}>{title}</td>
        <td style={{ verticalAlign: 'top', textAlign: 'right', paddingRight: 16 }}>{span.end - span.start}</td>
        <td style={{ verticalAlign: 'top', textAlign: 'left', width: '48ch' }}>{body}</td>
        <td style={{ verticalAlign: 'top', textAlign: 'left', width: '48ch' }}><BufferFormatter span={span} _buffer={gif.buffer} /></td>
    </tr>
}

function ColorTableDisplayer({ title, table, gif }: { title: string, table: ColorTable, gif: Gif }) {
    const colors = table.colors.map(([red, green, blue]) =>
        <ColorPreview
            color={`rgb(${red}, ${green}, ${blue})`}
            name={`${red}, ${green}, ${blue}`}
        />
    );

    return <GifChunkRow title={title} span={table.span} body={colors.length > 15 ? <HiddenBuffer buffer={colors} /> : colors} gif={gif} />
}

function JsonDisplayer({ fields }: { name?: string, fields: object }) {
    return Object.entries(fields).filter(([key, _]) => key !== 'span').map(([key, value]) => {
        const data = JSON.stringify(value)

        return <div style={{ marginBottom: 8 }}>
            <span style={{ fontWeight: 600 }}>{key}</span>: {data}
        </div>
    })

}

function ImageDataFormatter({ gif, image }: { gif: Gif, image: Image }) {
    const decoder = new GifImageDecoder(gif, image)

    const [codes, setCodes] = React.useState<number[] | null>(null);

    return <HiddenBuffer showButtonText={'show codes'} buffer={codes?.join(' ')} monospaced onFirstShow={() => setCodes(decoder.decode())} />
}

function GifExtension({ ext, gif }: { ext: Extension, gif: Gif }) {
    const NAME_TO_KIND: Record<Extension["kind"], string> = {
        graphics: "Graphics Control Extension",
        application: "Application Extension",
        comment: "Comment Extension",
        plain: "Plaintext Extension",
    }

    const extension = { ...ext } as Partial<Extension>
    delete extension["kind"]

    return <GifChunkRow title={NAME_TO_KIND[ext.kind] ?? "Unrecognized Extension"} span={ext.span} body={<JsonDisplayer fields={extension} />} gif={gif} />
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
                    <GifChunkRow title="Logical Screen Descriptor" span={gif.logicalScreenDescriptor.span} body={<JsonDisplayer fields={gif.logicalScreenDescriptor} />} gif={gif} />
                    {gif.globalColorTable && <ColorTableDisplayer gif={gif} table={gif.globalColorTable} title={"Global Color Table"} />}
                    {gif.images.map((image) => {
                        return <>
                            {image.extensions.map(ext => <GifExtension gif={gif} ext={ext} />)}
                            <GifChunkRow title="Image Descriptor" span={image.descriptor.span} body={<JsonDisplayer fields={image.descriptor} />} gif={gif} />
                            {image.localColorTable && <ColorTableDisplayer gif={gif} table={image.localColorTable} title={"Local Color Table"} />}
                            <GifChunkRow title="Image Data" span={image.span} body={<ImageDataFormatter image={image} gif={gif} />} gif={gif} />
                        </>
                    })}
                </tbody >
            </table>
        </div>
    </>
}
