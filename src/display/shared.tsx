import React from "react";
import { BufferParser, Span } from "../parse/buffer";

export function enumFormatter(en: Record<number, string>) {
    return (val: number) => `${en[val] ?? 'unrecognized value'} (${val})`;
}

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