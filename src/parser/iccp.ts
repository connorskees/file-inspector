// Copyright 2015 Lovell Fuller and others.
// SPDX-License-Identifier: Apache-2.0

'use strict';

const textDecoder = new TextDecoder("utf-8");

// http://www.color.org/profileheader.xalter

const versionMap: Record<number, string> = {
    0x02000000: '2.0',
    0x02100000: '2.1',
    0x02400000: '2.4',
    0x04000000: '4.0',
    0x04200000: '4.2',
    0x04300000: '4.3',
    0x04400000: '4.4'
};

const intentMap: Record<number, string> = {
    0: 'Perceptual',
    1: 'Relative',
    2: 'Saturation',
    3: 'Absolute'
};

const valueMap: Record<string, string> = {
    // Device
    scnr: 'Scanner',
    mntr: 'Monitor',
    prtr: 'Printer',
    link: 'Link',
    abst: 'Abstract',
    spac: 'Space',
    nmcl: 'Named color',
    // Platform
    appl: 'Apple',
    adbe: 'Adobe',
    msft: 'Microsoft',
    sunw: 'Sun Microsystems',
    sgi: 'Silicon Graphics',
    tgnt: 'Taligent'
};

const tagMap: Record<string, string> = {
    desc: 'description',
    cprt: 'copyright',
    dmdd: 'deviceModelDescription',
    vued: 'viewingConditionsDescription',
    wtpt: 'whitepoint'
};

const getContentAtOffsetAsString = (buffer: DataView, offset: number) => {
    const value = textDecoder.decode(buffer.buffer.slice(offset, offset + 4)).trim();
    return (value.toLowerCase() in valueMap) ? valueMap[value.toLowerCase()] : value;
};

const hasContentAtOffset = (buffer: DataView, offset: number) => buffer.getUint32(offset) !== 0;

const readStringUTF16BE = (buffer: DataView, start: number, end: number) => {
    let value = '';
    for (let i = start; i < end; i += 2) {
        value += String.fromCharCode((buffer.getUint8(i) * 256) + buffer.getUint8(i + 1));
    }
    return value;
};

const invalid = (reason: any) => new Error(`Invalid ICC profile: ${reason}`);

export const parse = (buffer: DataView) => {
    // Verify expected length
    const size = buffer.getUint32(0);
    if (size !== buffer.byteLength) {
        throw invalid('length mismatch');
    }
    // Verify 'acsp' signature
    const signature = textDecoder.decode(buffer.buffer.slice(36, 40));
    if (signature !== 'acsp') {
        throw invalid('missing signature');
    }
    // Integer attributes
    const profile: Record<string, string | number[]> = {
        version: versionMap[buffer.getUint32(8)],
        intent: intentMap[buffer.getUint32(64)]
    };
    // Four-byte string attributes
    ([
        [4, 'cmm'],
        [12, 'deviceClass'],
        [16, 'colorSpace'],
        [20, 'connectionSpace'],
        [40, 'platform'],
        [48, 'manufacturer'],
        [52, 'model'],
        [80, 'creator']
    ] as [number, string][]).forEach(attr => {
        if (hasContentAtOffset(buffer, attr[0])) {
            profile[attr[1]] = getContentAtOffsetAsString(buffer, attr[0]);
        }
    });
    // Tags
    const tagCount = buffer.getUint32(128);
    let tagHeaderOffset = 132;
    for (let i = 0; i < tagCount; i++) {
        const tagSignature = getContentAtOffsetAsString(buffer, tagHeaderOffset);
        if (tagSignature in tagMap) {
            const tagOffset = buffer.getUint32(tagHeaderOffset + 4);
            const tagSize = buffer.getUint32(tagHeaderOffset + 8);
            if (tagOffset > buffer.byteLength) {
                throw invalid('tag offset out of bounds');
            }
            const tagType = getContentAtOffsetAsString(buffer, tagOffset);
            // desc
            if (tagType === 'desc') {
                const tagValueSize = buffer.getUint32(tagOffset + 8);
                if (tagValueSize > tagSize) {
                    throw invalid(`description tag value size out of bounds for ${tagSignature}`);
                }
                profile[tagMap[tagSignature]] = textDecoder.decode(buffer.buffer.slice(tagOffset + 12, tagOffset + tagValueSize + 11));
            }
            // text
            if (tagType === 'text') {
                profile[tagMap[tagSignature]] = textDecoder.decode(buffer.buffer.slice(tagOffset + 8, tagOffset + tagSize - 7));
            }
            if (tagType === 'mluc' && tagSignature in tagMap) {
                // 4 bytes signature, 4 bytes reserved (must be 0), 4 bytes number of names, 4 bytes name record size (must be 12)
                const numberOfNames = buffer.getUint32(tagOffset + 8);
                const nameRecordSize = buffer.getUint32(tagOffset + 12);
                if (nameRecordSize !== 12) {
                    throw invalid(`mluc name record size must be 12 for tag ${tagSignature}`);
                }
                if (numberOfNames > 0) {
                    // Entry: 2 bytes language code, 2 bytes country code, 4 bytes length, 4 bytes offset from start of tag
                    const nameLength = buffer.getUint32(tagOffset + 20);
                    const nameOffset = buffer.getUint32(tagOffset + 24);
                    const nameStart = tagOffset + nameOffset;
                    const nameStop = nameStart + nameLength;
                    profile[tagMap[tagSignature]] = readStringUTF16BE(buffer, nameStart, nameStop);
                }
            }
            if (tagType === 'XYZ') {
                profile[tagMap[tagSignature]] = [
                    buffer.getInt32(tagOffset + 8) / 65536,
                    buffer.getInt32(tagOffset + 12) / 65536,
                    buffer.getInt32(tagOffset + 16) / 65536
                ];
            }
        }
        tagHeaderOffset = tagHeaderOffset + 12;
    }
    return profile;
};