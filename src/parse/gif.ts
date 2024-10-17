import { BufferParser, Span, BitParser } from "./buffer";

interface Spanned {
    span: Span;
}

export interface Gif {
    header: Span,
    logicalScreenDescriptor: LogicalScreenDescriptor,
    globalColorTable: GifColorTable | null,
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
    applicationBlockLength: number;
    netscapeVersion: Span;
    index: number;
    numExecutions: number;
    terminator: number;
}

export interface GraphicsControlExtension extends Spanned {
    kind: "graphics";
    blockSize: number
    bitflags: number
    reserved: number
    disposalMethod: number
    shouldWaitForUserInput: boolean
    hasTransparentColor: boolean
    delayTime: number
    transparentColorIndex: number
    blockTerminator: number
}
interface CommentExtension extends Spanned {
    kind: "comment";
    comment: Uint8Array
}
interface PlainTextExtension extends Spanned {
    kind: "plain";
    numBytesToSkip: number;
    skippedBytes: Span;
    text: Uint8Array
}

export type Extension = ApplicationExtension | GraphicsControlExtension | CommentExtension | PlainTextExtension

export interface Image extends Spanned {
    localColorTable: GifColorTable | undefined;
    extensions: Extension[]
    descriptor: ImageDescriptor,
    minCodeSize: number;
    data: Uint8Array,
}

export interface GifColorTable extends Spanned {
    colors: [number, number, number][],
}

export interface LogicalScreenDescriptor extends Spanned {
    hasGlobalColorTable: boolean;
    sorted: boolean;
    globalColorTableSize: number;
    colorResolution: number;
    width: number,
    height: number,
    descriptor: number,
    backgroundColorIndex: number,
    pixelAspectRatio: number,
}

enum Constants {
    Trailer = 0x3b,
    ExtensionIntroducer = 0x21,
    PlainTextExtension = 0x01,
    GraphicsExtension = 0xf9,
    ApplicationExtension = 0xff,
    CommentExtension = 0xfe,
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

    private static colorTableBytes(size: number) {
        return 3 * Math.pow(2, size + 1);
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
            const localColorTable = descriptor.hasLocalColorTable
                ? this.parseColorTable(GifParser.colorTableBytes(descriptor.localColorTableSize))
                : undefined;
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
        const backgroundColorIndex = this.buffer.next();
        const pixelAspectRatio = this.buffer.next();
        const end = this.buffer.index;
        const hasGlobalColorTable = (descriptor >> 7) === 1;
        const sorted = ((descriptor >> 3) & 0b1) === 1;
        const globalColorTableSize = descriptor & 0b111;
        const colorResolution = (descriptor >> 4) & 0b111;

        return {
            width,
            height,
            descriptor,
            backgroundColorIndex,
            pixelAspectRatio,
            hasGlobalColorTable,
            sorted,
            globalColorTableSize,
            colorResolution,
            span: { start, end },
        }
    }

    private parseGlobalColorTable(descriptor: LogicalScreenDescriptor): GifColorTable | null {
        if (!descriptor.hasGlobalColorTable) {
            return null;
        }

        return this.parseColorTable(GifParser.colorTableBytes(descriptor.globalColorTableSize))
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
        const text = this.parseSubBlocks();
        const end = this.buffer.index;

        return {
            kind: "plain",
            numBytesToSkip,
            skippedBytes,
            text,
            span: { start, end }
        }
    }

    private parseApplicationExtension(start: number): ApplicationExtension {
        const applicationBlockLength = this.buffer.next();
        const netscapeVersion = this.buffer.getSpan(applicationBlockLength)
        const index = this.buffer.next();
        const numExecutions = this.buffer.readU16();
        const terminator = this.buffer.readU16();
        const end = this.buffer.index;

        return {
            kind: "application",
            applicationBlockLength,
            netscapeVersion,
            index,
            numExecutions,
            terminator,
            span: { start, end },
        }
    }

    private parseCommentExtension(start: number): CommentExtension {
        const comment = this.parseSubBlocks();
        const end = this.buffer.index

        return { kind: "comment", comment, span: { start, end } }
    }

    private parseGce(start: number): GraphicsControlExtension {
        const blockSize = this.buffer.next();
        const bitflags = this.buffer.next();
        const delayTime = this.buffer.readU16();
        const transparentColorIndex = this.buffer.next();
        const blockTerminator = this.buffer.next();
        const end = this.buffer.index

        const reserved = (bitflags >> 5) & 0b111;
        const disposalMethod = (bitflags >> 2) & 0b111;
        const shouldWaitForUserInput = ((bitflags >> 1) & 1) === 1;
        const hasTransparentColor = (bitflags & 1) === 1;

        return {
            kind: "graphics",
            blockSize,
            bitflags,
            reserved,
            disposalMethod,
            shouldWaitForUserInput,
            hasTransparentColor,
            delayTime,
            transparentColorIndex,
            blockTerminator,
            span: { start, end }
        }
    }

    private parseColorTable(len: number): GifColorTable {
        const span = this.buffer.getSpan(len)
        const bytes = new DataView(this.buffer.bytesForSpan(span))

        if (bytes.byteLength % 3 !== 0) {
            throw new Error('invalid global color table length: ' + bytes.byteLength)
        }

        const colors: [number, number, number][] = []

        for (let i = 0; i < bytes.byteLength; i += 3) {
            const color: [number, number, number] = [bytes.getUint8(i), bytes.getUint8(i + 1), bytes.getUint8(i + 2)]
            colors.push(color)
        }

        return { span, colors }
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

        let codeTable: number[][] = []
        const indexStream: number[] = []

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
            throw new Error(`end code not at end ${input.buffer.length * 8} ${input.cursor}`)
        }

        return indexStream
    }
}
