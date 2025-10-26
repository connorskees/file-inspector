import { BufferParser, Span, Spanned } from "./buffer";

interface BmpHeader extends Spanned {
    signature: Span,
    file_size: number,
    reserved: number,
    data_offset: number,
}

interface BmpInfoHeader extends Spanned {
    info_header_size: number,
    width: number,
    height: number,
    planes: number,
    bits_per_pixel: number,
    compression_method: number,
    compressed_image_size: number,
    x_pixels_per_m: number,
    y_pixels_per_m: number,
    colors_used: number,
    important_colors: number,
}

// https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-bitmapv5header
interface BmpV5Header extends Spanned {
    info_header_size: number
    width: number
    height: number
    planes: number
    bits_per_pixel: number
    compression_method: number
    compressed_image_size: number
    x_pixels_per_m: number
    y_pixels_per_m: number
    colors_used: number
    important_colors: number
    red_mask: number
    green_mask: number
    blue_mask: number
    alpha_mask: number
    color_space: Span
    endpoints: number[][] // [[x, y, z], [x, y, z], [x, y, z]]
    gamma_red: number
    gamma_green: number
    gamma_blue: number
    rendering_intent: number
    profile_data: number
    profile_size: number
    reserved: number
}

interface BmpColorTable extends Spanned {
    colors: [number, number, number, number][],
}

export interface Bmp {
    header: BmpHeader,
    dib: BmpInfoHeader | BmpV5Header,
    color_table: BmpColorTable | null,
    pixels: Span,
    buffer: BufferParser,
}

export class BmpParser {
    private buffer: BufferParser;
    constructor(_buffer: Uint8Array) {
        this.buffer = new BufferParser(_buffer, true)
    }

    public parse(): Bmp {
        const header = this.parseHeader();

        const dib = this.parseDibHeader();

        let color_table = null;

        if (dib.bits_per_pixel === 4 || dib.bits_per_pixel === 8) {
            color_table = this.parseColorTable(dib.colors_used * 4);
        }

        this.buffer.index = header.data_offset;

        const pixels = this.buffer.getSpanToEnd()

        return { header, dib, color_table, pixels, buffer: this.buffer }
    }

    private parseHeader(): BmpHeader {
        const start = this.buffer.index;
        const signature = this.buffer.getSpan(2);
        const file_size = this.buffer.readU32();
        const reserved = this.buffer.readU32();
        const data_offset = this.buffer.readU32();
        const end = this.buffer.index;

        return { signature, file_size, reserved, data_offset, span: { start, end } }
    }

    private parseDibHeader() {
        const start = this.buffer.index;
        const info_header_size = this.buffer.readU32()

        switch (info_header_size) {
            case 124:
                return this.parseV5Header(start, info_header_size);
            case 40:
            default:
                return this.parseInfoHeader(start, info_header_size);
        }
    }

    private parseV5Header(start: number, info_header_size: number): BmpV5Header {
        const width = this.buffer.readU32()
        const height = this.buffer.readU32()
        const planes = this.buffer.readU16()
        const bits_per_pixel = this.buffer.readU16()
        const compression_method = this.buffer.readU32()
        const compressed_image_size = this.buffer.readU32()
        const x_pixels_per_m = this.buffer.readU32()
        const y_pixels_per_m = this.buffer.readU32()
        const colors_used = this.buffer.readU32()
        const important_colors = this.buffer.readU32()
        const red_mask = this.buffer.readU32()
        const green_mask = this.buffer.readU32()
        const blue_mask = this.buffer.readU32()
        const alpha_mask = this.buffer.readU32()
        const color_space = this.buffer.getSpan(4)
        const endpoints = [
            [this.buffer.readU32(), this.buffer.readU32(), this.buffer.readU32()],
            [this.buffer.readU32(), this.buffer.readU32(), this.buffer.readU32()],
            [this.buffer.readU32(), this.buffer.readU32(), this.buffer.readU32()],
        ]
        const gamma_red = this.buffer.readU32()
        const gamma_green = this.buffer.readU32()
        const gamma_blue = this.buffer.readU32()
        const rendering_intent = this.buffer.readU32()
        const profile_data = this.buffer.readU32()
        const profile_size = this.buffer.readU32()
        const reserved = this.buffer.readU32()
        const end = this.buffer.index;

        return {
            info_header_size,
            width,
            height,
            planes,
            bits_per_pixel,
            compression_method,
            compressed_image_size,
            x_pixels_per_m,
            y_pixels_per_m,
            colors_used,
            important_colors,
            red_mask,
            green_mask,
            blue_mask,
            alpha_mask,
            color_space,
            endpoints,
            gamma_red,
            gamma_green,
            gamma_blue,
            rendering_intent,
            profile_data,
            profile_size,
            reserved,
            span: { start, end },
        }
    }

    private parseInfoHeader(start: number, info_header_size: number): BmpInfoHeader {
        const width = this.buffer.readU32();
        const height = this.buffer.readU32();
        const planes = this.buffer.readU16();
        const bits_per_pixel = this.buffer.readU16();
        const compression_method = this.buffer.readU32();
        const compressed_image_size = this.buffer.readU32();
        const x_pixels_per_m = this.buffer.readU32();
        const y_pixels_per_m = this.buffer.readU32();
        const colors_used = this.buffer.readU32();
        const important_colors = this.buffer.readU32();
        const end = this.buffer.index;

        return {
            info_header_size,
            width,
            height,
            planes,
            bits_per_pixel,
            compression_method,
            compressed_image_size,
            x_pixels_per_m,
            y_pixels_per_m,
            colors_used,
            important_colors,
            span: { start, end },
        }
    }

    private parseColorTable(len: number): BmpColorTable {
        const span = this.buffer.getSpan(len)
        const bytes = new DataView(this.buffer.bytesForSpan(span))

        if (bytes.byteLength % 4 !== 0) {
            throw new Error('invalid global color table length: ' + bytes.byteLength)
        }

        const colors: [number, number, number, number][] = []

        for (let i = 0; i < bytes.byteLength; i += 4) {
            const color: [number, number, number, number] = [
                bytes.getUint8(i + 2),
                bytes.getUint8(i + 1),
                bytes.getUint8(i),
                bytes.getUint8(i + 3),
            ]
            colors.push(color)
        }

        return { span, colors }
    }
}