import { BufferParser, Span, BitParser } from "./buffer";

interface Spanned {
    span: Span;
}

export interface Gif {
    header: Span,
    logicalScreenDescriptor: LogicalScreenDescriptor,
    globalColorTable: ColorTable | null,
    images: Image[],
    buffer: BufferParser,
}

interface ImageDescriptor extends Spanned {
    left: number;
    top: number;
    width: number;
    height: number;
    bitflags: number;
}

interface ApplicationExtension extends Spanned {
    kind: "application";
    netscape: Span;
    version: Span;
    length: number;
    index: number;
    numExecutions: number;
    terminator: number;
}
interface GraphicsControlExtension extends Spanned {
    kind: "graphics";
    byteSize: number
    bitFlags: number
    delayTime: number
    transparentColorIndex: number
    blockTerminator: number
}
interface CommentExtension extends Spanned {
    kind: "comment";
    data: Uint8Array
}
interface PlainTextExtension extends Spanned {
    kind: "plain";
    numBytesToSkip: number;
    skippedBytes: Span;
    data: Uint8Array
}

export type Extension = ApplicationExtension | GraphicsControlExtension | CommentExtension | PlainTextExtension

export interface Image extends Spanned {
    localColorTable: ColorTable | undefined;
    extensions: Extension[]
    descriptor: ImageDescriptor,
    minCodeSize: number;
    data: Uint8Array,
}


export interface ColorTable extends Spanned {
    colors: [number, number, number][],
}

export class LogicalScreenDescriptor implements Spanned {
    public hasGlobalColorTable: boolean;
    /**
     * If the values is 1, then the colors in the global color table are sorted
     * in order of "decreasing importance," which typically means "decreasing
     * frequency" in the image. This can help the image decoder, but is not
     * required.
     */
    public sorted: boolean;
    public globalColorTableSize: number;
    /**
     * Only meaningful if there is a global color table, and allows you to compute
     * its size.
     * 
     * If the value of this field is N, the number of entries in the global color
     * table will be 2 ^ (N+1) - that is, two raised to the power (N+1). Thus, 001
     * represents 2 bits/pixel; 111 would represent 8 bits/pixel
     */
    public colorResolution: number;
    constructor(
        public width: number,
        public height: number,
        public descriptor: number,
        public background_color_index: number,
        public pixel_aspect_ratio: number,
        public span: Span,
    ) {
        this.hasGlobalColorTable = (this.descriptor >> 7) === 1;
        this.sorted = ((this.descriptor >> 3) & 0b1) === 1;
        this.globalColorTableSize = this.descriptor & 0b111;
        this.colorResolution = (this.descriptor >> 4) & 0b111;
    }

    globalColorTableNumBytes() {
        return 3 * Math.pow(2, this.globalColorTableSize + 1)
    }
}

enum Constants {
    Trailer = 0x3b,
    ExtensionIntroducer = 0x21,
    PlainTextExtension = 0x01,
    GraphicsExtension = 0xf9,
    ApplicationExtension = 0xff,
    CommentExtension = 0xfe,
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

        const MAX_LWZ_CODE_WIDTH = 12

        if (input.buffer.length === 0) {
            console.error('empty bitmap')
            return []
        }

        let width = this.image.minCodeSize + 1;
        const origWidth = width

        const nextCode = () => input.readNBits(Math.min(width, MAX_LWZ_CODE_WIDTH));

        // code to elements
        let codeTable: number[][] = []

        // out array
        let indexStream: number[] = []

        const clearCode = nextCode();
        const endCode = clearCode + 1

        let prevCode: number = -1;
        let code = clearCode

        while (code !== endCode) {
            if (code === clearCode) {
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

export function parseColorTableFromBytes(buffer: ArrayBuffer) {
    const bytes = new DataView(buffer)
    if (bytes.byteLength % 3 !== 0) {
        throw new Error('invalid global color table length: ' + bytes.byteLength)
    }

    const colors: [number, number, number][] = []

    for (let i = 0; i < bytes.byteLength; i += 3) {
        const color: [number, number, number] = [bytes.getUint8(i), bytes.getUint8(i + 1), bytes.getUint8(i + 2)]
        colors.push(color)
    }

    return colors
}

function mergeAllUint8Arrays(arrs: Uint8Array[]) {
    const length = arrs.reduce((prev, arr) => prev + arr.byteLength, 0)
    const mergedArray = new Uint8Array(length);
    let currLen = 0;
    for (const arr of arrs) {
        mergedArray.set(arr, currLen);
        currLen += arr.length;
    }
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

        while (this.buffer.peek() !== Constants.Trailer) {
            const extensions = []
            while (this.buffer.peek() === Constants.ExtensionIntroducer) {
                extensions.push(this.parseExtension());
            }
            const descriptor = this.parseImageDescriptor();
            let localColorTable;
            if (descriptor.hasLocalColorTable) {
                const localColorTableSpan = this.buffer.getSpan(3 * Math.pow(2, descriptor.localColorTableSize + 1))
                const colors = parseColorTableFromBytes(this.buffer.bytesForSpan(localColorTableSpan))
                localColorTable = { span: localColorTableSpan, colors }
            }
            const imageStart = this.buffer.index;
            const minCodeSize = this.buffer.next();
            const data = this.parseSubBlocks()
            const imageEnd = this.buffer.index;
            images.push({ extensions, descriptor, localColorTable, minCodeSize, data, span: { start: imageStart, end: imageEnd } });
        }

        // skip trailer
        this.buffer.next();

        if (!this.buffer.atEnd()) {
            throw new Error('unexpected trailer byte')
        }

        return {
            header,
            logicalScreenDescriptor,
            globalColorTable,
            images,
            buffer: this.buffer,
        }
    }

    private parseImageDescriptor() {
        const start = this.buffer.index;
        const magic = this.buffer.next();
        const left = this.buffer.readU16()
        const top = this.buffer.readU16()
        const width = this.buffer.readU16()
        const height = this.buffer.readU16()
        const bitflags = this.buffer.next()
        const end = this.buffer.index;

        const hasLocalColorTable = (bitflags >> 7) === 1
        const interlaced = ((bitflags >> 6) & 1) === 1
        const sorted = ((bitflags >> 5) & 1) === 1
        const reserved = (bitflags >> 3) & 0b11
        const localColorTableSize = bitflags & 0b111

        return {
            magic,
            left,
            top,
            width,
            height,
            bitflags,
            interlaced,
            sorted,
            reserved,
            hasLocalColorTable,
            localColorTableSize,
            span: { start, end }
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

    private parseGlobalColorTable(descriptor: LogicalScreenDescriptor): ColorTable | null {
        if (!descriptor.hasGlobalColorTable) {
            return null;
        }

        const span = this.buffer.getSpan(descriptor.globalColorTableNumBytes());
        const colors = parseColorTableFromBytes(this.buffer.bytesForSpan(span))

        return { colors, span }
    }

    private parseExtension(): Extension {
        // skip introducer
        this.buffer.next();
        const start = this.buffer.index;
        const label = this.buffer.next();
        switch (label) {
            case Constants.PlainTextExtension:
                return this.parsePlainTextExtension(start);
            case Constants.GraphicsExtension:
                return this.parseGce(start);
            case Constants.ApplicationExtension:
                return this.parseApplicationExtension(start)
            case Constants.CommentExtension:
                return this.parseCommentExtension(start)
            default:
                throw new Error('unexpected extension')
        }
    }

    private parsePlainTextExtension(start: number): PlainTextExtension {
        const numBytesToSkip = this.buffer.next();
        const skippedBytes = this.buffer.getSpan(numBytesToSkip);
        const data = this.parseSubBlocks();
        const end = this.buffer.index;

        return {
            kind: "plain",
            numBytesToSkip,
            skippedBytes,
            data,
            span: { start, end }
        }
    }

    private parseApplicationExtension(start: number): ApplicationExtension {
        const netscape = this.buffer.getSpan("NETSCAPE".length)
        const version = this.buffer.getSpan("2.0".length)
        const length = this.buffer.next();
        const index = this.buffer.next();
        const numExecutions = this.buffer.readU16();
        const terminator = this.buffer.readU16();
        const end = this.buffer.index;

        return {
            kind: "application",
            netscape,
            version,
            length,
            index,
            numExecutions,
            terminator,
            span: { start, end },
        }
    }

    private parseSubBlocks() {
        const blocks = []
        while (this.buffer.peek() !== 0) {
            const len = this.buffer.next();
            const bytes = this.buffer.bytesForSpan(this.buffer.getSpan(len))
            blocks.push(new Uint8Array(bytes));
        }
        this.buffer.next();
        return mergeAllUint8Arrays(blocks);
    }

    private parseCommentExtension(start: number): CommentExtension {
        const data = this.parseSubBlocks();
        const end = this.buffer.index

        return { kind: "comment", data, span: { start, end } }
    }

    private parseGce(start: number): GraphicsControlExtension {
        const byteSize = this.buffer.next();
        const bitFlags = this.buffer.next();
        const delayTime = this.buffer.readU16();
        const transparentColorIndex = this.buffer.next();
        const blockTerminator = this.buffer.next();
        const end = this.buffer.index

        return {
            kind: "graphics",
            byteSize,
            bitFlags,
            delayTime,
            transparentColorIndex,
            blockTerminator,
            span: { start, end }
        }
    }
}
