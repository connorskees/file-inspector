import React from 'react';
import { ExifField } from '../parse/exif';
import { bufferToString } from '../parse/buffer';
import { enumFormatter, HiddenBuffer } from './shared';

export const ORIENTATION: Record<number, string> = {
    1: "default",
    2: "flipped horizontally",
    3: "rotated 180 degrees",
    4: "flipped vertically",
    5: "rotated 90 degrees clockwise, then flipped horizontally",
    6: "rotated 90 degrees clockwise",
    7: "rotated 270 degrees clockwise, then flipped horizontally",
    8: "rotated 270 degrees clockwise",
}

export function ExifValue({ field }: { field: ExifField }) {
    const fmtName = React.useCallback((name: string) => name.split('.').pop()!, []);

    let value;
    switch (field.type) {
        case 2: {
            if (!Array.isArray(field.value)) {
                value = [field.value];
            }
            value = bufferToString(field.value as number[])
            break;
        }
        case 5:
        case 10:
            if (Array.isArray(field.value)) {
                value = (field.value as ({
                    numerator: number;
                    denom: number;
                })[]).map(({ numerator, denom }) => {
                    if (denom === 1) {
                        return numerator;
                    }

                    return `${+(numerator / denom).toFixed(5)} (${numerator}/${denom})`
                }).join(', ')
            }
            break;
        default:
            if (Array.isArray(field.value) && field.value.length > 25) {
                value = <HiddenBuffer buffer={<p style={{ maxWidth: '80ch' }}>
                    {field.value.join(' ')}
                </p>} />
            } else {
                value = JSON.stringify(field.value);
            }
    }

    if (field.name === "Exif.Image.Orientation") {
        value = enumFormatter(ORIENTATION)(field.value as number);
    }

    if (field.name === "Exif.Photo.UserComment" && Array.isArray(field.value)) {
        value = bufferToString(field.value as number[]);
    }

    if (field.name === "Exif.Photo.ExifVersion" && Array.isArray(field.value)) {
        value = bufferToString(field.value as number[]);
    }

    if (field.name === "Exif.Photo.FlashpixVersion" && Array.isArray(field.value)) {
        value = bufferToString(field.value as number[]);
    }

    return <div>
        <span style={{ fontWeight: 600 }}>{(field.name && fmtName(field.name)) ?? `unrecognized field ${field.tag}`}</span>: {value}
    </div>
}
