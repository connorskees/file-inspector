import { BufferParser, Span, BitParser } from "./buffer";
import { ChunkFieldKind } from "./png";

export class Gif {
    constructor(
        public header: Span,
        public logicalScreenDescriptor: LogicalScreenDescriptor,
        public globalColorTable: GlobalColorTable | null,
        public images: Image[],
        public buffer: BufferParser,
    ) { }
}


interface ImageDescriptor {
    left: number;
    top: number;
    width: number;
    height: number;
    bitflags: number;
}

interface Image {
    extensions: any[]
    descriptor: ImageDescriptor,
    minCodeSize: number;
    data: Uint8Array,
}

export class GifImageDecoder {
    public buffer: BufferParser;
    constructor(public gif: Gif, public image: Image) {
        this.buffer = new BufferParser(new Uint8Array(image.data));
    }

    /**
     * Returns the color indices, rather than the pixels themselves, to save
     * memory
     */
    public decode(): number[] {
        if (!this.gif.globalColorTable) {
            return []
        }

        const input = new BitParser(this.image.data)
        console.log({ b: input.buffer.length, buf: input.buffer })

        if (input.buffer.length === 0) {
            console.log('empty bitmap')
            return []
        }

        let width = this.image.minCodeSize + 1;
        const origWidth = width

        const nextCode = () => input.readNBits(Math.min(width, 12))

        // code to elements
        let codeTable: number[][] = []

        // out array
        let indexStream: number[] = []

        const clearCode = nextCode();
        const endCode = clearCode + 1

        console.log({ clearCode })

        let prevCode: number = -1;
        let code = clearCode

        while (code !== endCode) {
            if (code === clearCode) {
                console.log('clear!', { width })
                codeTable = []

                for (let i = 0; i <= endCode; i += 1) {
                    codeTable[i] = [i];
                }

                width = origWidth;

                const firstCode = nextCode()!;
                indexStream.push(firstCode)
                prevCode = firstCode;
                code = nextCode()
                continue
            }

            if (code < codeTable.length) {
                // output {CODE} to index stream
                // let K be the first index in {CODE}
                // add {CODE-1}+K to the code table
                indexStream.push(...codeTable[code])
                let k = codeTable[code][0];
                codeTable.push([...codeTable[prevCode], k])
            } else {
                // let K be the first index of {CODE-1}
                // output {CODE-1}+K to index stream
                // add {CODE-1}+K to code table
                let k = codeTable[prevCode][0];
                const arr = [...codeTable[prevCode], k]
                indexStream.push(...arr)
                codeTable.push(arr)
            }

            if (codeTable.length === Math.pow(2, width)) {
                console.log('widen')
                width += 1
            }

            prevCode = code;
            code = nextCode();
        }

        if (!input.atEnd()) {
            throw new Error(`end code not at end ${input.buffer.length} ${input.cursor}`)
        }

        return indexStream
    }
}

function mergeUint8Arrays(a: Uint8Array, b: Uint8Array) {
    const mergedArray = new Uint8Array(a.length + b.length);
    mergedArray.set(a);
    mergedArray.set(b, a.length);
    return mergedArray;
}

export class GifParser {
    private buffer: BufferParser;
    constructor(_buffer: Uint8Array) {
        this.buffer = new BufferParser(_buffer, true)
    }

    public parse(): Gif {
        const header = this.buffer.getSpan(6);
        const logicalScreenDescriptor = this.parseLogicalScreenDescriptor();
        const globalColorTable = this.parseGlobalColorTable(logicalScreenDescriptor);

        const images: Image[] = []

        console.log({ logicalScreenDescriptor, globalColorTable })

        while (this.buffer.peek() !== 0x3b) {
            const extensions = []
            while (this.buffer.peek() === 0x21) {
                extensions.push(this.parseExtension());
            }
            const descriptor = this.parseImageDescriptor();
            const minCodeSize = this.buffer.next();
            let data = new Uint8Array()
            console.log({ images, extensions })
            while (this.buffer.peek() !== 0) {
                const len = this.buffer.next();
                const bytes = this.buffer.bytesForSpan(this.buffer.getSpan(len))
                data = mergeUint8Arrays(data, new Uint8Array(bytes));
            }
            this.buffer.next();
            images.push({ extensions, descriptor, minCodeSize, data });
        }

        // skip trailer
        this.buffer.next();

        if (!this.buffer.atEnd()) {
            throw new Error('unexpected trailer byte')
        }

        return new Gif(
            header,
            logicalScreenDescriptor,
            globalColorTable,
            images,
            this.buffer,
        )
    }

    private parseImageDescriptor() {
        this.buffer.next();
        const left = this.buffer.readU16()
        const top = this.buffer.readU16()
        const width = this.buffer.readU16()
        const height = this.buffer.readU16()
        const bitflags = this.buffer.next()

        return {
            left,
            top,
            width,
            height,
            bitflags
        }
    }

    private parseLogicalScreenDescriptor(): LogicalScreenDescriptor {
        const start = this.buffer.index;
        const width = this.buffer.readU16();
        const height = this.buffer.readU16();
        const descriptor = this.buffer.next();
        const background_color_index = this.buffer.next();
        const pixel_aspect_ratio = this.buffer.next();
        const end = this.buffer.index;

        return new LogicalScreenDescriptor(width, height, descriptor, background_color_index, pixel_aspect_ratio, { start, end })
    }

    private parseGlobalColorTable(descriptor: LogicalScreenDescriptor): GlobalColorTable | null {
        if (!descriptor.hasGlobalColorTable()) {
            return null;
        }

        const span = this.buffer.getSpan(descriptor.globalColorTableNumBytes());

        const bytes = new DataView(this.buffer.bytesForSpan(span))
        if (bytes.byteLength % 3 !== 0) {
            throw new Error('invalid global color table length: ' + bytes.byteLength)
        }

        const colors: [number, number, number][] = []

        for (let i = 0; i < bytes.byteLength; i += 3) {
            const color: [number, number, number] = [bytes.getUint8(i), bytes.getUint8(i + 1), bytes.getUint8(i + 2)]
            colors.push(color)
        }

        return { colors, span }
    }

    private parseExtension() {
        // skip introducer
        this.buffer.next();
        const label = this.buffer.next();
        switch (label) {
            case 0x01:
                return this.parsePlainTextExtension();
            case 0xf9:
                return this.parseGce();
            case 0xff:
                return this.parseApplicationExtension()
            case 0xfe:
                return this.parseCommentExtension()
        }
    }

    private parsePlainTextExtension() {
        throw new Error('parsePlainTextExtension')
    }

    private parseApplicationExtension() {
        const netscape = this.buffer.getSpan("NETSCAPE".length)
        const version = this.buffer.getSpan("2.0".length)
        const length = this.buffer.next();
        const index = this.buffer.next();
        const numExecutions = this.buffer.readU16();
        const terminator = this.buffer.readU16();

        return {
            netscape,
            version,
            length,
            index,
            numExecutions,
            terminator
        }
    }

    private parseCommentExtension() {
        let data = new Uint8Array()
        while (this.buffer.peek() !== 0) {
            const len = this.buffer.next();
            const bytes = this.buffer.bytesForSpan(this.buffer.getSpan(len))
            data = mergeUint8Arrays(data, new Uint8Array(bytes));
        }
        this.buffer.next();

        return { data }
    }

    private parseGce() {
        const byteSize = this.buffer.next();
        const bitFlags = this.buffer.next();
        const delayTime = this.buffer.readU16();
        const transparentColorIndex = this.buffer.next();
        const blockTerminator = this.buffer.next();

        return {
            byteSize,
            bitFlags,
            delayTime,
            transparentColorIndex,
            blockTerminator,
        }
    }
}

export interface GlobalColorTable {
    span: Span,
    colors: [number, number, number][],
}

export class LogicalScreenDescriptor {
    constructor(
        public width: number,
        public height: number,
        public descriptor: number,
        public background_color_index: number,
        public pixel_aspect_ratio: number,
        public span: Span,
    ) { }

    globalColorTableNumBytes() {
        return 3 * Math.pow(2, this.colorResolution() + 1)
    }

    globalColorTableSize() {
        return this.descriptor & 0b111;
    }

    hasGlobalColorTable() {
        return (this.descriptor >> 7) === 1;
    }

    /**
     * If the values is 1, then the colors in the global color table are sorted
     * in order of "decreasing importance," which typically means "decreasing
     * frequency" in the image. This can help the image decoder, but is not
     * required.
     */
    sorted() {
        return ((this.descriptor >> 3) & 0b1) === 1;
    }

    /**
     * Only meaningful if there is a global color table, and allows you to compute
     * its size.
     * 
     * If the value of this field is N, the number of entries in the global color
     * table will be 2 ^ (N+1) - that is, two raised to the power (N+1). Thus, 001
     * represents 2 bits/pixel; 111 would represent 8 bits/pixel
     */
    colorResolution() {
        return (this.descriptor >> 4) & 0b111;
    }
}

const OBJECT_DEFINITIONS = {
    "Logical Screen Descriptor": {
        width: ChunkFieldKind.U16,
        height: ChunkFieldKind.U16,
        descriptor: ChunkFieldKind.U8,
        background_color_index: ChunkFieldKind.U8,
        pixel_aspect_ratio: ChunkFieldKind.U8,
    },
    "Graphics Content Extension": {
        byte_size: ChunkFieldKind.U8,
        bit_flags: ChunkFieldKind.U8,
        delay_time: ChunkFieldKind.U16,
        transparent_color_index: ChunkFieldKind.U8,
        block_terminator: ChunkFieldKind.U8,
    }
}