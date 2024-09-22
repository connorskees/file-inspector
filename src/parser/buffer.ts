export interface Span {
    start: number,
    end: number,
}

const textDecoder = new TextDecoder("utf-8");

export class BufferParser {
    private buffer: DataView;
    constructor(_buffer: Uint8Array, public index = 0) {
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
        const b = this.buffer.getUint16(this.index);
        this.index += 2;
        return b;
    }

    readU32(): number {
        const b = this.buffer.getUint32(this.index);
        this.index += 4;
        return b;
    }

    readI32(): number {
        const b = this.buffer.getInt32(this.index);
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
}
