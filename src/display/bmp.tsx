import React from 'react'
import { BufferFormatter, enumFormatter, byteLengthFormatter, ImageChunkRow, stringFormatter, pxFormatter, ColorTableDisplayer, hexFormatter, littleEndianStringFormatter } from './shared';
import { Bmp } from '../parse/bmp';

const COMPRESSION_METHOD = {
    0: "uncompressed",
    1: "8 bit run length encoding",
    2: "4 bit run length encoding",
    3: "uncompressed with bitmasks",
    4: "JPEG compression",
    5: "PNG compression",
    6: "uncompressed with RGBA bitmasks",
    11: "CMYK",
    12: "CMYK 8 bit run length encoding",
    13: "CMYK 4 bit run length encoding",
}

const HEADER_TYPE = {
    12: "BITMAPCOREHEADER",
    64: "OS22XBITMAPHEADER",
    16: "OS22XBITMAPHEADER",
    40: "BITMAPINFOHEADER",
    52: "BITMAPV2INFOHEADER",
    56: "BITMAPV3INFOHEADER",
    108: "BITMAPV4HEADER",
    124: "BITMAPV5HEADER",
}

const RENDERING_INTENT = {
    0: "Absolute colorimetric",
    1: "Saturation",
    2: "Relative colorimetric",
    3: "Perceptual",
}

const JSON_FORMATTER_OVERRIDES: Record<string, (v: any, bmp: Bmp) => React.ReactNode> = {
    signature: stringFormatter,
    file_size: byteLengthFormatter,
    data_offset: byteLengthFormatter,
    info_header_size: enumFormatter(HEADER_TYPE),
    width: pxFormatter,
    height: pxFormatter,
    x_pixels_per_m: pxFormatter,
    y_pixels_per_m: pxFormatter,
    compression_method: enumFormatter(COMPRESSION_METHOD),
    compressed_image_size: byteLengthFormatter,
    red_mask: hexFormatter,
    blue_mask: hexFormatter,
    green_mask: hexFormatter,
    alpha_mask: hexFormatter,
    color_space: littleEndianStringFormatter,
    colors_used: (v: number) => v === 0 ? "see bits_per_pixel (0)" : v.toString(),
    important_colors: (v: number) => v === 0 ? "all (0)" : v.toString(),
    rendering_intent: enumFormatter(RENDERING_INTENT),
}

function JsonDisplayer({ fields, bmp }: { fields: object, bmp: Bmp }) {
    return Object.entries(fields).filter(([key, _]) => key !== 'span').map(([key, value]) => {
        let data;
        const displayFunc = JSON_FORMATTER_OVERRIDES[key];
        if (displayFunc) {
            data = displayFunc(value, bmp);
        } else {
            data = JSON.stringify(value)
        }

        return <div style={{ marginBottom: 8 }} key={key}>
            <span style={{ fontWeight: 600 }}>{key}</span>: {data}
        </div>
    })
}

export function BmpDisplayer({ bmp }: { bmp: Bmp }) {
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

                    <ImageChunkRow title="Header" span={bmp.header.span} body={<JsonDisplayer fields={bmp.header} bmp={bmp} />} file={bmp} />
                    <ImageChunkRow title="DIB Header" span={bmp.dib.span} body={<JsonDisplayer fields={bmp.dib} bmp={bmp} />} file={bmp} />
                    {bmp.color_table && <ColorTableDisplayer title="Color Table" file={bmp} table={bmp.color_table} />}
                    <ImageChunkRow title="Pixel Data" hideRawBytes span={bmp.pixels} body={<BufferFormatter _buffer={bmp.buffer} span={bmp.pixels} />} file={bmp} />
                </tbody >
            </table>
        </div>
    </>
}
