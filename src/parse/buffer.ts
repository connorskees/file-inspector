export interface Span {
    start: number,
    end: number,
}

const textDecoder = new TextDecoder("utf-8");

export function bufferToString(buffer: Uint8Array | number[] | ArrayBufferLike): string {
    return textDecoder.decode(new Uint8Array(buffer));
}

export class BufferParser {
    public buffer: DataView;
    constructor(_buffer: Uint8Array, public littleEndian: boolean = false, public index = 0) {
        this.buffer = new DataView(_buffer.buffer)
    }

    atEnd(): boolean {
        return this.buffer.byteLength === this.index;
    }

    next(): number {
        const b = this.buffer.getUint8(this.index);
        this.index += 1;
        return b;
    }

    peek(): number | null {
        if (this.index > this.buffer.byteLength) {
            return null
        }

        return this.buffer.getUint8(this.index);
    }

    expectByte(b: number): void {
        const found = this.next();
        if (b != found) {
            throw new Error(`expected ${b}, found ${found}`);
        }
    }

    expectBytes(bytes: number[]): void {
        for (const b of bytes) {
            this.expectByte(b);
        }
    }

    readU16(): number {
        const b = this.buffer.getUint16(this.index, this.littleEndian);
        this.index += 2;
        return b;
    }

    readU32(): number {
        const b = this.buffer.getUint32(this.index, this.littleEndian);
        this.index += 4;
        return b;
    }

    readI32(): number {
        const b = this.buffer.getInt32(this.index, this.littleEndian);
        this.index += 4;
        return b;
    }

    readNullTerminatedString(): Span {
        const start = this.index;
        while (this.buffer.getInt8(this.index) !== 0) {
            this.index += 1;
        }
        this.index += 1;
        return { start, end: this.index }
    }

    stringForSpan(span: Span) {
        return textDecoder.decode(this.bytesForSpan(span));
    }

    bytesForSpan(span: Span) {
        return this.buffer.buffer.slice(span.start, span.end);
    }

    getSpan(length: number): Span {
        const start = this.index;
        const end = this.index + length;
        this.index = end;

        if (end > this.buffer.byteLength) {
            throw new Error('unexpected EOF')
        }

        return { start, end }
    }

    getSpanTo(end: number): Span {
        const start = this.index;
        this.index = end;

        if (end > this.buffer.byteLength) {
            throw new Error('unexpected EOF')
        }

        return { start, end }
    }

    consumeIfEquals(bytes: number[]): boolean {
        if (bytes.length + this.index >= this.buffer.byteLength) {
            return false;
        }

        for (let i = 0; i < bytes.length; i += 1) {
            if (bytes[i] !== this.buffer.getUint8(this.index + i)) {
                return false;
            }
        }

        this.index += bytes.length;

        return true;
    }
}

export class BitParser {
    constructor(public buffer: Uint8Array, public cursor = 0) { }

    atEnd(): boolean {
        const last = this.readNBits(this.buffer.byteLength * 8 - this.cursor)
        return last === 0;
    }

    readNBits(bits: number): number {
        let out = 0;
        for (let i = 0; i < bits; i += 1) {
            out |= this.readBit() << i;
        }

        return out;
    }

    readBit(): number {
        const byteIdx = Math.floor(this.cursor / 8);
        const bitIdx = this.cursor % 8;
        const byte = this.buffer[byteIdx];
        if (byte === undefined) {
            throw new Error('bit parser out of bounds')
        }
        this.cursor += 1
        return (byte >> bitIdx) & 1
    }
}

// const c = new BitParser(new Uint8Array([0b0000_0100, 0b0000_0100]))
// console.log({ c, a: c.readNBits(16), b: c.readNBits(0) })

