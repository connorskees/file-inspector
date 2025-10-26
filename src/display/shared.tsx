import React from "react";
import { BufferParser, bufferToString, Span } from "../parse/buffer";

export function enumFormatter(en: Record<number, string>) {
    return (val: number) => `${en[val] ?? 'unrecognized value'} (${val})`;
}

export const byteLengthFormatter = (v: number) => {
    if (v === 1) {
        return '1 byte'
    }

    if (v < 1_000_000) {
        return `${v} bytes`;
    }

    return `${v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "_")} bytes`
};

export const hexFormatter = (v: number) => `0x${v.toString(16)}`;

export const binaryByteFormatter = (v: number) => {
    if (v > 255) {
        throw new Error('attempted to display byte > 255')
    }
    const str = v.toString(2).padStart(8, '0');
    return '0b' + str.slice(0, 4) + '_' + str.slice(4)
}

export const stringFormatter = (v: Span, file: ImageFile) => bufferToString(file.buffer.bytesForSpan(v))
export const littleEndianStringFormatter = (v: Span, file: ImageFile) => bufferToString(new Uint8Array(file.buffer.bytesForSpan(v)).reverse())

export const pxFormatter = (v: number) => `${v}px`

interface HiddenBufferProps {
    buffer: React.ReactNode,
    preview?: string,
    monospaced?: boolean
    onFirstShow?: () => void
    showButtonText?: string
    hideButtonText?: string
}

export function HiddenBuffer({ buffer, preview, monospaced, onFirstShow, showButtonText, hideButtonText }: HiddenBufferProps) {
    const [showingBuffer, setShowingBuffer] = React.useState(false)
    const [hasShown, setHasShown] = React.useState(false)

    if (typeof buffer === 'string' && buffer.length < 50) {
        return buffer;
    }

    const fontFamily = monospaced ? 'monospace' : undefined;

    return <>
        {preview && <span style={{ marginRight: 8 }}>&lt;<span style={{ fontFamily }}>{preview}</span>&gt;</span>}
        <button onClick={() => {
            if (!hasShown) {
                setHasShown(true)
                onFirstShow?.()
            }
            setShowingBuffer(v => !v)
        }}>
            {showingBuffer ? (hideButtonText ?? 'hide') : (showButtonText ?? 'show')}
        </button>
        <br />
        <div style={{ fontFamily, maxWidth: '80ch' }}>
            {showingBuffer ? buffer : ''}
        </div>
    </>
}

export function ColorPreview({ color, name, inline }: { color: string; name: string, inline?: boolean }) {
    return <div style={{ display: inline ? 'inline-flex' : 'flex', alignItems: 'center', fontFamily: "monospace" }}>
        <div style={{ width: 8, height: 8, background: color, marginRight: 8 }}></div>
        {name}
    </div>
}

export function BufferFormatter({ span, _buffer }: { span: Span, _buffer: BufferParser }) {
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


interface ImageFile {
    buffer: BufferParser
}

interface ImageChunkRowProps {
    title: string;
    span: Span,
    body: React.ReactNode;
    file: ImageFile
    hideRawBytes?: boolean
}

export function ImageChunkRow({ title, span, body, file, hideRawBytes }: ImageChunkRowProps) {
    const chunkSize = byteLengthFormatter(span.end - span.start);
    return <tr>
        <td style={{ verticalAlign: 'top', textAlign: 'left' }}>{title}</td>
        <td style={{ verticalAlign: 'top', textAlign: 'right', paddingRight: 16 }}>{chunkSize}</td>
        <td style={{ verticalAlign: 'top', textAlign: 'left', width: '48ch' }}>{body}</td>
        <td style={{ verticalAlign: 'top', textAlign: 'left', width: '48ch' }}>{!hideRawBytes && <BufferFormatter span={span} _buffer={file.buffer} />}</td>
    </tr>
}

// RGB or RGBA
type ColorArray = [number, number, number] | [number, number, number, number]

interface ColorTable {
    colors: ColorArray[],
    span: Span,
}

export function ColorTableDisplayer({ title, table, file }: { title: string, table: ColorTable, file: ImageFile }) {
    const colors = table.colors.map(([red, green, blue], idx) =>
        <ColorPreview
            key={idx}
            color={`rgb(${red}, ${green}, ${blue})`}
            name={`${red}, ${green}, ${blue}`}
        />
    );

    return <ImageChunkRow title={title} span={table.span} body={colors.length > 15 ? <HiddenBuffer buffer={colors} /> : colors} file={file} />
}

