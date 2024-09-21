
import { BufferParser, Span } from "./buffer";

export interface Png {
    header: Span,
    chunks: Chunk[],
    buffer: BufferParser,
}

export class PngParser {
    private buffer: BufferParser;
    constructor(_buffer: Uint8Array) {
        this.buffer = new BufferParser(_buffer)
    }

    public parse(): Png {
        const header = this.buffer.getSpan(8);
        const chunks = [];
        while (!this.buffer.atEnd()) {
            chunks.push(this.parseChunk());
        }

        return {
            header,
            chunks,
            buffer: this.buffer,
        }
    }

    parseChunk(): Chunk {
        const length = this.buffer.readU32();
        const name = this.readChunkName();
        const nameStr = chunkNameToString(name);

        const definition = CHUNK_DEFINITIONS[nameStr as keyof typeof CHUNK_DEFINITIONS];

        const dataStart = this.buffer.index;
        const parsedData = definition && this.parseChunkDefinition(definition, this.buffer.index + length);
        this.buffer.index = dataStart;

        const rawData = this.buffer.getSpan(length);
        const crc = this.buffer.readU32();

        return new Chunk(
            name,
            rawData,
            crc,
            parsedData,
        )
    }

    parseIHDR() {

    }

    parseChunkDefinition(definition: Record<string, ChunkFieldKind>, chunkEnd: number) {
        let obj: Record<string, any> = {}

        for (const [name, type] of Object.entries(definition)) {
            obj[name] = this.parseFieldKind(type, chunkEnd);
        }

        return obj
    }

    parseFieldKind(kind: ChunkFieldKind, chunkEnd: number) {
        switch (kind) {
            case ChunkFieldKind.U8:
                return this.buffer.next();
            case ChunkFieldKind.U16:
                return this.buffer.readU16();
            case ChunkFieldKind.U32:
                return this.buffer.readU32();
            case ChunkFieldKind.NullTerminated:
                return this.buffer.readNullTerminatedString();
            case ChunkFieldKind.Buffer:
                return this.buffer.getSpanTo(chunkEnd);
        }
    }

    stringForSpan(span: Span) {
        return this.buffer.stringForSpan(span);
    }

    readChunkName(): ChunkName {
        return [
            this.buffer.next(),
            this.buffer.next(),
            this.buffer.next(),
            this.buffer.next(),
        ]
    }
}

function chunkNameToString(name: ChunkName): string {
    return `${String.fromCharCode(name[0])}${String.fromCharCode(name[1])}${String.fromCharCode(name[2])}${String.fromCharCode(name[3])}`
}

type ChunkName = [number, number, number, number]

export class Chunk {
    constructor(
        private readonly _name: ChunkName,
        readonly rawData: Span,
        readonly crc: number,
        readonly parsedData?: object,
    ) { }

    name() {
        return chunkNameToString(this._name) as keyof typeof CHUNK_DEFINITIONS;
    }

    size() {
        return this.rawData.end - this.rawData.start;
    }

}

export enum ChunkFieldKind {
    U8,
    U16,
    U32,
    NullTerminated,
    Buffer,
}

export const CHUNK_DEFINITIONS = {
    "IHDR": {
        width: ChunkFieldKind.U32,
        height: ChunkFieldKind.U32,
        bit_depth: ChunkFieldKind.U8,
        color_type: ChunkFieldKind.U8,
        compression_method: ChunkFieldKind.U8,
        filter_method: ChunkFieldKind.U8,
        interlace_method: ChunkFieldKind.U8,
    },
    "IDAT": {
        buffer: ChunkFieldKind.Buffer,
    },
    "IEND": {},
    "pHYs": {
        pixels_per_unit_x_axis: ChunkFieldKind.U32,
        pixels_per_unit_y_axis: ChunkFieldKind.U32,
        unit_specifier: ChunkFieldKind.U8,
    },
    "cHRM": {
        white_point_x: ChunkFieldKind.U32,
        white_point_y: ChunkFieldKind.U32,
        red_x: ChunkFieldKind.U32,
        red_y: ChunkFieldKind.U32,
        green_x: ChunkFieldKind.U32,
        green_y: ChunkFieldKind.U32,
        blue_x: ChunkFieldKind.U32,
        blue_y: ChunkFieldKind.U32,
    },
    "iCCP": {
        profile_name: ChunkFieldKind.NullTerminated,
        compression_method: ChunkFieldKind.U8,
        compressed_profile: ChunkFieldKind.Buffer,
    },
    "zTXt": {
        keyword: ChunkFieldKind.NullTerminated,
        compression_method: ChunkFieldKind.U8,
        compressed_text: ChunkFieldKind.Buffer,
    },
    "eXIf": { buffer: ChunkFieldKind.Buffer },
    "tEXt": {
        keyword: ChunkFieldKind.NullTerminated,
        text: ChunkFieldKind.Buffer,
    },
    "oRNT": {
        // https://github.com/ImageMagick/ImageMagick/commit/ba8f091f047754d6575b7101a47a6c6c778cc12b#diff-47f07ef0f1c4650948916afbed64f9b2cf620656f9f4f879685849c76fa9ec20R1984
        orientation: ChunkFieldKind.U8,
    },
    "tIME": {
        year: ChunkFieldKind.U16,
        month: ChunkFieldKind.U8,
        day: ChunkFieldKind.U8,
        hour: ChunkFieldKind.U8,
        minute: ChunkFieldKind.U8,
        second: ChunkFieldKind.U8,
    },
    "gAMA": {
        gamma: ChunkFieldKind.U32,
    },
    "sRGB": {
        rendering_intent: ChunkFieldKind.U8,
    }
};

