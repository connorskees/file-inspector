import React from "react";
import pako from 'pako';
import { Span } from "./buffer";
import { CHUNK_DEFINITIONS, Png } from "./png";
import { ExifField, ExifParser } from "./exif";
import { parse as iccParse } from './iccp';

enum InterlaceMethod {
    none = 0,
    adam7 = 1,
}

enum ColorType {
    grayscale = 0,
    rgb = 2,
    palette = 3,
    grayscale_alpha = 4,
    rgba = 6,
}

enum UnitSpecifier {
    unspecified = 0,
    meters = 1,
}

enum RenderingIntent {
    perceptual = 0,
    relative_colorimetric = 1,
    saturation = 2,
    absolute_colorimetric = 3,
}

function enumGenerator(en: Record<number, string>) {
    return (val: number) => en[val];
}

const stringDisplayer = (val: Span, png: Png) => {
    return png.buffer.stringForSpan(val)
};

const ORIENTATION: Record<number, string> = {
    1: "default (1)",
    2: "flipped horizontally (2)",
    3: "rotated 180 degrees (3)",
    4: "flipped vertically (4)",
    5: "rotated 90 degrees clockwise, then flipped horizontally (5)",
    6: "rotated 90 degrees clockwise (6)",
    7: "rotated 270 degrees clockwise, then flipped horizontally (7)",
    8: "rotated 270 degrees clockwise (8)",
}


function ExifValue({ field }: { field: ExifField }) {
    const fmtName = React.useCallback((name: string) => name.split('.').pop()!, []);

    let value;
    switch (field.type) {
        case 2: {
            if (!Array.isArray(field.value)) {
                value = [field.value];
            }
            value = bufferToString(field.value as number[])
            break;
        }
        case 5:
        case 10:
            if (Array.isArray(field.value)) {
                value = (field.value as ({
                    numerator: number;
                    denom: number;
                })[]).map(({ numerator, denom }) => {
                    if (denom === 1) {
                        return numerator;
                    }

                    return `${+(numerator / denom).toFixed(5)} (${numerator}/${denom})`
                }).join(', ')
            }
            break;
        default:
            if (Array.isArray(field.value) && field.value.length > 25) {
                value = <HiddenBuffer buffer={<p style={{ maxWidth: '80ch' }}>
                    {field.value.join(' ')}
                </p>} />
            } else {
                value = JSON.stringify(field.value);
            }
    }

    if (field.name === "Exif.Image.Orientation") {
        value = ORIENTATION[field.value as number] ?? field.value;
    }

    return <div>
        <span style={{ fontWeight: 600 }}>{(field.name && fmtName(field.name)) ?? `unrecognized field ${field.tag}`}</span>: {value}
    </div>
}

const exifDisplayer = (val: Span, png: Png) => {
    const buffer = png.buffer.bytesForSpan(val);
    const parser = new ExifParser(new Uint8Array(buffer));
    const { fields } = parser.parse()

    return <HiddenBuffer buffer={fields.map((field) => {
        return <ExifValue field={field} />
    })} />
};

const iccDisplayer = (val: Span, png: Png) => {
    const compressed = png.buffer.bytesForSpan(val);
    const decompressed = pako.inflate(compressed);
    const parsed = iccParse(new DataView(decompressed.buffer));

    return <HiddenBuffer buffer={Object.entries(parsed).map(([key, value]) => {
        return <div>
            <span style={{ fontWeight: 600 }}>{key}</span>: {value}
        </div>
    })} />
};


export function HiddenBuffer({ buffer, preview, monospaced }: { buffer: React.ReactNode, preview?: string, monospaced?: boolean }) {
    const [showingBuffer, setShowingBuffer] = React.useState(false)

    if (typeof buffer === 'string' && buffer.length < 50) {
        return buffer;
    }

    const fontFamily = monospaced ? 'monospace' : undefined;

    return <>
        {preview && <span style={{ marginRight: 8 }}>&lt;<span style={{ fontFamily }}>{preview}</span>&gt;</span>}
        <button onClick={() => setShowingBuffer(v => !v)}>
            {showingBuffer ? 'hide' : 'show'}
        </button>
        <br />
        <div style={{ fontFamily, maxWidth: '80ch' }}>
            {showingBuffer ? buffer : ''}
        </div>
    </>
}

const bufferDisplayer = (val: Span, png: Png) => {
    const buffer = new DataView(png.buffer.bytesForSpan(val));
    const fmt = (idx: number) => buffer.getUint8(idx).toString(16).padStart(2, "0")

    const strs = []

    for (let i = 0; i < buffer.byteLength; i += 1) {
        strs.push(fmt(i));
    }

    if (buffer.byteLength > 4) {
        const preview = `${fmt(0)} ${fmt(1)} ... ${fmt(buffer.byteLength - 2)} ${fmt(buffer.byteLength - 1)}`
        return <HiddenBuffer monospaced preview={preview} buffer={`${strs.join(' ')}`} />
    }

    return `<${strs.join(' ')}>`
};

function bufferToString(buffer: Uint8Array | number[]): string {
    let result = ""

    for (let i = 0; i < buffer.length; i += 1) {
        result += String.fromCharCode(buffer[i]);
    }

    return result;

}

const compressedStringDisplayer = (val: Span, png: Png) => {
    const compressed = png.buffer.bytesForSpan(val);
    const decompressed = pako.inflate(compressed);
    return <HiddenBuffer buffer={bufferToString(decompressed)} />
};

type DisplayFunc = (val: any, png: Png) => React.ReactNode

// typeof CHUNK_DEFINITIONS[k][m]
const CHUNK_DISPLAY_DEFINITIONS: Partial<{ [k in keyof typeof CHUNK_DEFINITIONS]:
    Partial<{
        [m in keyof typeof CHUNK_DEFINITIONS[k]]: DisplayFunc
    }>
}> = {
    IHDR: {
        width: (val) => `${val}px`,
        height: (val) => `${val}px`,
        interlace_method: enumGenerator(InterlaceMethod),
        compression_method: enumGenerator({ 0: "deflate" }),
        filter_method: enumGenerator({ 0: "adaptive" }),
        color_type: enumGenerator(ColorType),
    },
    pHYs: {
        unit_specifier: enumGenerator(UnitSpecifier),
    },
    IDAT: {
        buffer: bufferDisplayer
    },
    tEXt: {
        keyword: stringDisplayer,
        text: stringDisplayer
    },
    iCCP: {
        profile_name: stringDisplayer,
        compressed_profile: iccDisplayer,
    },
    zTXt: {
        keyword: stringDisplayer,
        compression_method: enumGenerator({ 0: "deflate" }),
        compressed_text: compressedStringDisplayer,
    },
    eXIf: {
        buffer: exifDisplayer,
    },
    sRGB: {
        rendering_intent: enumGenerator(RenderingIntent),
    },
    iTXt: {
        keyword: stringDisplayer,
        language_tag: stringDisplayer,
        translated_keyword: stringDisplayer,
        text: stringDisplayer,
    }
};

const UNTYPED_CHUNK_DISPLAY_DEFINITIONS = CHUNK_DISPLAY_DEFINITIONS as Record<string, Record<string, DisplayFunc>>;

export function getDisplayFunc(chunkName: string, field: string): DisplayFunc | undefined {
    return UNTYPED_CHUNK_DISPLAY_DEFINITIONS[chunkName]?.[field]
}