import React from 'react'
import { CentralDirectoryFileHeader, ZipFile } from '../parse/zip'
import { enumFormatter } from './shared';
import './zip.scss';

enum Os {
    Dos = 0,
    Amiga = 1,
    OpenVMS = 2,
    Unix = 3,
    VM = 4,
    AtariST = 5,
    OS2HPFS = 6,
    Macintosh = 7,
    ZSystem = 8,
    Cpm = 9,
    WindowsNtfs = 10,
    Mvs = 11,
    Vse = 12,
    AcornRisc = 13,
    Vfat = 14,
    AlternateMVS = 15,
    BeOS = 16,
    Tandem = 17,
    OS400 = 18,
    Darwin = 19,
    Unused,
}

enum CompressionFormat {
    None = 0,
    Shrink = 1,
    Factor1 = 2,
    Factor2 = 3,
    Factor3 = 4,
    Factor4 = 5,
    Implode = 6,
    Reserved = 7,
    Deflate = 8,
    EnhancedDeflate = 9,
    PKWareDclImplode = 10,
    Bzip2 = 12,
    Lzma = 14,
    IbmTerse = 18,
    IbmLZ77z = 19,
    PPMd = 98,
}

function FileDisplayer({ fileHeader, zip }: { fileHeader: CentralDirectoryFileHeader, zip: ZipFile }) {
    const comment = zip.buffer.stringForSpan(fileHeader.comment);
    return <>
        <tr><td>Name</td><td>{zip.buffer.stringForSpan(fileHeader.metadata.name)}</td></tr>
        <tr><td>Compressed size</td><td>{fileHeader.metadata.compressed_size} bytes</td></tr>
        <tr><td>Uncompressed size</td><td>{fileHeader.metadata.uncompressed_size} bytes</td></tr>
        <tr><td>Compression method</td><td>{enumFormatter(CompressionFormat)(fileHeader.metadata.compression_method)}</td></tr>
        {comment && <tr><td>Comment</td><td>{comment}</td></tr>}
        <tr><td>OS</td><td>{enumFormatter(Os)(fileHeader.os)}</td></tr>
        <tr><td>Zip version</td><td>{fileHeader.zip_specification_version}</td></tr>
        <tr><td>CRC</td><td>{fileHeader.metadata.crc.toString(16)}</td></tr>
        <tr style={{ height: 32 }}><td></td><td></td></tr>
    </>
}

export function ZipDisplayer({ zip }: { zip: ZipFile }) {
    return <>
        <div className='zip' style={{ margin: '64px 16px' }}>
            <table>
                <tbody>
                    {zip.fileHeaders.map(header => <FileDisplayer fileHeader={header} zip={zip} />)}
                </tbody >
            </table>
        </div>
    </>
}