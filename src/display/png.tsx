import React from "react";
import pako from 'pako';
import { bufferToString, Span } from "../parse/buffer";
import { Chunk, CHUNK_DEFINITIONS, Png } from "../parse/png";
import { ExifParser } from "../parse/exif";
import { parse as iccParse } from '../parse/iccp';
import { ExifValue, ORIENTATION } from "./exif";
import { enumFormatter } from "./shared";
import { BufferFormatter, HiddenBuffer, ColorPreview } from './shared';

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


const exifFormatter = (val: Span, png: Png) => {
    const buffer = png.buffer.bytesForSpan(val);
    const parser = new ExifParser(new Uint8Array(buffer));
    const { fields } = parser.parse()

    if (fields.length === 0) {
        return <>(empty)</>
    }

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
    return <BufferFormatter span={val} _buffer={png.buffer} />
};

const compressedStringFormatter = (val: Span, png: Png) => {
    const compressed = png.buffer.bytesForSpan(val);
    const decompressed = pako.inflate(compressed);
    return <HiddenBuffer buffer={bufferToString(decompressed)} />
};

type DisplayFunc = (val: any, png: Png, chunk: Chunk) => React.ReactNode

interface ChunkDataFieldProps {
    png: Png,
    chunk: Chunk;
    fieldName: string;
    data: any;
}

export function ChunkDataField({ png, chunk, fieldName, data }: ChunkDataFieldProps) {
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

export function PngDisplayer({ png }: { png: Png }) {
    const idatChunks = png.chunks.filter(chunk => chunk.name() === 'IDAT');
    const nonIdatChunks = png.chunks.filter(chunk => chunk.name() !== 'IDAT');

    const [idatExpanded, setIdatExpanded] = React.useState(false)

    const chunks = idatChunks && idatChunks?.length > 3 ? nonIdatChunks : png.chunks;

    return <div>
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
    </div>
}

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