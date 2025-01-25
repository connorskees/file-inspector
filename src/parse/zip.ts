import { BufferParser, Span } from "./buffer";

const LOCAL_FILE_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const CENTRAL_DIRECTORY_FILE_SIGNATURE = [0x50, 0x4b, 0x01, 0x02];
const DATA_DESCRIPTOR_SIGNATURE = [0x08, 0x07, 0x4b, 0x50];
const END_CENTRAL_DIRECTORY_SIGNATURE = [0x50, 0x4b, 0x05, 0x06];

export interface ZipFile {
    fileHeaders: CentralDirectoryFileHeader[];
    end: EndCentralDirectory;
    buffer: BufferParser;
}


export interface CentralDirectoryFileHeader {
    os: number,
    metadata: Metadata,
    disk_num_start: number,
    internal_attributes: number,
    external_attributes: number,
    zip_specification_version: number,
    local_header_offset: number,
    comment: Span,
}

interface EndCentralDirectory {
    disk_num: number,
    disk_central_dir_num: number,
    disk_entires: number,
    total_entires: number,
    central_dir_size: number,
    central_dir_offset: number,
    comment: Span,
}

interface Metadata {
    version_needed: number,
    compression_method: number,
    date_time_modified: number,
    flags: number,
    name: Span,
    extra_field: Span,
    compressed_size: number,
    uncompressed_size: number,
    crc: number,
}


export class ZipParser {
    private buffer: BufferParser;
    constructor(_buffer: Uint8Array) {
        this.buffer = new BufferParser(_buffer, true);
    }

    public parse(): ZipFile {
        const end = this.parseEndOfCentralDirectory();
        const fileHeaders = this.readCentralDirectoryFileHeaders(end.central_dir_offset);

        return {
            fileHeaders,
            end,
            buffer: this.buffer,
        }
    }

    private readCentralDirectoryFileHeaders(offset: number): CentralDirectoryFileHeader[] {
        this.buffer.index = offset;

        let headers = [];

        while (this.buffer.consumeIfEquals(CENTRAL_DIRECTORY_FILE_SIGNATURE)) {
            const os = this.buffer.next();
            const zip_specification_version = this.buffer.next();
            const version_needed = this.buffer.readU16();
            const bit_flags = this.buffer.readU16();
            const compression_method = this.buffer.readU16();
            const date_time_modified = this.buffer.readU32();
            const crc = this.buffer.readU32();
            const compressed_size = this.buffer.readU32();
            const uncompressed_size = this.buffer.readU32();
            const file_name_len = this.buffer.readU16();
            const extra_field_len = this.buffer.readU16();
            const comment_len = this.buffer.readU16();
            const disk_num_start = this.buffer.readU16();
            const internal_attributes = this.buffer.readU16();
            const external_attributes = this.buffer.readU32();
            const local_header_offset = this.buffer.readU32();

            const file_name = this.buffer.getSpan(file_name_len);
            const extra_field = this.buffer.getSpan(extra_field_len);
            const comment = this.buffer.getSpan(comment_len);

            let metadata = {
                version_needed,
                compression_method,
                date_time_modified,
                flags: bit_flags,
                name: file_name,
                extra_field,
                crc,
                compressed_size,
                uncompressed_size,
            };

            headers.push({
                os,
                metadata,
                internal_attributes,
                external_attributes,
                disk_num_start,
                zip_specification_version,
                local_header_offset,
                comment,
            })
        }

        return headers;
    }

    private parseEndOfCentralDirectory(): EndCentralDirectory {
        let found = false;
        for (let idx = this.buffer.buffer.byteLength - 1; idx > 0; idx -= 1) {
            this.buffer.index = idx;
            if (this.buffer.consumeIfEquals(END_CENTRAL_DIRECTORY_SIGNATURE)) {
                found = true;
                break;
            }
        }

        if (!found) {
            throw new Error('missing central directory')
        }

        const disk_num = this.buffer.readU16();
        const disk_central_dir_num = this.buffer.readU16();
        const disk_entires = this.buffer.readU16();
        const total_entires = this.buffer.readU16();
        const central_dir_size = this.buffer.readU32();
        const central_dir_offset = this.buffer.readU32();
        const comment_len = this.buffer.readU16();
        const comment = this.buffer.getSpan(comment_len);

        return {
            disk_num,
            disk_central_dir_num,
            disk_entires,
            total_entires,
            central_dir_size,
            central_dir_offset,
            comment,
        }
    }
}