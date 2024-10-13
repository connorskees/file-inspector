import React from "react";
import pako from 'pako';
import { Span } from "./buffer";
import { Chunk, CHUNK_DEFINITIONS, Png } from "./png";
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

function enumFormatter(en: Record<number, string>) {
    return (val: number) => `${en[val] ?? 'unrecognized value'} (${val})`;
}

const stringFormatter = (val: Span, png: Png) => {
    return png.buffer.stringForSpan(val)
};

const itxtTextFormatter = (val: Span, png: Png, chunk: Chunk) => {
    if (chunk.parsedData?.["compression_flag"] === 1) {
        const compressed = png.buffer.bytesForSpan(val);
        const decompressed = pako.inflate(compressed);
        return <HiddenBuffer buffer={bufferToString(decompressed)} />
    }

    return png.buffer.stringForSpan(val)
};

const itxtCompressionMethodFormatter = (val: number, _png: Png, chunk: Chunk) => {
    if (chunk.parsedData?.["compression_flag"] === 1) {
        return enumFormatter({ 0: "deflate" })(val)
    }
    return enumFormatter({ 0: "none" })(val)
};

const sbitFormatter = (val: Span, png: Png) => {
    const buffer = new DataView(png.buffer.bytesForSpan(val));
    const ihdr = png.chunks.find(c => c.name() === 'IHDR');
    switch (ihdr?.parsedData?.["color_type"]) {
        case ColorType.grayscale: {
            return `${buffer.getUint8(0)} (gray)`;
        }
        case ColorType.rgb:
        case ColorType.palette: {
            return `${buffer.getUint8(0)} (red), ${buffer.getUint8(1)} (green), ${buffer.getUint8(2)} (blue)`;
        }
        case ColorType.grayscale_alpha: {
            return `${buffer.getUint8(0)} (gray), ${buffer.getUint8(1)} (alpha)`;
        }
        case ColorType.rgba: {
            return `${buffer.getUint8(0)} (red), ${buffer.getUint8(1)} (green), ${buffer.getUint8(2)} (blue), ${buffer.getUint8(3)} (alpha)`;
        }
        default: {
            return `invalid color type ${ihdr?.parsedData?.["color_type"]}. buffer: ${new Uint8Array(buffer.buffer)}`
        }

    }
};

const trnsFormatter = (val: Span, png: Png) => {
    const buffer = new DataView(png.buffer.bytesForSpan(val));
    const ihdr = png.chunks.find(c => c.name() === 'IHDR');
    switch (ihdr?.parsedData?.["color_type"]) {
        case ColorType.grayscale: {
            const gray = buffer.getUint16(0);
            return <ColorPreview
                color={`rgb(${gray}, ${gray}, ${gray})`}
                name={`${gray} (grayscale)`}
            />
        }
        case ColorType.rgb: {
            const red = buffer.getUint16(0);
            const green = buffer.getUint16(2);
            const blue = buffer.getUint16(4);
            return <ColorPreview
                color={`rgb(${red}, ${green}, ${blue})`}
                name={`${red}, ${green}, ${blue}`}
            />
        }
        case ColorType.palette: {
            return `(palette index) ${new Uint8Array(buffer.buffer).join(', ')}`;
        }
        default: {
            return `invalid color type ${ihdr?.parsedData?.["color_type"]}. raw bytes: ${new Uint8Array(buffer.buffer)}`
        }

    }
};

const bkgdFormatter = (val: Span, png: Png) => {
    const buffer = new DataView(png.buffer.bytesForSpan(val));
    const ihdr = png.chunks.find(c => c.name() === 'IHDR');
    switch (ihdr?.parsedData?.["color_type"]) {
        case ColorType.grayscale:
        case ColorType.grayscale_alpha: {
            const gray = buffer.getUint16(0);
            return <ColorPreview
                color={`rgb(${gray}, ${gray}, ${gray})`}
                name={`${gray} (grayscale)`}
            />
        }
        case ColorType.rgb:
        case ColorType.rgba: {
            const red = buffer.getUint16(0);
            const green = buffer.getUint16(2);
            const blue = buffer.getUint16(4);
            return <ColorPreview
                color={`rgb(${red}, ${green}, ${blue})`}
                name={`${red}, ${green}, ${blue}`}
            />
        }
        case ColorType.palette: {
            const plte = png.chunks.find(c => c.name() === 'PLTE')
            const paletteIndex = buffer.getUint8(0);
            if (!plte || !plte.parsedData) {
                return `invalid/missing PLTE chunk. ${paletteIndex} (palette index)`;
            }
            const plteBuffer = new DataView(png.buffer.bytesForSpan(plte.parsedData?.["colors"] as Span));
            const red = plteBuffer.getUint8(paletteIndex * 3);
            const green = plteBuffer.getUint8(paletteIndex * 3 + 1);
            const blue = plteBuffer.getUint8(paletteIndex * 3 + 2);
            return <ColorPreview
                color={`rgb(${red}, ${green}, ${blue})`}
                name={`${red}, ${green}, ${blue}; ${paletteIndex} (palette index)`}
            />
        }
        default: {
            return `invalid color type ${ihdr?.parsedData?.["color_type"]}. raw bytes: ${new Uint8Array(buffer.buffer)}`
        }
    }
};

export function ColorPreview({ color, name }: { color: string; name: string }) {
    return <div style={{ display: 'flex', alignItems: 'center', fontFamily: "monospace" }}>
        <div style={{ width: 8, height: 8, background: color, marginRight: 8 }}></div>
        {name}
    </div>
}

function plteFormatter(val: Span, png: Png) {
    const buffer = new DataView(png.buffer.bytesForSpan(val));
    const pixels = []

    for (let i = 0; i < buffer.byteLength; i += 3) {
        const red = buffer.getUint8(i);
        const green = buffer.getUint8(i + 1);
        const blue = buffer.getUint8(i + 2);

        pixels.push({ red, green, blue })
    }

    const colors = pixels.map(({ red, green, blue }) =>
        <ColorPreview
            color={`rgb(${red}, ${green}, ${blue})`}
            name={`${red}, ${green}, ${blue}`}
        />
    );

    if (colors.length > 15) {
        return <HiddenBuffer buffer={colors} />
    }

    return <>{colors}</>;
}

const ORIENTATION: Record<number, string> = {
    1: "default",
    2: "flipped horizontally",
    3: "rotated 180 degrees",
    4: "flipped vertically",
    5: "rotated 90 degrees clockwise, then flipped horizontally",
    6: "rotated 90 degrees clockwise",
    7: "rotated 270 degrees clockwise, then flipped horizontally",
    8: "rotated 270 degrees clockwise",
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
        value = enumFormatter(ORIENTATION)(field.value as number);
    }

    if (field.name === "Exif.Photo.UserComment" && Array.isArray(field.value)) {
        value = bufferToString(field.value as number[]);
    }

    if (field.name === "Exif.Photo.ExifVersion" && Array.isArray(field.value)) {
        value = bufferToString(field.value as number[]);
    }

    if (field.name === "Exif.Photo.FlashpixVersion" && Array.isArray(field.value)) {
        value = bufferToString(field.value as number[]);
    }

    return <div>
        <span style={{ fontWeight: 600 }}>{(field.name && fmtName(field.name)) ?? `unrecognized field ${field.tag}`}</span>: {value}
    </div>
}

const exifFormatter = (val: Span, png: Png) => {
    const buffer = png.buffer.bytesForSpan(val);
    const parser = new ExifParser(new Uint8Array(buffer));
    const { fields } = parser.parse()

    return <HiddenBuffer buffer={fields.map((field) => {
        return <ExifValue field={field} />
    })} />
};

const iccFormatter = (val: Span, png: Png) => {
    const compressed = png.buffer.bytesForSpan(val);
    const decompressed = pako.inflate(compressed);
    const parsed = iccParse(new DataView(decompressed.buffer));

    return <HiddenBuffer buffer={Object.entries(parsed).map(([key, value]) => {
        return <div>
            <span style={{ fontWeight: 600 }}>{key}</span>: {value}
        </div>
    })} />
};


const bufferFormatter = (val: Span, png: Png) => {
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

const textDecoder = new TextDecoder("utf-8");

function bufferToString(buffer: Uint8Array | number[]): string {
    return textDecoder.decode(new Uint8Array(buffer));
}

const compressedStringFormatter = (val: Span, png: Png) => {
    const compressed = png.buffer.bytesForSpan(val);
    const decompressed = pako.inflate(compressed);
    return <HiddenBuffer buffer={bufferToString(decompressed)} />
};

type DisplayFunc = (val: any, png: Png, chunk: Chunk) => React.ReactNode

// typeof CHUNK_DEFINITIONS[k][m]
const CHUNK_DISPLAY_DEFINITIONS: Partial<{ [k in keyof typeof CHUNK_DEFINITIONS]:
    Partial<{
        [m in keyof typeof CHUNK_DEFINITIONS[k]]: DisplayFunc
    }>
}> = {
    IHDR: {
        width: (val) => `${val}px`,
        height: (val) => `${val}px`,
        interlace_method: enumFormatter(InterlaceMethod),
        compression_method: enumFormatter({ 0: "deflate" }),
        filter_method: enumFormatter({ 0: "adaptive" }),
        color_type: enumFormatter(ColorType),
    },
    pHYs: {
        pixels_per_unit_x_axis: (val) => `${val}px`,
        pixels_per_unit_y_axis: (val) => `${val}px`,
        unit_specifier: enumFormatter(UnitSpecifier),
    },
    IDAT: {
        buffer: bufferFormatter
    },
    tEXt: {
        keyword: stringFormatter,
        text: stringFormatter
    },
    iCCP: {
        profile_name: stringFormatter,
        compression_method: enumFormatter({ 0: "deflate" }),
        compressed_profile: iccFormatter,
    },
    zTXt: {
        keyword: stringFormatter,
        compression_method: enumFormatter({ 0: "deflate" }),
        compressed_text: compressedStringFormatter,
    },
    eXIf: {
        buffer: exifFormatter,
    },
    sRGB: {
        rendering_intent: enumFormatter(RenderingIntent),
    },
    iTXt: {
        keyword: stringFormatter,
        compression_flag: enumFormatter({ 0: "uncompressed", 1: "compressed" }),
        compression_method: itxtCompressionMethodFormatter,
        language_tag: stringFormatter,
        translated_keyword: stringFormatter,
        text: itxtTextFormatter,
    },
    orNT: {
        orientation: enumFormatter(ORIENTATION)
    },
    PLTE: {
        colors: plteFormatter,
    },
    sBIT: {
        significant_bits: sbitFormatter,
    },
    bKGD: {
        background: bkgdFormatter
    },
    tRNS: {
        transparent_color: trnsFormatter,
    },
    oFFs: {
        unit: enumFormatter({ 0: "pixels", 1: "micrometers" }),
    }

};

const UNTYPED_CHUNK_DISPLAY_DEFINITIONS = CHUNK_DISPLAY_DEFINITIONS as Record<string, Record<string, DisplayFunc>>;

export function getDisplayFunc(chunkName: string, field: string): DisplayFunc | undefined {
    return UNTYPED_CHUNK_DISPLAY_DEFINITIONS[chunkName]?.[field]
}