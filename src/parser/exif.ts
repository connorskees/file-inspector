import { BufferParser } from "./buffer";

type ExifFieldValue = number | (number | {
    numerator: number;
    denom: number;
})[];

export interface ExifField {
    tag: number;
    name: string | undefined;
    type: number;
    count: number;
    valueOffset: number;
    value: ExifFieldValue,
}

function fieldTypeSize(type: number): number {
    switch (type) {
        case 1:
        case 2:
        case 7:
            return 1;
        case 3:
            return 2;
        case 4:
        case 9:
            return 4;
        case 5:
        case 10:
            return 8;
        default:
            throw new Error(`invalid field type: ${type}`);
    }
}

const EXIF_TAG = 34665;
const GPS_TAG = 34853;

export class ExifParser {
    private buffer: BufferParser;
    constructor(_buffer: Uint8Array) {
        this.buffer = new BufferParser(_buffer)
    }

    parse() {
        const header = this.readTiffHeader();
        this.buffer.index = header.ifdOffset;
        const ifd = this.readIfd();

        const fields = ifd.fields;

        const exifOffset = ifd.fields.find((t) => t.tag === EXIF_TAG)?.valueOffset;
        if (exifOffset) {
            this.buffer.index = exifOffset;
            const exifIfd = this.readIfd();
            fields.push(...exifIfd.fields);
        }

        const gpsOffset = ifd.fields.find((t) => t.tag === GPS_TAG)?.valueOffset;
        if (gpsOffset) {
            this.buffer.index = gpsOffset;
            const gpsIfd = this.readIfd();
            fields.push(...gpsIfd.fields);
        }

        return { fields }
    }

    readFieldValue(field: ExifField) {
        // 1 = BYTE An 8-bit unsigned integer.
        // 2 = ASCII An 8-bit byte containing one 7-bit ASCII code. The final byte is terminated with NULL.
        // 3 = SHORT A 16-bit (2-byte) unsigned integer,
        // 4 = LONG A 32-bit (4-byte) unsigned integer,
        // 5 = RATIONAL Two LONGs. The first LONG is the numerator and the second LONG expresses the denominator.
        // 7 = UNDEFINED An 8-bit byte that may take any value depending on the field definition.
        // 9 = SLONG A 32-bit (4-byte) signed integer (2's complement notation).
        // 10 = SRATIONAL Two SLONGs. The first SLONG is the numerator and the second SLONG is the denominator
        const fieldSize = field.count * fieldTypeSize(field.type);

        if (fieldSize <= 4) {
            switch (field.type) {
                case 1:
                case 2:
                case 7: {
                    const byteMask = 0b1111_1111;

                    const firstByte = field.valueOffset >> 24
                    if (field.count === 1) {
                        return firstByte;
                    }
                    const secondByte = (field.valueOffset >> 16) & byteMask
                    if (field.count == 2) {
                        return [firstByte, secondByte]
                    }
                    const thirdByte = (field.valueOffset >> 8) & byteMask
                    if (field.count == 3) {
                        return [firstByte, secondByte, thirdByte]
                    }
                    const fourthByte = field.valueOffset & byteMask
                    return [firstByte, secondByte, thirdByte, fourthByte]
                }
                case 3: {
                    if (field.count == 1) {
                        return field.valueOffset >> 16;
                    }

                    return [field.valueOffset >> 16, field.valueOffset & 0b1111_1111_1111_1111]
                }
                case 4:
                    return field.valueOffset;
                case 9:
                    return field.valueOffset >>> 0;
            }
        }

        const start = this.buffer.index;
        this.buffer.index = field.valueOffset;

        const values = []

        for (let i = 0; i < field.count; i += 1) {
            switch (field.type) {
                case 1:
                case 2:
                case 7: {
                    values.push(this.buffer.next())
                    break;
                }
                case 3: {
                    values.push(this.buffer.readU16());
                    break;
                }
                case 4: {
                    values.push(this.buffer.readU32());
                    break;
                }
                case 5: {
                    const numerator = this.buffer.readU32();
                    const denom = this.buffer.readU32();
                    values.push({ numerator, denom });
                    break;
                }
                case 9: {
                    values.push(this.buffer.readI32());
                    break;
                }
                case 10: {
                    const numerator = this.buffer.readI32();
                    const denom = this.buffer.readI32();
                    values.push({ numerator, denom });
                    break;
                }
            }
        }

        this.buffer.index = start;
        return values;
    }

    readIfd() {
        const numFields = this.buffer.readU16();

        const fields = [];

        for (let i = 0; i < numFields; i += 1) {
            const tag = this.buffer.readU16();
            const type = this.buffer.readU16();
            const count = this.buffer.readU32();
            const valueOffset = this.buffer.readU32();

            const field = {
                tag,
                name: TAGS.find((t) => t.tag === tag)?.name,
                type,
                count,
                valueOffset,
                value: -1 as number | (number | { numerator: number; denom: number; })[],
            };

            field.value = this.readFieldValue(field);

            fields.push(field);
        }

        const nextIfd = this.buffer.readU32();

        return {
            numFields,
            fields,
            nextIfd,
        }
    }

    readTiffHeader() {
        const byteOrder = this.buffer.readU16();
        const fortyTwo = this.buffer.readU16();
        const ifdOffset = this.buffer.readU32();

        return {
            byteOrder,
            fortyTwo,
            ifdOffset,
        }
    }
}

// // BIG ENDIAN
// const MM = ('M'.charCodeAt(0) << 8) | 'M'.charCodeAt(0);
// // LITTLE ENDIAN
// const II = ('I'.charCodeAt(0) << 8) | 'I'.charCodeAt(0);

const TAGS = [
    { tag: 11, name: "Exif.Image.ProcessingSoftware", description: "The name and version of the software used to post-process the picture.", },
    { tag: 254, name: "Exif.Image.NewSubfileType", description: "A general indication of the kind of data contained in this subfile.", },
    { tag: 255, name: "Exif.Image.SubfileType", description: "A general indication of the kind of data contained in this subfile. This field is deprecated. The NewSubfileType field should be used instead.", },
    { tag: 256, name: "Exif.Image.ImageWidth", description: "The number of columns of image data, equal to the number of pixels per row. In JPEG compressed data a JPEG marker is used instead of this tag.", },
    { tag: 257, name: "Exif.Image.ImageLength", description: "The number of rows of image data. In JPEG compressed data a JPEG marker is used instead of this tag.", },
    { tag: 258, name: "Exif.Image.BitsPerSample", description: "The number of bits per image component. In this standard each component of the image is 8 bits, so the value for this tag is 8. See also <SamplesPerPixel>. In JPEG compressed data a JPEG marker is used instead of this tag.", },
    { tag: 259, name: "Exif.Image.Compression", description: "The compression scheme used for the image data. When a primary image is JPEG compressed, this designation is not necessary and is omitted. When thumbnails use JPEG compression, this tag value is set to 6.", },
    { tag: 262, name: "Exif.Image.PhotometricInterpretation", description: "The pixel composition. In JPEG compressed data a JPEG marker is used instead of this tag.", },
    { tag: 263, name: "Exif.Image.Thresholding", description: "For black and white TIFF files that represent shades of gray, the technique used to convert from gray to black and white pixels.", },
    { tag: 264, name: "Exif.Image.CellWidth", description: "The width of the dithering or halftoning matrix used to create a dithered or halftoned bilevel file.", },
    { tag: 265, name: "Exif.Image.CellLength", description: "The length of the dithering or halftoning matrix used to create a dithered or halftoned bilevel file.", },
    { tag: 266, name: "Exif.Image.FillOrder", description: "The logical order of bits within a byte", },
    { tag: 269, name: "Exif.Image.DocumentName", description: "The name of the document from which this image was scanned.", },
    { tag: 270, name: "Exif.Image.ImageDescription", description: "A character string giving the title of the image. It may be a comment such as \"1988 company picnic\" or the like. Two-bytes character codes cannot be used. When a 2-bytes code is necessary, the Exif Private tag <UserComment> is to be used.", },
    { tag: 271, name: "Exif.Image.Make", description: "The manufacturer of the recording equipment. This is the manufacturer of the DSC, scanner, video digitizer or other equipment that generated the image. When the field is left blank, it is treated as unknown.", },
    { tag: 272, name: "Exif.Image.Model", description: "The model name or model number of the equipment. This is the model name or number of the DSC, scanner, video digitizer or other equipment that generated the image. When the field is left blank, it is treated as unknown.", },
    { tag: 273, name: "Exif.Image.StripOffsets", description: "For each strip, the byte offset of that strip. It is recommended that this be selected so the number of strip bytes does not exceed 64 Kbytes. With JPEG compressed data this designation is not needed and is omitted. See also <RowsPerStrip> and <StripByteCounts>.", },
    { tag: 274, name: "Exif.Image.Orientation", description: "The image orientation viewed in terms of rows and columns.", },
    { tag: 277, name: "Exif.Image.SamplesPerPixel", description: "The number of components per pixel. Since this standard applies to RGB and YCbCr images, the value set for this tag is 3. In JPEG compressed data a JPEG marker is used instead of this tag.", },
    { tag: 278, name: "Exif.Image.RowsPerStrip", description: "The number of rows per strip. This is the number of rows in the image of one strip when an image is divided into strips. With JPEG compressed data this designation is not needed and is omitted. See also <StripOffsets> and <StripByteCounts>.", },
    { tag: 279, name: "Exif.Image.StripByteCounts", description: "The total number of bytes in each strip. With JPEG compressed data this designation is not needed and is omitted.", },
    { tag: 282, name: "Exif.Image.XResolution", description: "The number of pixels per <ResolutionUnit> in the <ImageWidth> direction. When the image resolution is unknown, 72 [dpi] is designated.", },
    { tag: 283, name: "Exif.Image.YResolution", description: "The number of pixels per <ResolutionUnit> in the <ImageLength> direction. The same value as <XResolution> is designated.", },
    { tag: 284, name: "Exif.Image.PlanarConfiguration", description: "Indicates whether pixel components are recorded in a chunky or planar format. In JPEG compressed files a JPEG marker is used instead of this tag. If this field does not exist, the TIFF default of 1 (chunky) is assumed.", },
    { tag: 285, name: "Exif.Image.PageName", description: "The name of the page from which this image was scanned.", },
    { tag: 286, name: "Exif.Image.XPosition", description: "X position of the image. The X offset in ResolutionUnits of the left side of the image, with respect to the left side of the page.", },
    { tag: 287, name: "Exif.Image.YPosition", description: "Y position of the image. The Y offset in ResolutionUnits of the top of the image, with respect to the top of the page. In the TIFF coordinate scheme, the positive Y direction is down, so that YPosition is always positive.", },
    { tag: 290, name: "Exif.Image.GrayResponseUnit", description: "The precision of the information contained in the GrayResponseCurve.", },
    { tag: 291, name: "Exif.Image.GrayResponseCurve", description: "For grayscale data, the optical density of each possible pixel value.", },
    { tag: 292, name: "Exif.Image.T4Options", description: "T.4-encoding options.", },
    { tag: 293, name: "Exif.Image.T6Options", description: "T.6-encoding options.", },
    { tag: 296, name: "Exif.Image.ResolutionUnit", description: "The unit for measuring <XResolution> and <YResolution>. The same unit is used for both <XResolution> and <YResolution>. If the image resolution is unknown, 2 (inches) is designated.", },
    { tag: 297, name: "Exif.Image.PageNumber", description: "The page number of the page from which this image was scanned.", },
    { tag: 301, name: "Exif.Image.TransferFunction", description: "A transfer function for the image, described in tabular style. Normally this tag is not necessary, since color space is specified in the color space information tag (<ColorSpace>).", },
    { tag: 305, name: "Exif.Image.Software", description: "This tag records the name and version of the software or firmware of the camera or image input device used to generate the image. The detailed format is not specified, but it is recommended that the example shown below be followed. When the field is left blank, it is treated as unknown.", },
    { tag: 306, name: "Exif.Image.DateTime", description: "The date and time of image creation. In Exif standard, it is the date and time the file was changed.", },
    { tag: 315, name: "Exif.Image.Artist", description: "This tag records the name of the camera owner, photographer or image creator. The detailed format is not specified, but it is recommended that the information be written as in the example below for ease of Interoperability. When the field is left blank, it is treated as unknown. Ex.) \"Camera owner, John Smith; Photographer, Michael Brown; Image creator, Ken James\"", },
    { tag: 316, name: "Exif.Image.HostComputer", description: "This tag records information about the host computer used to generate the image.", },
    { tag: 317, name: "Exif.Image.Predictor", description: "A predictor is a mathematical operator that is applied to the image data before an encoding scheme is applied.", },
    { tag: 318, name: "Exif.Image.WhitePoint", description: "The chromaticity of the white point of the image. Normally this tag is not necessary, since color space is specified in the colorspace information tag (<ColorSpace>).", },
    { tag: 319, name: "Exif.Image.PrimaryChromaticities", description: "The chromaticity of the three primary colors of the image. Normally this tag is not necessary, since colorspace is specified in the colorspace information tag (<ColorSpace>).", },
    { tag: 320, name: "Exif.Image.ColorMap", description: "A color map for palette color images. This field defines a Red-Green-Blue color map (often called a lookup table) for palette-color images. In a palette-color image, a pixel value is used to index into an RGB lookup table.", },
    { tag: 321, name: "Exif.Image.HalftoneHints", description: "The purpose of the HalftoneHints field is to convey to the halftone function the range of gray levels within a colorimetrically-specified image that should retain tonal detail.", },
    { tag: 322, name: "Exif.Image.TileWidth", description: "The tile width in pixels. This is the number of columns in each tile.", },
    { tag: 323, name: "Exif.Image.TileLength", description: "The tile length (height) in pixels. This is the number of rows in each tile.", },
    { tag: 324, name: "Exif.Image.TileOffsets", description: "For each tile, the byte offset of that tile, as compressed and stored on disk. The offset is specified with respect to the beginning of the TIFF file. Note that this implies that each tile has a location independent of the locations of other tiles.", },
    { tag: 325, name: "Exif.Image.TileByteCounts", description: "For each tile, the number of (compressed) bytes in that tile. See TileOffsets for a description of how the byte counts are ordered.", },
    { tag: 330, name: "Exif.Image.SubIFDs", description: "Defined by Adobe Corporation to enable TIFF Trees within a TIFF file.", },
    { tag: 332, name: "Exif.Image.InkSet", description: "The set of inks used in a separated (PhotometricInterpretation=5) image.", },
    { tag: 333, name: "Exif.Image.InkNames", description: "The name of each ink used in a separated (PhotometricInterpretation=5) image.", },
    { tag: 334, name: "Exif.Image.NumberOfInks", description: "The number of inks. Usually equal to SamplesPerPixel, unless there are extra samples.", },
    { tag: 336, name: "Exif.Image.DotRange", description: "The component values that correspond to a 0% dot and 100% dot.", },
    { tag: 337, name: "Exif.Image.TargetPrinter", description: "A description of the printing environment for which this separation is intended.", },
    { tag: 338, name: "Exif.Image.ExtraSamples", description: "Specifies that each pixel has m extra components whose interpretation is defined by one of the values listed below.", },
    { tag: 339, name: "Exif.Image.SampleFormat", description: "This field specifies how to interpret each data sample in a pixel.", },
    { tag: 340, name: "Exif.Image.SMinSampleValue", description: "This field specifies the minimum sample value.", },
    { tag: 341, name: "Exif.Image.SMaxSampleValue", description: "This field specifies the maximum sample value.", },
    { tag: 342, name: "Exif.Image.TransferRange", description: "Expands the range of the TransferFunction", },
    { tag: 343, name: "Exif.Image.ClipPath", description: "A TIFF ClipPath is intended to mirror the essentials of PostScript's path creation functionality.", },
    { tag: 344, name: "Exif.Image.XClipPathUnits", description: "The number of units that span the width of the image, in terms of integer ClipPath coordinates.", },
    { tag: 345, name: "Exif.Image.YClipPathUnits", description: "The number of units that span the height of the image, in terms of integer ClipPath coordinates.", },
    { tag: 346, name: "Exif.Image.Indexed", description: "Indexed images are images where the 'pixels' do not represent color values, but rather an index (usually 8-bit) into a separate color table, the ColorMap.", },
    { tag: 347, name: "Exif.Image.JPEGTables", description: "This optional tag may be used to encode the JPEG quantization and Huffman tables for subsequent use by the JPEG decompression process.", },
    { tag: 351, name: "Exif.Image.OPIProxy", description: "OPIProxy gives information concerning whether this image is a low-resolution proxy of a high-resolution image (Adobe OPI).", },
    { tag: 512, name: "Exif.Image.JPEGProc", description: "This field indicates the process used to produce the compressed data", },
    { tag: 513, name: "Exif.Image.JPEGInterchangeFormat", description: "The offset to the start byte (SOI) of JPEG compressed thumbnail data. This is not used for primary image JPEG data.", },
    { tag: 514, name: "Exif.Image.JPEGInterchangeFormatLength", description: "The number of bytes of JPEG compressed thumbnail data. This is not used for primary image JPEG data. JPEG thumbnails are not divided but are recorded as a continuous JPEG bitstream from SOI to EOI. Appn and COM markers should not be recorded. Compressed thumbnails must be recorded in no more than 64 Kbytes, including all other data to be recorded in APP1.", },
    { tag: 515, name: "Exif.Image.JPEGRestartInterval", description: "This Field indicates the length of the restart interval used in the compressed image data.", },
    { tag: 517, name: "Exif.Image.JPEGLosslessPredictors", description: "This Field points to a list of lossless predictor-selection values, one per component.", },
    { tag: 518, name: "Exif.Image.JPEGPointTransforms", description: "This Field points to a list of point transform values, one per component.", },
    { tag: 519, name: "Exif.Image.JPEGQTables", description: "This Field points to a list of offsets to the quantization tables, one per component.", },
    { tag: 520, name: "Exif.Image.JPEGDCTables", description: "This Field points to a list of offsets to the DC Huffman tables or the lossless Huffman tables, one per component.", },
    { tag: 521, name: "Exif.Image.JPEGACTables", description: "This Field points to a list of offsets to the Huffman AC tables, one per component.", },
    { tag: 529, name: "Exif.Image.YCbCrCoefficients", description: "The matrix coefficients for transformation from RGB to YCbCr image data. No default is given in TIFF; but here the value given in Appendix E, \"Color Space Guidelines\", is used as the default. The color space is declared in a color space information tag, with the default being the value that gives the optimal image characteristics Interoperability this condition.", },
    { tag: 530, name: "Exif.Image.YCbCrSubSampling", description: "The sampling ratio of chrominance components in relation to the luminance component. In JPEG compressed data a JPEG marker is used instead of this tag.", },
    { tag: 531, name: "Exif.Image.YCbCrPositioning", description: "The position of chrominance components in relation to the luminance component. This field is designated only for JPEG compressed data or uncompressed YCbCr data. The TIFF default is 1 (centered); but when Y:Cb:Cr = 4:2:2 it is recommended in this standard that 2 (co-sited) be used to record data, in order to improve the image quality when viewed on TV systems. When this field does not exist, the reader shall assume the TIFF default. In the case of Y:Cb:Cr = 4:2:0, the TIFF default (centered) is recommended. If the reader does not have the capability of supporting both kinds of <YCbCrPositioning>, it shall follow the TIFF default regardless of the value in this field. It is preferable that readers be able to support both centered and co-sited positioning.", },
    { tag: 532, name: "Exif.Image.ReferenceBlackWhite", description: "The reference black point value and reference white point value. No defaults are given in TIFF, but the values below are given as defaults here. The color space is declared in a color space information tag, with the default being the value that gives the optimal image characteristics Interoperability these conditions.", },
    { tag: 700, name: "Exif.Image.XMLPacket", description: "XMP Metadata (Adobe technote 9-14-02)", },
    { tag: 18246, name: "Exif.Image.Rating", description: "Rating tag used by Windows", },
    { tag: 18249, name: "Exif.Image.RatingPercent", description: "Rating tag used by Windows, value in percent", },
    { tag: 28722, name: "Exif.Image.VignettingCorrParams", description: "Sony vignetting correction parameters", },
    { tag: 28725, name: "Exif.Image.ChromaticAberrationCorrParams", description: "Sony chromatic aberration correction parameters", },
    { tag: 28727, name: "Exif.Image.DistortionCorrParams", description: "Sony distortion correction parameters", },
    { tag: 32781, name: "Exif.Image.ImageID", description: "ImageID is the full pathname of the original, high-resolution image, or any other identifying string that uniquely identifies the original image (Adobe OPI).", },
    { tag: 33421, name: "Exif.Image.CFARepeatPatternDim", description: "Contains two values representing the minimum rows and columns to define the repeating patterns of the color filter array", },
    { tag: 33422, name: "Exif.Image.CFAPattern", description: "Indicates the color filter array (CFA) geometric pattern of the image sensor when a one-chip color area sensor is used. It does not apply to all sensing methods", },
    { tag: 33423, name: "Exif.Image.BatteryLevel", description: "Contains a value of the battery level as a fraction or string", },
    { tag: 33432, name: "Exif.Image.Copyright", description: "Copyright information. In this standard the tag is used to indicate both the photographer and editor copyrights. It is the copyright notice of the person or organization claiming rights to the image. The Interoperability copyright statement including date and rights should be written in this field; e.g., \"Copyright, John Smith, 19xx.All rights reserved.\". In this standard the field records both the photographer and editor copyrights, with each recorded in a separate part of the statement. When there is a clear distinction between the photographer and editor copyrights, these are to be written in the order of photographer followed by editor copyright, separated by NULL (in this case since the statement also ends with a NULL, there are two NULL codes). When only the photographer copyright is given, it is terminated by one NULL code. When only the editor copyright is given, the photographer copyright part consists of one space followed by a terminating NULL code, then the editor copyright is given. When the field is left blank, it is treated as unknown.", },
    { tag: 33434, name: "Exif.Image.ExposureTime", description: "Exposure time, given in seconds.", },
    { tag: 33437, name: "Exif.Image.FNumber", description: "The F number.", },
    { tag: 33723, name: "Exif.Image.IPTCNAA", description: "Contains an IPTC/NAA record", },
    { tag: 34377, name: "Exif.Image.ImageResources", description: "Contains information embedded by the Adobe Photoshop application", },
    { tag: 34665, name: "Exif.Image.ExifTag", description: "A pointer to the Exif IFD. Interoperability, Exif IFD has the same structure as that of the IFD specified in TIFF. ordinarily, however, it does not contain image data as in the case of TIFF.", },
    { tag: 34675, name: "Exif.Image.InterColorProfile", description: "Contains an InterColor Consortium (ICC) format color space characterization/profile", },
    { tag: 34850, name: "Exif.Image.ExposureProgram", description: "The class of the program used by the camera to set exposure when the picture is taken.", },
    { tag: 34852, name: "Exif.Image.SpectralSensitivity", description: "Indicates the spectral sensitivity of each channel of the camera used.", },
    { tag: 34853, name: "Exif.Image.GPSTag", description: "A pointer to the GPS Info IFD. The Interoperability structure of the GPS Info IFD, like that of Exif IFD, has no image data.", },
    { tag: 34855, name: "Exif.Image.ISOSpeedRatings", description: "Indicates the ISO Speed and ISO Latitude of the camera or input device as specified in ISO 12232.", },
    { tag: 34856, name: "Exif.Image.OECF", description: "Indicates the Opto-Electric Conversion Function (OECF) specified in ISO 14524.", },
    { tag: 34857, name: "Exif.Image.Interlace", description: "Indicates the field number of multifield images.", },
    { tag: 34858, name: "Exif.Image.TimeZoneOffset", description: "This optional tag encodes the time zone of the camera clock (relative to Greenwich Mean Time) used to create the DataTimeOriginal tag-value when the picture was taken. It may also contain the time zone offset of the clock used to create the DateTime tag-value when the image was modified.", },
    { tag: 34859, name: "Exif.Image.SelfTimerMode", description: "Number of seconds image capture was delayed from button press.", },
    { tag: 36867, name: "Exif.Image.DateTimeOriginal", description: "The date and time when the original image data was generated.", },
    { tag: 37122, name: "Exif.Image.CompressedBitsPerPixel", description: "Specific to compressed data; states the compressed bits per pixel.", },
    { tag: 37377, name: "Exif.Image.ShutterSpeedValue", description: "Shutter speed.", },
    { tag: 37378, name: "Exif.Image.ApertureValue", description: "The lens aperture.", },
    { tag: 37379, name: "Exif.Image.BrightnessValue", description: "The value of brightness.", },
    { tag: 37380, name: "Exif.Image.ExposureBiasValue", description: "The exposure bias.", },
    { tag: 37381, name: "Exif.Image.MaxApertureValue", description: "The smallest F number of the lens.", },
    { tag: 37382, name: "Exif.Image.SubjectDistance", description: "The distance to the subject, given in meters.", },
    { tag: 37383, name: "Exif.Image.MeteringMode", description: "The metering mode.", },
    { tag: 37384, name: "Exif.Image.LightSource", description: "The kind of light source.", },
    { tag: 37385, name: "Exif.Image.Flash", description: "Indicates the status of flash when the image was shot.", },
    { tag: 37386, name: "Exif.Image.FocalLength", description: "The actual focal length of the lens, in mm.", },
    { tag: 37387, name: "Exif.Image.FlashEnergy", description: "Amount of flash energy (BCPS).", },
    { tag: 37388, name: "Exif.Image.SpatialFrequencyResponse", description: "SFR of the camera.", },
    { tag: 37389, name: "Exif.Image.Noise", description: "Noise measurement values.", },
    { tag: 37390, name: "Exif.Image.FocalPlaneXResolution", description: "Number of pixels per FocalPlaneResolutionUnit (37392) in ImageWidth direction for main image.", },
    { tag: 37391, name: "Exif.Image.FocalPlaneYResolution", description: "Number of pixels per FocalPlaneResolutionUnit (37392) in ImageLength direction for main image.", },
    { tag: 37392, name: "Exif.Image.FocalPlaneResolutionUnit", description: "Unit of measurement for FocalPlaneXResolution(37390) and FocalPlaneYResolution(37391).", },
    { tag: 37393, name: "Exif.Image.ImageNumber", description: "Number assigned to an image, e.g., in a chained image burst.", },
    { tag: 37394, name: "Exif.Image.SecurityClassification", description: "Security classification assigned to the image.", },
    { tag: 37395, name: "Exif.Image.ImageHistory", description: "Record of what has been done to the image.", },
    { tag: 37396, name: "Exif.Image.SubjectLocation", description: "Indicates the location and area of the main subject in the overall scene.", },
    { tag: 37397, name: "Exif.Image.ExposureIndex", description: "Encodes the camera exposure index setting when image was captured.", },
    { tag: 37398, name: "Exif.Image.TIFFEPStandardID", description: "Contains four ASCII characters representing the TIFF/EP standard version of a TIFF/EP file, eg '1', '0', '0', '0'", },
    { tag: 37399, name: "Exif.Image.SensingMethod", description: "Type of image sensor.", },
    { tag: 40091, name: "Exif.Image.XPTitle", description: "Title tag used by Windows, encoded in UCS2", },
    { tag: 40092, name: "Exif.Image.XPComment", description: "Comment tag used by Windows, encoded in UCS2", },
    { tag: 40093, name: "Exif.Image.XPAuthor", description: "Author tag used by Windows, encoded in UCS2", },
    { tag: 40094, name: "Exif.Image.XPKeywords", description: "Keywords tag used by Windows, encoded in UCS2", },
    { tag: 40095, name: "Exif.Image.XPSubject", description: "Subject tag used by Windows, encoded in UCS2", },
    { tag: 50341, name: "Exif.Image.PrintImageMatching", description: "Print Image Matching, description needed.", },
    { tag: 50706, name: "Exif.Image.DNGVersion", description: "This tag encodes the DNG four-tier version number. For files compliant with version 1.1.0.0 of the DNG specification, this tag should contain the bytes: 1, 1, 0, 0.", },
    { tag: 50707, name: "Exif.Image.DNGBackwardVersion", description: "This tag specifies the oldest version of the Digital Negative specification for which a file is compatible. Readers shouldnot attempt to read a file if this tag specifies a version number that is higher than the version number of the specification the reader was based on. In addition to checking the version tags, readers should, for all tags, check the types, counts, and values, to verify it is able to correctly read the file.", },
    { tag: 50708, name: "Exif.Image.UniqueCameraModel", description: "Defines a unique, non-localized name for the camera model that created the image in the raw file. This name should include the manufacturer's name to avoid conflicts, and should not be localized, even if the camera name itself is localized for different markets (see LocalizedCameraModel). This string may be used by reader software to index into per-model preferences and replacement profiles.", },
    { tag: 50709, name: "Exif.Image.LocalizedCameraModel", description: "Similar to the UniqueCameraModel field, except the name can be localized for different markets to match the localization of the camera name.", },
    { tag: 50710, name: "Exif.Image.CFAPlaneColor", description: "Provides a mapping between the values in the CFAPattern tag and the plane numbers in LinearRaw space. This is a required tag for non-RGB CFA images.", },
    { tag: 50711, name: "Exif.Image.CFALayout", description: "Describes the spatial layout of the CFA.", },
    { tag: 50712, name: "Exif.Image.LinearizationTable", description: "Describes a lookup table that maps stored values into linear values. This tag is typically used to increase compression ratios by storing the raw data in a non-linear, more visually uniform space with fewer total encoding levels. If SamplesPerPixel is not equal to one, this single table applies to all the samples for each pixel.", },
    { tag: 50713, name: "Exif.Image.BlackLevelRepeatDim", description: "Specifies repeat pattern size for the BlackLevel tag.", },
    { tag: 50714, name: "Exif.Image.BlackLevel", description: "Specifies the zero light (a.k.a. thermal black or black current) encoding level, as a repeating pattern. The origin of this pattern is the top-left corner of the ActiveArea rectangle. The values are stored in row-column-sample scan order.", },
    { tag: 50715, name: "Exif.Image.BlackLevelDeltaH", description: "If the zero light encoding level is a function of the image column, BlackLevelDeltaH specifies the difference between the zero light encoding level for each column and the baseline zero light encoding level. If SamplesPerPixel is not equal to one, this single table applies to all the samples for each pixel.", },
    { tag: 50716, name: "Exif.Image.BlackLevelDeltaV", description: "If the zero light encoding level is a function of the image row, this tag specifies the difference between the zero light encoding level for each row and the baseline zero light encoding level. If SamplesPerPixel is not equal to one, this single table applies to all the samples for each pixel.", },
    { tag: 50717, name: "Exif.Image.WhiteLevel", description: "This tag specifies the fully saturated encoding level for the raw sample values. Saturation is caused either by the sensor itself becoming highly non-linear in response, or by the camera's analog to digital converter clipping.", },
    { tag: 50718, name: "Exif.Image.DefaultScale", description: "DefaultScale is required for cameras with non-square pixels. It specifies the default scale factors for each direction to convert the image to square pixels. Typically these factors are selected to approximately preserve total pixel count. For CFA images that use CFALayout equal to 2, 3, 4, or 5, such as the Fujifilm SuperCCD, these two values should usually differ by a factor of 2.0.", },
    { tag: 50719, name: "Exif.Image.DefaultCropOrigin", description: "Raw images often store extra pixels around the edges of the final image. These extra pixels help prevent interpolation artifacts near the edges of the final image. DefaultCropOrigin specifies the origin of the final image area, in raw image coordinates (i.e., before the DefaultScale has been applied), relative to the top-left corner of the ActiveArea rectangle.", },
    { tag: 50720, name: "Exif.Image.DefaultCropSize", description: "Raw images often store extra pixels around the edges of the final image. These extra pixels help prevent interpolation artifacts near the edges of the final image. DefaultCropSize specifies the size of the final image area, in raw image coordinates (i.e., before the DefaultScale has been applied).", },
    { tag: 50721, name: "Exif.Image.ColorMatrix1", description: "ColorMatrix1 defines a transformation matrix that converts XYZ values to reference camera native color space values, under the first calibration illuminant. The matrix values are stored in row scan order. The ColorMatrix1 tag is required for all non-monochrome DNG files.", },
    { tag: 50722, name: "Exif.Image.ColorMatrix2", description: "ColorMatrix2 defines a transformation matrix that converts XYZ values to reference camera native color space values, under the second calibration illuminant. The matrix values are stored in row scan order.", },
    { tag: 50723, name: "Exif.Image.CameraCalibration1", description: "CameraCalibration1 defines a calibration matrix that transforms reference camera native space values to individual camera native space values under the first calibration illuminant. The matrix is stored in row scan order. This matrix is stored separately from the matrix specified by the ColorMatrix1 tag to allow raw converters to swap in replacement color matrices based on UniqueCameraModel tag, while still taking advantage of any per-individual camera calibration performed by the camera manufacturer.", },
    { tag: 50724, name: "Exif.Image.CameraCalibration2", description: "CameraCalibration2 defines a calibration matrix that transforms reference camera native space values to individual camera native space values under the second calibration illuminant. The matrix is stored in row scan order. This matrix is stored separately from the matrix specified by the ColorMatrix2 tag to allow raw converters to swap in replacement color matrices based on UniqueCameraModel tag, while still taking advantage of any per-individual camera calibration performed by the camera manufacturer.", },
    { tag: 50725, name: "Exif.Image.ReductionMatrix1", description: "ReductionMatrix1 defines a dimensionality reduction matrix for use as the first stage in converting color camera native space values to XYZ values, under the first calibration illuminant. This tag may only be used if ColorPlanes is greater than 3. The matrix is stored in row scan order.", },
    { tag: 50726, name: "Exif.Image.ReductionMatrix2", description: "ReductionMatrix2 defines a dimensionality reduction matrix for use as the first stage in converting color camera native space values to XYZ values, under the second calibration illuminant. This tag may only be used if ColorPlanes is greater than 3. The matrix is stored in row scan order.", },
    { tag: 50727, name: "Exif.Image.AnalogBalance", description: "Normally the stored raw values are not white balanced, since any digital white balancing will reduce the dynamic range of the final image if the user decides to later adjust the white balance; however, if camera hardware is capable of white balancing the color channels before the signal is digitized, it can improve the dynamic range of the final image. AnalogBalance defines the gain, either analog (recommended) or digital (not recommended) that has been applied the stored raw values.", },
    { tag: 50728, name: "Exif.Image.AsShotNeutral", description: "Specifies the selected white balance at time of capture, encoded as the coordinates of a perfectly neutral color in linear reference space values. The inclusion of this tag precludes the inclusion of the AsShotWhiteXY tag.", },
    { tag: 50729, name: "Exif.Image.AsShotWhiteXY", description: "Specifies the selected white balance at time of capture, encoded as x-y chromaticity coordinates. The inclusion of this tag precludes the inclusion of the AsShotNeutral tag.", },
    { tag: 50730, name: "Exif.Image.BaselineExposure", description: "Camera models vary in the trade-off they make between highlight headroom and shadow noise. Some leave a significant amount of highlight headroom during a normal exposure. This allows significant negative exposure compensation to be applied during raw conversion, but also means normal exposures will contain more shadow noise. Other models leave less headroom during normal exposures. This allows for less negative exposure compensation, but results in lower shadow noise for normal exposures. Because of these differences, a raw converter needs to vary the zero point of its exposure compensation control from model to model. BaselineExposure specifies by how much (in EV units) to move the zero point. Positive values result in brighter default results, while negative values result in darker default results.", },
    { tag: 50731, name: "Exif.Image.BaselineNoise", description: "Specifies the relative noise level of the camera model at a baseline ISO value of 100, compared to a reference camera model. Since noise levels tend to vary approximately with the square root of the ISO value, a raw converter can use this value, combined with the current ISO, to estimate the relative noise level of the current image.", },
    { tag: 50732, name: "Exif.Image.BaselineSharpness", description: "Specifies the relative amount of sharpening required for this camera model, compared to a reference camera model. Camera models vary in the strengths of their anti-aliasing filters. Cameras with weak or no filters require less sharpening than cameras with strong anti-aliasing filters.", },
    { tag: 50733, name: "Exif.Image.BayerGreenSplit", description: "Only applies to CFA images using a Bayer pattern filter array. This tag specifies, in arbitrary units, how closely the values of the green pixels in the blue/green rows track the values of the green pixels in the red/green rows. A value of zero means the two kinds of green pixels track closely, while a non-zero value means they sometimes diverge. The useful range for this tag is from 0 (no divergence) to about 5000 (quite large divergence).", },
    { tag: 50734, name: "Exif.Image.LinearResponseLimit", description: "Some sensors have an unpredictable non-linearity in their response as they near the upper limit of their encoding range. This non-linearity results in color shifts in the highlight areas of the resulting image unless the raw converter compensates for this effect. LinearResponseLimit specifies the fraction of the encoding range above which the response may become significantly non-linear.", },
    { tag: 50735, name: "Exif.Image.CameraSerialNumber", description: "CameraSerialNumber contains the serial number of the camera or camera body that captured the image.", },
    { tag: 50736, name: "Exif.Image.LensInfo", description: "Contains information about the lens that captured the image. If the minimum f-stops are unknown, they should be encoded as 0/0.", },
    { tag: 50737, name: "Exif.Image.ChromaBlurRadius", description: "ChromaBlurRadius provides a hint to the DNG reader about how much chroma blur should be applied to the image. If this tag is omitted, the reader will use its default amount of chroma blurring. Normally this tag is only included for non-CFA images, since the amount of chroma blur required for mosaic images is highly dependent on the de-mosaic algorithm, in which case the DNG reader's default value is likely optimized for its particular de-mosaic algorithm.", },
    { tag: 50738, name: "Exif.Image.AntiAliasStrength", description: "Provides a hint to the DNG reader about how strong the camera's anti-alias filter is. A value of 0.0 means no anti-alias filter (i.e., the camera is prone to aliasing artifacts with some subjects), while a value of 1.0 means a strong anti-alias filter (i.e., the camera almost never has aliasing artifacts).", },
    { tag: 50739, name: "Exif.Image.ShadowScale", description: "This tag is used by Adobe Camera Raw to control the sensitivity of its 'Shadows' slider.", },
    { tag: 50740, name: "Exif.Image.DNGPrivateData", description: "Provides a way for camera manufacturers to store private data in the DNG file for use by their own raw converters, and to have that data preserved by programs that edit DNG files.", },
    { tag: 50741, name: "Exif.Image.MakerNoteSafety", description: "MakerNoteSafety lets the DNG reader know whether the EXIF MakerNote tag is safe to preserve along with the rest of the EXIF data. File browsers and other image management software processing an image with a preserved MakerNote should be aware that any thumbnail image embedded in the MakerNote may be stale, and may not reflect the current state of the full size image.", },
    { tag: 50778, name: "Exif.Image.CalibrationIlluminant1", description: "The illuminant used for the first set of color calibration tags (ColorMatrix1, CameraCalibration1, ReductionMatrix1). The legal values for this tag are the same as the legal values for the LightSource EXIF tag. If set to 255 (Other), then the IFD must also include a IlluminantData1 tag to specify the x-y chromaticity or spectral power distribution function for this illuminant.", },
    { tag: 50779, name: "Exif.Image.CalibrationIlluminant2", description: "The illuminant used for an optional second set of color calibration tags (ColorMatrix2, CameraCalibration2, ReductionMatrix2). The legal values for this tag are the same as the legal values for the CalibrationIlluminant1 tag; however, if both are included, neither is allowed to have a value of 0 (unknown). If set to 255 (Other), then the IFD must also include a IlluminantData2 tag to specify the x-y chromaticity or spectral power distribution function for this illuminant.", },
    { tag: 50780, name: "Exif.Image.BestQualityScale", description: "For some cameras, the best possible image quality is not achieved by preserving the total pixel count during conversion. For example, Fujifilm SuperCCD images have maximum detail when their total pixel count is doubled. This tag specifies the amount by which the values of the DefaultScale tag need to be multiplied to achieve the best quality image size.", },
    { tag: 50781, name: "Exif.Image.RawDataUniqueID", description: "This tag contains a 16-byte unique identifier for the raw image data in the DNG file. DNG readers can use this tag to recognize a particular raw image, even if the file's name or the metadata contained in the file has been changed. If a DNG writer creates such an identifier, it should do so using an algorithm that will ensure that it is very unlikely two different images will end up having the same identifier.", },
    { tag: 50827, name: "Exif.Image.OriginalRawFileName", description: "If the DNG file was converted from a non-DNG raw file, then this tag contains the file name of that original raw file.", },
    { tag: 50828, name: "Exif.Image.OriginalRawFileData", description: "If the DNG file was converted from a non-DNG raw file, then this tag contains the compressed contents of that original raw file. The contents of this tag always use the big-endian byte order. The tag contains a sequence of data blocks. Future versions of the DNG specification may define additional data blocks, so DNG readers should ignore extra bytes when parsing this tag. DNG readers should also detect the case where data blocks are missing from the end of the sequence, and should assume a default value for all the missing blocks. There are no padding or alignment bytes between data blocks.", },
    { tag: 50829, name: "Exif.Image.ActiveArea", description: "This rectangle defines the active (non-masked) pixels of the sensor. The order of the rectangle coordinates is: top, left, bottom, right.", },
    { tag: 50830, name: "Exif.Image.MaskedAreas", description: "This tag contains a list of non-overlapping rectangle coordinates of fully masked pixels, which can be optionally used by DNG readers to measure the black encoding level. The order of each rectangle's coordinates is: top, left, bottom, right. If the raw image data has already had its black encoding level subtracted, then this tag should not be used, since the masked pixels are no longer useful.", },
    { tag: 50831, name: "Exif.Image.AsShotICCProfile", description: "This tag contains an ICC profile that, in conjunction with the AsShotPreProfileMatrix tag, provides the camera manufacturer with a way to specify a default color rendering from camera color space coordinates (linear reference values) into the ICC profile connection space. The ICC profile connection space is an output referred colorimetric space, whereas the other color calibration tags in DNG specify a conversion into a scene referred colorimetric space. This means that the rendering in this profile should include any desired tone and gamut mapping needed to convert between scene referred values and output referred values.", },
    { tag: 50832, name: "Exif.Image.AsShotPreProfileMatrix", description: "This tag is used in conjunction with the AsShotICCProfile tag. It specifies a matrix that should be applied to the camera color space coordinates before processing the values through the ICC profile specified in the AsShotICCProfile tag. The matrix is stored in the row scan order. If ColorPlanes is greater than three, then this matrix can (but is not required to) reduce the dimensionality of the color data down to three components, in which case the AsShotICCProfile should have three rather than ColorPlanes input components.", },
    { tag: 50833, name: "Exif.Image.CurrentICCProfile", description: "This tag is used in conjunction with the CurrentPreProfileMatrix tag. The CurrentICCProfile and CurrentPreProfileMatrix tags have the same purpose and usage as the AsShotICCProfile and AsShotPreProfileMatrix tag pair, except they are for use by raw file editors rather than camera manufacturers.", },
    { tag: 50834, name: "Exif.Image.CurrentPreProfileMatrix", description: "This tag is used in conjunction with the CurrentICCProfile tag. The CurrentICCProfile and CurrentPreProfileMatrix tags have the same purpose and usage as the AsShotICCProfile and AsShotPreProfileMatrix tag pair, except they are for use by raw file editors rather than camera manufacturers.", },
    { tag: 50879, name: "Exif.Image.ColorimetricReference", description: "The DNG color model documents a transform between camera colors and CIE XYZ values. This tag describes the colorimetric reference for the CIE XYZ values. 0 = The XYZ values are scene-referred. 1 = The XYZ values are output-referred, using the ICC profile perceptual dynamic range. This tag allows output-referred data to be stored in DNG files and still processed correctly by DNG readers.", },
    { tag: 50931, name: "Exif.Image.CameraCalibrationSignature", description: "A UTF-8 encoded string associated with the CameraCalibration1 and CameraCalibration2 tags. The CameraCalibration1 and CameraCalibration2 tags should only be used in the DNG color transform if the string stored in the CameraCalibrationSignature tag exactly matches the string stored in the ProfileCalibrationSignature tag for the selected camera profile.", },
    { tag: 50932, name: "Exif.Image.ProfileCalibrationSignature", description: "A UTF-8 encoded string associated with the camera profile tags. The CameraCalibration1 and CameraCalibration2 tags should only be used in the DNG color transfer if the string stored in the CameraCalibrationSignature tag exactly matches the string stored in the ProfileCalibrationSignature tag for the selected camera profile.", },
    { tag: 50933, name: "Exif.Image.ExtraCameraProfiles", description: "A list of file offsets to extra Camera Profile IFDs. Note that the primary camera profile tags should be stored in IFD 0, and the ExtraCameraProfiles tag should only be used if there is more than one camera profile stored in the DNG file.", },
    { tag: 50934, name: "Exif.Image.AsShotProfileName", description: "A UTF-8 encoded string containing the name of the \"as shot\" camera profile, if any.", },
    { tag: 50935, name: "Exif.Image.NoiseReductionApplied", description: "This tag indicates how much noise reduction has been applied to the raw data on a scale of 0.0 to 1.0. A 0.0 value indicates that no noise reduction has been applied. A 1.0 value indicates that the \"ideal\" amount of noise reduction has been applied, i.e. that the DNG reader should not apply additional noise reduction by default. A value of 0/0 indicates that this parameter is unknown.", },
    { tag: 50936, name: "Exif.Image.ProfileName", description: "A UTF-8 encoded string containing the name of the camera profile. This tag is optional if there is only a single camera profile stored in the file but is required for all camera profiles if there is more than one camera profile stored in the file.", },
    { tag: 50937, name: "Exif.Image.ProfileHueSatMapDims", description: "This tag specifies the number of input samples in each dimension of the hue/saturation/value mapping tables. The data for these tables are stored in ProfileHueSatMapData1, ProfileHueSatMapData2 and ProfileHueSatMapData3 tags. The most common case has ValueDivisions equal to 1, so only hue and saturation are used as inputs to the mapping table.", },
    { tag: 50938, name: "Exif.Image.ProfileHueSatMapData1", description: "This tag contains the data for the first hue/saturation/value mapping table. Each entry of the table contains three 32-bit IEEE floating-point values. The first entry is hue shift in degrees; the second entry is saturation scale factor; and the third entry is a value scale factor. The table entries are stored in the tag in nested loop order, with the value divisions in the outer loop, the hue divisions in the middle loop, and the saturation divisions in the inner loop. All zero input saturation entries are required to have a value scale factor of 1.0.", },
    { tag: 50939, name: "Exif.Image.ProfileHueSatMapData2", description: "This tag contains the data for the second hue/saturation/value mapping table. Each entry of the table contains three 32-bit IEEE floating-point values. The first entry is hue shift in degrees; the second entry is a saturation scale factor; and the third entry is a value scale factor. The table entries are stored in the tag in nested loop order, with the value divisions in the outer loop, the hue divisions in the middle loop, and the saturation divisions in the inner loop. All zero input saturation entries are required to have a value scale factor of 1.0.", },
    { tag: 50940, name: "Exif.Image.ProfileToneCurve", description: "This tag contains a default tone curve that can be applied while processing the image as a starting point for user adjustments. The curve is specified as a list of 32-bit IEEE floating-point value pairs in linear gamma. Each sample has an input value in the range of 0.0 to 1.0, and an output value in the range of 0.0 to 1.0. The first sample is required to be (0.0, 0.0), and the last sample is required to be (1.0, 1.0). Interpolated the curve using a cubic spline.", },
    { tag: 50941, name: "Exif.Image.ProfileEmbedPolicy", description: "This tag contains information about the usage rules for the associated camera profile.", },
    { tag: 50942, name: "Exif.Image.ProfileCopyright", description: "A UTF-8 encoded string containing the copyright information for the camera profile. This string always should be preserved along with the other camera profile tags.", },
    { tag: 50964, name: "Exif.Image.ForwardMatrix1", description: "This tag defines a matrix that maps white balanced camera colors to XYZ D50 colors.", },
    { tag: 50965, name: "Exif.Image.ForwardMatrix2", description: "This tag defines a matrix that maps white balanced camera colors to XYZ D50 colors.", },
    { tag: 50966, name: "Exif.Image.PreviewApplicationName", description: "A UTF-8 encoded string containing the name of the application that created the preview stored in the IFD.", },
    { tag: 50967, name: "Exif.Image.PreviewApplicationVersion", description: "A UTF-8 encoded string containing the version number of the application that created the preview stored in the IFD.", },
    { tag: 50968, name: "Exif.Image.PreviewSettingsName", description: "A UTF-8 encoded string containing the name of the conversion settings (for example, snapshot name) used for the preview stored in the IFD.", },
    { tag: 50969, name: "Exif.Image.PreviewSettingsDigest", description: "A unique ID of the conversion settings (for example, MD5 digest) used to render the preview stored in the IFD.", },
    { tag: 50970, name: "Exif.Image.PreviewColorSpace", description: "This tag specifies the color space in which the rendered preview in this IFD is stored. The default value for this tag is sRGB for color previews and Gray Gamma 2.2 for monochrome previews.", },
    { tag: 50971, name: "Exif.Image.PreviewDateTime", description: "This tag is an ASCII string containing the name of the date/time at which the preview stored in the IFD was rendered. The date/time is encoded using ISO 8601 format.", },
    { tag: 50972, name: "Exif.Image.RawImageDigest", description: "This tag is an MD5 digest of the raw image data. All pixels in the image are processed in row-scan order. Each pixel is zero padded to 16 or 32 bits deep (16-bit for data less than or equal to 16 bits deep, 32-bit otherwise). The data for each pixel is processed in little-endian byte order.", },
    { tag: 50973, name: "Exif.Image.OriginalRawFileDigest", description: "This tag is an MD5 digest of the data stored in the OriginalRawFileData tag.", },
    { tag: 50974, name: "Exif.Image.SubTileBlockSize", description: "Normally, the pixels within a tile are stored in simple row-scan order. This tag specifies that the pixels within a tile should be grouped first into rectangular blocks of the specified size. These blocks are stored in row-scan order. Within each block, the pixels are stored in row-scan order. The use of a non-default value for this tag requires setting the DNGBackwardVersion tag to at least 1.2.0.0.", },
    { tag: 50975, name: "Exif.Image.RowInterleaveFactor", description: "This tag specifies that rows of the image are stored in interleaved order. The value of the tag specifies the number of interleaved fields. The use of a non-default value for this tag requires setting the DNGBackwardVersion tag to at least 1.2.0.0.", },
    { tag: 50981, name: "Exif.Image.ProfileLookTableDims", description: "This tag specifies the number of input samples in each dimension of a default \"look\" table. The data for this table is stored in the ProfileLookTableData tag.", },
    { tag: 50982, name: "Exif.Image.ProfileLookTableData", description: "This tag contains a default \"look\" table that can be applied while processing the image as a starting point for user adjustment. This table uses the same format as the tables stored in the ProfileHueSatMapData1 and ProfileHueSatMapData2 tags, and is applied in the same color space. However, it should be applied later in the processing pipe, after any exposure compensation and/or fill light stages, but before any tone curve stage. Each entry of the table contains three 32-bit IEEE floating-point values. The first entry is hue shift in degrees, the second entry is a saturation scale factor, and the third entry is a value scale factor. The table entries are stored in the tag in nested loop order, with the value divisions in the outer loop, the hue divisions in the middle loop, and the saturation divisions in the inner loop. All zero input saturation entries are required to have a value scale factor of 1.0.", },
    { tag: 51008, name: "Exif.Image.OpcodeList1", description: "Specifies the list of opcodes that should be applied to the raw image, as read directly from the file.", },
    { tag: 51009, name: "Exif.Image.OpcodeList2", description: "Specifies the list of opcodes that should be applied to the raw image, just after it has been mapped to linear reference values.", },
    { tag: 51022, name: "Exif.Image.OpcodeList3", description: "Specifies the list of opcodes that should be applied to the raw image, just after it has been demosaiced.", },
    { tag: 51041, name: "Exif.Image.NoiseProfile", description: "NoiseProfile describes the amount of noise in a raw image. Specifically, this tag models the amount of signal-dependent photon (shot) noise and signal-independent sensor readout noise, two common sources of noise in raw images. The model assumes that the noise is white and spatially independent, ignoring fixed pattern effects and other sources of noise (e.g., pixel response non-uniformity, spatially-dependent thermal effects, etc.).", },
    { tag: 51043, name: "Exif.Image.TimeCodes", description: "The optional TimeCodes tag shall contain an ordered array of time codes. All time codes shall be 8 bytes long and in binary format. The tag may contain from 1 to 10 time codes. When the tag contains more than one time code, the first one shall be the default time code. This specification does not prescribe how to use multiple time codes. Each time code shall be as defined for the 8-byte time code structure in SMPTE 331M-2004, Section 8.3. See also SMPTE 12-1-2008 and SMPTE 309-1999.", },
    { tag: 51044, name: "Exif.Image.FrameRate", description: "The optional FrameRate tag shall specify the video frame rate in number of image frames per second, expressed as a signed rational number. The numerator shall be non-negative and the denominator shall be positive. This field value is identical to the sample rate field in SMPTE 377-1-2009.", },
    { tag: 51058, name: "Exif.Image.TStop", description: "The optional TStop tag shall specify the T-stop of the actual lens, expressed as an unsigned rational number. T-stop is also known as T-number or the photometric aperture of the lens. (F-number is the geometric aperture of the lens.) When the exact value is known, the T-stop shall be specified using a single number. Alternately, two numbers shall be used to indicate a T-stop range, in which case the first number shall be the minimum T-stop and the second number shall be the maximum T-stop.", },
    { tag: 51081, name: "Exif.Image.ReelName", description: "The optional ReelName tag shall specify a name for a sequence of images, where each image in the sequence has a unique image identifier (including but not limited to file name, frame number, date time, time code).", },
    { tag: 51105, name: "Exif.Image.CameraLabel", description: "The optional CameraLabel tag shall specify a text label for how the camera is used or assigned in this clip. This tag is similar to CameraLabel in XMP.", },
    { tag: 51089, name: "Exif.Image.OriginalDefaultFinalSize", description: "If this file is a proxy for a larger original DNG file, this tag specifics the default final size of the larger original file from which this proxy was generated. The default value for this tag is default final size of the current DNG file, which is DefaultCropSize * DefaultScale.", },
    { tag: 51090, name: "Exif.Image.OriginalBestQualityFinalSize", description: "If this file is a proxy for a larger original DNG file, this tag specifics the best quality final size of the larger original file from which this proxy was generated. The default value for this tag is the OriginalDefaultFinalSize, if specified. Otherwise the default value for this tag is the best quality size of the current DNG file, which is DefaultCropSize * DefaultScale * BestQualityScale.", },
    { tag: 51091, name: "Exif.Image.OriginalDefaultCropSize", description: "If this file is a proxy for a larger original DNG file, this tag specifics the DefaultCropSize of the larger original file from which this proxy was generated. The default value for this tag is OriginalDefaultFinalSize, if specified. Otherwise, the default value for this tag is the DefaultCropSize of the current DNG file.", },
    { tag: 51107, name: "Exif.Image.ProfileHueSatMapEncoding", description: "Provides a way for color profiles to specify how indexing into a 3D HueSatMap is performed during raw conversion. This tag is not applicable to 2.5D HueSatMap tables (i.e., where the Value dimension is 1).", },
    { tag: 51108, name: "Exif.Image.ProfileLookTableEncoding", description: "Provides a way for color profiles to specify how indexing into a 3D LookTable is performed during raw conversion. This tag is not applicable to a 2.5D LookTable (i.e., where the Value dimension is 1).", },
    { tag: 51109, name: "Exif.Image.BaselineExposureOffset", description: "Provides a way for color profiles to increase or decrease exposure during raw conversion. BaselineExposureOffset specifies the amount (in EV units) to add to the BaselineExposure tag during image rendering. For example, if the BaselineExposure value for a given camera model is +0.3, and the BaselineExposureOffset value for a given camera profile used to render an image for that camera model is -0.7, then the actual default exposure value used during rendering will be +0.3 - 0.7 = -0.4.", },
    { tag: 51110, name: "Exif.Image.DefaultBlackRender", description: "This optional tag in a color profile provides a hint to the raw converter regarding how to handle the black point (e.g., flare subtraction) during rendering. If set to Auto, the raw converter should perform black subtraction during rendering. If set to None, the raw converter should not perform any black subtraction during rendering.", },
    { tag: 51111, name: "Exif.Image.NewRawImageDigest", description: "This tag is a modified MD5 digest of the raw image data. It has been updated from the algorithm used to compute the RawImageDigest tag be more multi-processor friendly, and to support lossy compression algorithms.", },
    { tag: 51112, name: "Exif.Image.RawToPreviewGain", description: "The gain (what number the sample values are multiplied by) between the main raw IFD and the preview IFD containing this tag.", },
    { tag: 51125, name: "Exif.Image.DefaultUserCrop", description: "Specifies a default user crop rectangle in relative coordinates. The values must satisfy: 0.0 <= top < bottom <= 1.0, 0.0 <= left < right <= 1.0.The default values of (top = 0, left = 0, bottom = 1, right = 1) correspond exactly to the default crop rectangle (as specified by the DefaultCropOrigin and DefaultCropSize tags).", },
    { tag: 51177, name: "Exif.Image.DepthFormat", description: "Specifies the encoding of any depth data in the file. Can be unknown (apart from nearer distances being closer to zero, and farther distances being closer to the maximum value), linear (values vary linearly from zero representing DepthNear to the maximum value representing DepthFar), or inverse (values are stored inverse linearly, with zero representing DepthNear and the maximum value representing DepthFar).", },
    { tag: 51178, name: "Exif.Image.DepthNear", description: "Specifies distance from the camera represented by the zero value in the depth map. 0/0 means unknown.", },
    { tag: 51179, name: "Exif.Image.DepthFar", description: "Specifies distance from the camera represented by the maximum value in the depth map. 0/0 means unknown. 1/0 means infinity, which is valid for unknown and inverse depth formats.", },
    { tag: 51180, name: "Exif.Image.DepthUnits", description: "Specifies the measurement units for the DepthNear and DepthFar tags.", },
    { tag: 51181, name: "Exif.Image.DepthMeasureType", description: "Specifies the measurement geometry for the depth map. Can be unknown, measured along the optical axis, or measured along the optical ray passing through each pixel.", },
    { tag: 51182, name: "Exif.Image.EnhanceParams", description: "A string that documents how the enhanced image data was processed.", },
    { tag: 52525, name: "Exif.Image.ProfileGainTableMap", description: "Contains spatially varying gain tables that can be applied while processing the image as a starting point for user adjustments.", },
    { tag: 52526, name: "Exif.Image.SemanticName", description: "A string that identifies the semantic mask.", },
    { tag: 52528, name: "Exif.Image.SemanticInstanceID", description: "A string that identifies a specific instance in a semantic mask.", },
    { tag: 52529, name: "Exif.Image.CalibrationIlluminant3", description: "The illuminant used for an optional third set of color calibration tags (ColorMatrix3, CameraCalibration3, ReductionMatrix3). The legal values for this tag are the same as the legal values for the LightSource EXIF tag; CalibrationIlluminant1 and CalibrationIlluminant2 must also be present. If set to 255 (Other), then the IFD must also include a IlluminantData3 tag to specify the x-y chromaticity or spectral power distribution function for this illuminant.", },
    { tag: 52530, name: "Exif.Image.CameraCalibration3", description: "CameraCalibration3 defines a calibration matrix that transforms reference camera native space values to individual camera native space values under the third calibration illuminant. The matrix is stored in row scan order. This matrix is stored separately from the matrix specified by the ColorMatrix3 tag to allow raw converters to swap in replacement color matrices based on UniqueCameraModel tag, while still taking advantage of any per-individual camera calibration performed by the camera manufacturer.", },
    { tag: 52531, name: "Exif.Image.ColorMatrix3", description: "ColorMatrix3 defines a transformation matrix that converts XYZ values to reference camera native color space values, under the third calibration illuminant. The matrix values are stored in row scan order.", },
    { tag: 52532, name: "Exif.Image.ForwardMatrix3", description: "This tag defines a matrix that maps white balanced camera colors to XYZ D50 colors.", },
    { tag: 52533, name: "Exif.Image.IlluminantData1", description: "When the CalibrationIlluminant1 tag is set to 255 (Other), then the IlluminantData1 tag is required and specifies the data for the first illuminant. Otherwise, this tag is ignored. The illuminant data may be specified as either a x-y chromaticity coordinate or as a spectral power distribution function.", },
    { tag: 52534, name: "Exif.Image.IlluminantData2", description: "When the CalibrationIlluminant2 tag is set to 255 (Other), then the IlluminantData2 tag is required and specifies the data for the second illuminant. Otherwise, this tag is ignored. The format of the data is the same as IlluminantData1.", },
    { tag: 52535, name: "Exif.Image.IlluminantData3", description: "When the CalibrationIlluminant3 tag is set to 255 (Other), then the IlluminantData3 tag is required and specifies the data for the third illuminant. Otherwise, this tag is ignored. The format of the data is the same as IlluminantData1.", },
    { tag: 52536, name: "Exif.Image.MaskSubArea", description: "This tag identifies the crop rectangle of this IFD's mask, relative to the main image.", },
    { tag: 52537, name: "Exif.Image.ProfileHueSatMapData3", description: "This tag contains the data for the third hue/saturation/value mapping table. Each entry of the table contains three 32-bit IEEE floating-point values. The first entry is hue shift in degrees; the second entry is saturation scale factor; and the third entry is a value scale factor. The table entries are stored in the tag in nested loop order, with the value divisions in the outer loop, the hue divisions in the middle loop, and the saturation divisions in the inner loop. All zero input saturation entries are required to have a value scale factor of 1.0.", },
    { tag: 52538, name: "Exif.Image.ReductionMatrix3", description: "ReductionMatrix3 defines a dimensionality reduction matrix for use as the first stage in converting color camera native space values to XYZ values, under the third calibration illuminant. This tag may only be used if ColorPlanes is greater than 3. The matrix is stored in row scan order.", },
    { tag: 52543, name: "Exif.Image.RGBTables", description: "This tag specifies color transforms that can be applied to masked image regions. Color transforms are specified using RGB-to-RGB color lookup tables. These tables are associated with Semantic Masks to limit the color transform to a sub-region of the image. The overall color transform is a linear combination of the color tables, weighted by their corresponding Semantic Masks.", },
    { tag: 52544, name: "Exif.Image.ProfileGainTableMap2", description: "This tag is an extended version of ProfileGainTableMap.", },
    { tag: 52547, name: "Exif.Image.ColumnInterleaveFactor", description: "This tag specifies that columns of the image are stored in interleaved order. The value of the tag specifies the number of interleaved fields. The use of a non-default value for this tag requires setting the DNGBackwardVersion tag to at least 1.7.1.0.", },
    { tag: 52548, name: "Exif.Image.ImageSequenceInfo", description: "This is an informative tag that describes how the image file relates to other image files captured in a sequence. Applications include focus stacking, merging multiple frames to reduce noise, time lapses, exposure brackets, stitched images for super resolution, and so on.", },
    { tag: 52550, name: "Exif.Image.ImageStats", description: "This is an informative tag that provides basic statistical information about the pixel values of the image in this IFD. Possible applications include normalizing brightness of images when multiple images are displayed together (especially when mixing Standard Dynamic Range and High Dynamic Range images), identifying underexposed or overexposed images, and so on.", },
    { tag: 52551, name: "Exif.Image.ProfileDynamicRange", description: "This tag describes the intended rendering output dynamic range for a given camera profile.", },
    { tag: 52552, name: "Exif.Image.ProfileGroupName", description: "A UTF-8 encoded string containing the 'group name' of the camera profile. The purpose of this tag is to associate two or more related camera profiles into a common group.", },
    { tag: 52553, name: "Exif.Image.JXLDistance", description: "This optional tag specifies the distance parameter used to encode the JPEG XL data in this IFD. A value of 0.0 means lossless compression, while values greater than 0.0 means lossy compression.", },
    { tag: 52554, name: "Exif.Image.JXLEffort", description: "This optional tag specifies the effort parameter used to encode the JPEG XL data in this IFD. Values range from 1 (low) to 9 (high).", },
    { tag: 52555, name: "Exif.Image.JXLDecodeSpeed", description: "This optional tag specifies the decode speed parameter used to encode the JPEG XL data in this IFD. Values range from 1 (slow) to 4 (fast).", },
    { tag: 33434, name: "Exif.Photo.ExposureTime", description: "Exposure time, given in seconds (sec).", },
    { tag: 33437, name: "Exif.Photo.FNumber", description: "The F number.", },
    { tag: 34850, name: "Exif.Photo.ExposureProgram", description: "The class of the program used by the camera to set exposure when the picture is taken.", },
    { tag: 34852, name: "Exif.Photo.SpectralSensitivity", description: "Indicates the spectral sensitivity of each channel of the camera used. The tag value is an ASCII string compatible with the standard developed by the ASTM Technical Committee.", },
    { tag: 34855, name: "Exif.Photo.ISOSpeedRatings", description: "Indicates the ISO Speed and ISO Latitude of the camera or input device as specified in ISO 12232.", },
    { tag: 34856, name: "Exif.Photo.OECF", description: "Indicates the Opto-Electoric Conversion Function (OECF) specified in ISO 14524. <OECF> is the relationship between the camera optical input and the image values.", },
    { tag: 34864, name: "Exif.Photo.SensitivityType", description: "The SensitivityType tag indicates which one of the parameters of ISO12232 is the PhotographicSensitivity tag. Although it is an optional tag, it should be recorded when a PhotographicSensitivity tag is recorded. Value = 4, 5, 6, or 7 may be used in case that the values of plural parameters are the same.", },
    { tag: 34865, name: "Exif.Photo.StandardOutputSensitivity", description: "This tag indicates the standard output sensitivity value of a camera or input device defined in ISO 12232. When recording this tag, the PhotographicSensitivity and SensitivityType tags shall also be recorded.", },
    { tag: 34866, name: "Exif.Photo.RecommendedExposureIndex", description: "This tag indicates the recommended exposure index value of a camera or input device defined in ISO 12232. When recording this tag, the PhotographicSensitivity and SensitivityType tags shall also be recorded.", },
    { tag: 34867, name: "Exif.Photo.ISOSpeed", description: "This tag indicates the ISO speed value of a camera or input device that is defined in ISO 12232. When recording this tag, the PhotographicSensitivity and SensitivityType tags shall also be recorded.", },
    { tag: 34868, name: "Exif.Photo.ISOSpeedLatitudeyyy", description: "This tag indicates the ISO speed latitude yyy value of a camera or input device that is defined in ISO 12232. However, this tag shall not be recorded without ISOSpeed and ISOSpeedLatitudezzz.", },
    { tag: 34869, name: "Exif.Photo.ISOSpeedLatitudezzz", description: "This tag indicates the ISO speed latitude zzz value of a camera or input device that is defined in ISO 12232. However, this tag shall not be recorded without ISOSpeed and ISOSpeedLatitudeyyy.", },
    { tag: 36864, name: "Exif.Photo.ExifVersion", description: "The version of this standard supported. Nonexistence of this field is taken to mean nonconformance to the standard.", },
    { tag: 36867, name: "Exif.Photo.DateTimeOriginal", description: "The date and time when the original image data was generated. For a digital still camera the date and time the picture was taken are recorded.", },
    { tag: 36868, name: "Exif.Photo.DateTimeDigitized", description: "The date and time when the image was stored as digital data.", },
    { tag: 36880, name: "Exif.Photo.OffsetTime", description: "Time difference from Universal Time Coordinated including daylight saving time of DateTime tag.", },
    { tag: 36881, name: "Exif.Photo.OffsetTimeOriginal", description: "Time difference from Universal Time Coordinated including daylight saving time of DateTimeOriginal tag.", },
    { tag: 36882, name: "Exif.Photo.OffsetTimeDigitized", description: "Time difference from Universal Time Coordinated including daylight saving time of DateTimeDigitized tag.", },
    { tag: 37121, name: "Exif.Photo.ComponentsConfiguration", description: "Information specific to compressed data. The channels of each component are arranged in order from the 1st component to the 4th. For uncompressed data the data arrangement is given in the <PhotometricInterpretation> tag. However, since <PhotometricInterpretation> can only express the order of Y, Cb and Cr, this tag is provided for cases when compressed data uses components other than Y, Cb, and Cr and to enable support of other sequences.", },
    { tag: 37122, name: "Exif.Photo.CompressedBitsPerPixel", description: "Information specific to compressed data. The compression mode used for a compressed image is indicated in unit bits per pixel.", },
    { tag: 37377, name: "Exif.Photo.ShutterSpeedValue", description: "Shutter speed. The unit is the APEX (Additive System of Photographic Exposure) setting.", },
    { tag: 37378, name: "Exif.Photo.ApertureValue", description: "The lens aperture. The unit is the APEX value.", },
    { tag: 37379, name: "Exif.Photo.BrightnessValue", description: "The value of brightness. The unit is the APEX value. Ordinarily it is given in the range of -99.99 to 99.99.", },
    { tag: 37380, name: "Exif.Photo.ExposureBiasValue", description: "The exposure bias. The units is the APEX value. Ordinarily it is given in the range of -99.99 to 99.99.", },
    { tag: 37381, name: "Exif.Photo.MaxApertureValue", description: "The smallest F number of the lens. The unit is the APEX value. Ordinarily it is given in the range of 00.00 to 99.99, but it is not limited to this range.", },
    { tag: 37382, name: "Exif.Photo.SubjectDistance", description: "The distance to the subject, given in meters.", },
    { tag: 37383, name: "Exif.Photo.MeteringMode", description: "The metering mode.", },
    { tag: 37384, name: "Exif.Photo.LightSource", description: "The kind of light source.", },
    { tag: 37385, name: "Exif.Photo.Flash", description: "This tag is recorded when an image is taken using a strobe light (flash).", },
    { tag: 37386, name: "Exif.Photo.FocalLength", description: "The actual focal length of the lens, in mm. Conversion is not made to the focal length of a 35 mm film camera.", },
    { tag: 37396, name: "Exif.Photo.SubjectArea", description: "This tag indicates the location and area of the main subject in the overall scene.", },
    { tag: 37500, name: "Exif.Photo.MakerNote", description: "A tag for manufacturers of Exif writers to record any desired information. The contents are up to the manufacturer.", },
    { tag: 37510, name: "Exif.Photo.UserComment", description: "A tag for Exif users to write keywords or comments on the image besides those in <ImageDescription>, and without the character code limitations of the <ImageDescription> tag.", },
    { tag: 37520, name: "Exif.Photo.SubSecTime", description: "A tag used to record fractions of seconds for the <DateTime> tag.", },
    { tag: 37521, name: "Exif.Photo.SubSecTimeOriginal", description: "A tag used to record fractions of seconds for the <DateTimeOriginal> tag.", },
    { tag: 37522, name: "Exif.Photo.SubSecTimeDigitized", description: "A tag used to record fractions of seconds for the <DateTimeDigitized> tag.", },
    { tag: 37888, name: "Exif.Photo.Temperature", description: "Temperature as the ambient situation at the shot, for example the room temperature where the photographer was holding the camera. The unit is degrees C.", },
    { tag: 37889, name: "Exif.Photo.Humidity", description: "Humidity as the ambient situation at the shot, for example the room humidity where the photographer was holding the camera. The unit is %.", },
    { tag: 37890, name: "Exif.Photo.Pressure", description: "Pressure as the ambient situation at the shot, for example the room atmosphere where the photographer was holding the camera or the water pressure under the sea. The unit is hPa.", },
    { tag: 37891, name: "Exif.Photo.WaterDepth", description: "Water depth as the ambient situation at the shot, for example the water depth of the camera at underwater photography. The unit is m.", },
    { tag: 37892, name: "Exif.Photo.Acceleration", description: "Acceleration (a scalar regardless of direction) as the ambient situation at the shot, for example the driving acceleration of the vehicle which the photographer rode on at the shot. The unit is mGal (10e-5 m/s^2).", },
    { tag: 37893, name: "Exif.Photo.CameraElevationAngle", description: "Elevation/depression. angle of the orientation of the camera(imaging optical axis) as the ambient situation at the shot. The unit is degrees.", },
    { tag: 40960, name: "Exif.Photo.FlashpixVersion", description: "The FlashPix format version supported by a FPXR file.", },
    { tag: 40961, name: "Exif.Photo.ColorSpace", description: "The color space information tag is always recorded as the color space specifier. Normally sRGB is used to define the color space based on the PC monitor conditions and environment. If a color space other than sRGB is used, Uncalibrated is set. Image data recorded as Uncalibrated can be treated as sRGB when it is converted to FlashPix.", },
    { tag: 40962, name: "Exif.Photo.PixelXDimension", description: "Information specific to compressed data. When a compressed file is recorded, the valid width of the meaningful image must be recorded in this tag, whether or not there is padding data or a restart marker. This tag should not exist in an uncompressed file.", },
    { tag: 40963, name: "Exif.Photo.PixelYDimension", description: "Information specific to compressed data. When a compressed file is recorded, the valid height of the meaningful image must be recorded in this tag, whether or not there is padding data or a restart marker. This tag should not exist in an uncompressed file. Since data padding is unnecessary in the vertical direction, the number of lines recorded in this valid image height tag will in fact be the same as that recorded in the SOF.", },
    { tag: 40964, name: "Exif.Photo.RelatedSoundFile", description: "This tag is used to record the name of an audio file related to the image data. The only relational information recorded here is the Exif audio file name and extension (an ASCII string consisting of 8 characters + '.' + 3 characters). The path is not recorded.", },
    { tag: 40965, name: "Exif.Photo.InteroperabilityTag", description: "Interoperability IFD is composed of tags which stores the information to ensure the Interoperability and pointed by the following tag located in Exif IFD. The Interoperability structure of Interoperability IFD is the same as TIFF defined IFD structure but does not contain the image data characteristically compared with normal TIFF IFD.", },
    { tag: 41483, name: "Exif.Photo.FlashEnergy", description: "Indicates the strobe energy at the time the image is captured, as measured in Beam Candle Power Seconds (BCPS).", },
    { tag: 41484, name: "Exif.Photo.SpatialFrequencyResponse", description: "This tag records the camera or input device spatial frequency table and SFR values in the direction of image width, image height, and diagonal direction, as specified in ISO 12233.", },
    { tag: 41486, name: "Exif.Photo.FocalPlaneXResolution", description: "Indicates the number of pixels in the image width (X) direction per <FocalPlaneResolutionUnit> on the camera focal plane.", },
    { tag: 41487, name: "Exif.Photo.FocalPlaneYResolution", description: "Indicates the number of pixels in the image height (V) direction per <FocalPlaneResolutionUnit> on the camera focal plane.", },
    { tag: 41488, name: "Exif.Photo.FocalPlaneResolutionUnit", description: "Indicates the unit for measuring <FocalPlaneXResolution> and <FocalPlaneYResolution>. This value is the same as the <ResolutionUnit>.", },
    { tag: 41492, name: "Exif.Photo.SubjectLocation", description: "Indicates the location of the main subject in the scene. The value of this tag represents the pixel at the center of the main subject relative to the left edge, prior to rotation processing as per the <Rotation> tag. The first value indicates the X column number and second indicates the Y row number.", },
    { tag: 41493, name: "Exif.Photo.ExposureIndex", description: "Indicates the exposure index selected on the camera or input device at the time the image is captured.", },
    { tag: 41495, name: "Exif.Photo.SensingMethod", description: "Indicates the image sensor type on the camera or input device.", },
    { tag: 41728, name: "Exif.Photo.FileSource", description: "Indicates the image source. If a DSC recorded the image, this tag value of this tag always be set to 3, indicating that the image was recorded on a DSC.", },
    { tag: 41729, name: "Exif.Photo.SceneType", description: "Indicates the type of scene. If a DSC recorded the image, this tag value must always be set to 1, indicating that the image was directly photographed.", },
    { tag: 41730, name: "Exif.Photo.CFAPattern", description: "Indicates the color filter array (CFA) geometric pattern of the image sensor when a one-chip color area sensor is used. It does not apply to all sensing methods.", },
    { tag: 41985, name: "Exif.Photo.CustomRendered", description: "This tag indicates the use of special processing on image data, such as rendering geared to output. When special processing is performed, the reader is expected to disable or minimize any further processing.", },
    { tag: 41986, name: "Exif.Photo.ExposureMode", description: "This tag indicates the exposure mode set when the image was shot. In auto-bracketing mode, the camera shoots a series of frames of the same scene at different exposure settings.", },
    { tag: 41987, name: "Exif.Photo.WhiteBalance", description: "This tag indicates the white balance mode set when the image was shot.", },
    { tag: 41988, name: "Exif.Photo.DigitalZoomRatio", description: "This tag indicates the digital zoom ratio when the image was shot. If the numerator of the recorded value is 0, this indicates that digital zoom was not used.", },
    { tag: 41989, name: "Exif.Photo.FocalLengthIn35mmFilm", description: "This tag indicates the equivalent focal length assuming a 35mm film camera, in mm. A value of 0 means the focal length is unknown. Note that this tag differs from the <FocalLength> tag.", },
    { tag: 41990, name: "Exif.Photo.SceneCaptureType", description: "This tag indicates the type of scene that was shot. It can also be used to record the mode in which the image was shot. Note that this differs from the <SceneType> tag.", },
    { tag: 41991, name: "Exif.Photo.GainControl", description: "This tag indicates the degree of overall image gain adjustment.", },
    { tag: 41992, name: "Exif.Photo.Contrast", description: "This tag indicates the direction of contrast processing applied by the camera when the image was shot.", },
    { tag: 41993, name: "Exif.Photo.Saturation", description: "This tag indicates the direction of saturation processing applied by the camera when the image was shot.", },
    { tag: 41994, name: "Exif.Photo.Sharpness", description: "This tag indicates the direction of sharpness processing applied by the camera when the image was shot.", },
    { tag: 41995, name: "Exif.Photo.DeviceSettingDescription", description: "This tag indicates information on the picture-taking conditions of a particular camera model. The tag is used only to indicate the picture-taking conditions in the reader.", },
    { tag: 41996, name: "Exif.Photo.SubjectDistanceRange", description: "This tag indicates the distance to the subject.", },
    { tag: 42016, name: "Exif.Photo.ImageUniqueID", description: "This tag indicates an identifier assigned uniquely to each image. It is recorded as an ASCII string equivalent to hexadecimal notation and 128-bit fixed length.", },
    { tag: 42032, name: "Exif.Photo.CameraOwnerName", description: "This tag records the owner of a camera used in photography as an ASCII string.", },
    { tag: 42033, name: "Exif.Photo.BodySerialNumber", description: "This tag records the serial number of the body of the camera that was used in photography as an ASCII string.", },
    { tag: 42034, name: "Exif.Photo.LensSpecification", description: "This tag notes minimum focal length, maximum focal length, minimum F number in the minimum focal length, and minimum F number in the maximum focal length, which are specification information for the lens that was used in photography. When the minimum F number is unknown, the notation is 0/0", },
    { tag: 42035, name: "Exif.Photo.LensMake", description: "This tag records the lens manufactor as an ASCII string.", },
    { tag: 42036, name: "Exif.Photo.LensModel", description: "This tag records the lens's model name and model number as an ASCII string.", },
    { tag: 42037, name: "Exif.Photo.LensSerialNumber", description: "This tag records the serial number of the interchangeable lens that was used in photography as an ASCII string.", },
    { tag: 42038, name: "Exif.Photo.ImageTitle", description: "This tag records the title of the image.", },
    { tag: 42039, name: "Exif.Photo.Photographer", description: "This tag records the name of the photographer.", },
    { tag: 42040, name: "Exif.Photo.ImageEditor", description: "This tag records the name of the main person who edited the image. Preferably, a single name is written (individual name, group/organization name, etc.), but multiple main editors may be entered.", },
    { tag: 42041, name: "Exif.Photo.CameraFirmware", description: "This tag records the name and version of the software or firmware of the camera used to generate the image.", },
    { tag: 42042, name: "Exif.Photo.RAWDevelopingSoftware", description: "This tag records the name and version of the software used to develop the RAW image.", },
    { tag: 42043, name: "Exif.Photo.ImageEditingSoftware", description: "This tag records the name and version of the main software used for processing and editing the image. Preferably, a single software is written, but multiple main software may be entered.", },
    { tag: 42044, name: "Exif.Photo.MetadataEditingSoftware", description: "This tag records the name and version of one software used to edit the metadata of the image without processing or editing of the image data itself.", },
    { tag: 42080, name: "Exif.Photo.CompositeImage", description: "Indicates whether the recorded image is a composite image or not.", },
    { tag: 42081, name: "Exif.Photo.SourceImageNumberOfCompositeImage", description: "Indicates the number of the source images (tentatively recorded images) captured for a composite Image.", },
    { tag: 42082, name: "Exif.Photo.SourceExposureTimesOfCompositeImage", description: "For a composite image, records the parameters relating exposure time of the exposures for generating the said composite image, such as respective exposure times of captured source images (tentatively recorded images).", },
    { tag: 42240, name: "Exif.Photo.Gamma", description: "Indicates the value of coefficient gamma. The formula of transfer function used for image reproduction is expressed as follows: (reproduced value) = (input value)^gamma. Both reproduced value and input value indicate normalized value, whose minimum value is 0 and maximum value is 1.", },
    { tag: 1, name: "Exif.Iop.InteroperabilityIndex", description: "Indicates the identification of the Interoperability rule. Use \"R98\" for stating ExifR98 Rules. Four bytes used including the termination code (NULL). see the separate volume of Recommended Exif Interoperability Rules (ExifR98) for other tags used for ExifR98.", },
    { tag: 2, name: "Exif.Iop.InteroperabilityVersion", description: "Interoperability version", },
    { tag: 4096, name: "Exif.Iop.RelatedImageFileFormat", description: "File format of image file", },
    { tag: 4097, name: "Exif.Iop.RelatedImageWidth", description: "Image width", },
    { tag: 4098, name: "Exif.Iop.RelatedImageLength", description: "Image height", },
    { tag: 0, name: "Exif.GPSInfo.GPSVersionID", description: "Indicates the version of <GPSInfoIFD>. The version is given as 2.0.0.0. This tag is mandatory when <GPSInfo> tag is present. (Note: The <GPSVersionID> tag is given in bytes, unlike the <ExifVersion> tag. When the version is 2.0.0.0, the tag value is 02000000.H).", },
    { tag: 1, name: "Exif.GPSInfo.GPSLatitudeRef", description: "Indicates whether the latitude is north or south latitude. The ASCII value 'N' indicates north latitude, and 'S' is south latitude.", },
    { tag: 2, name: "Exif.GPSInfo.GPSLatitude", description: "Indicates the latitude. The latitude is expressed as three RATIONAL values giving the degrees, minutes, and seconds, respectively. When degrees, minutes and seconds are expressed, the format is dd/1,mm/1,ss/1. When degrees and minutes are used and, for example, fractions of minutes are given up to two decimal places, the format is dd/1,mmmm/100,0/1.", },
    { tag: 3, name: "Exif.GPSInfo.GPSLongitudeRef", description: "Indicates whether the longitude is east or west longitude. ASCII 'E' indicates east longitude, and 'W' is west longitude.", },
    { tag: 4, name: "Exif.GPSInfo.GPSLongitude", description: "Indicates the longitude. The longitude is expressed as three RATIONAL values giving the degrees, minutes, and seconds, respectively. When degrees, minutes and seconds are expressed, the format is ddd/1,mm/1,ss/1. When degrees and minutes are used and, for example, fractions of minutes are given up to two decimal places, the format is ddd/1,mmmm/100,0/1.", },
    { tag: 5, name: "Exif.GPSInfo.GPSAltitudeRef", description: "Indicates the altitude used as the reference altitude. If the reference is sea level and the altitude is above sea level, 0 is given. If the altitude is below sea level, a value of 1 is given and the altitude is indicated as an absolute value in the GSPAltitude tag. The reference unit is meters. Note that this tag is BYTE type, unlike other reference tags.", },
    { tag: 6, name: "Exif.GPSInfo.GPSAltitude", description: "Indicates the altitude based on the reference in GPSAltitudeRef. Altitude is expressed as one RATIONAL value. The reference unit is meters.", },
    { tag: 7, name: "Exif.GPSInfo.GPSTimeStamp", description: "Indicates the time as UTC (Coordinated Universal Time). <TimeStamp> is expressed as three RATIONAL values giving the hour, minute, and second (atomic clock).", },
    { tag: 8, name: "Exif.GPSInfo.GPSSatellites", description: "Indicates the GPS satellites used for measurements. This tag can be used to describe the number of satellites, their ID number, angle of elevation, azimuth, SNR and other information in ASCII notation. The format is not specified. If the GPS receiver is incapable of taking measurements, value of the tag is set to NULL.", },
    { tag: 9, name: "Exif.GPSInfo.GPSStatus", description: "Indicates the status of the GPS receiver when the image is recorded. \"A\" means measurement is in progress, and \"V\" means the measurement is Interoperability.", },
    { tag: 10, name: "Exif.GPSInfo.GPSMeasureMode", description: "Indicates the GPS measurement mode. \"2\" means two-dimensional measurement and \"3\" means three-dimensional measurement is in progress.", },
    { tag: 11, name: "Exif.GPSInfo.GPSDOP", description: "Indicates the GPS DOP (data degree of precision). An HDOP value is written during two-dimensional measurement, and PDOP during three-dimensional measurement.", },
    { tag: 12, name: "Exif.GPSInfo.GPSSpeedRef", description: "Indicates the unit used to express the GPS receiver speed of movement. \"K\" \"M\" and \"N\" represents kilometers per hour, miles per hour, and knots.", },
    { tag: 13, name: "Exif.GPSInfo.GPSSpeed", description: "Indicates the speed of GPS receiver movement.", },
    { tag: 14, name: "Exif.GPSInfo.GPSTrackRef", description: "Indicates the reference for giving the direction of GPS receiver movement. \"T\" denotes true direction and \"M\" is magnetic direction.", },
    { tag: 15, name: "Exif.GPSInfo.GPSTrack", description: "Indicates the direction of GPS receiver movement. The range of values is from 0.00 to 359.99.", },
    { tag: 16, name: "Exif.GPSInfo.GPSImgDirectionRef", description: "Indicates the reference for giving the direction of the image when it is captured. \"T\" denotes true direction and \"M\" is magnetic direction.", },
    { tag: 17, name: "Exif.GPSInfo.GPSImgDirection", description: "Indicates the direction of the image when it was captured. The range of values is from 0.00 to 359.99.", },
    { tag: 18, name: "Exif.GPSInfo.GPSMapDatum", description: "Indicates the geodetic survey data used by the GPS receiver. If the survey data is restricted to Japan, the value of this tag is \"TOKYO\" or \"WGS - 84\".", },
    { tag: 19, name: "Exif.GPSInfo.GPSDestLatitudeRef", description: "Indicates whether the latitude of the destination point is north or south latitude. The ASCII value \"N\" indicates north latitude, and \"S\" is south latitude.", },
    { tag: 20, name: "Exif.GPSInfo.GPSDestLatitude", description: "Indicates the latitude of the destination point. The latitude is expressed as three RATIONAL values giving the degrees, minutes, and seconds, respectively. If latitude is expressed as degrees, minutes and seconds, a typical format would be dd/1,mm/1,ss/1. When degrees and minutes are used and, for example, fractions of minutes are given up to two decimal places, the format would be dd/1,mmmm/100,0/1.", },
    { tag: 21, name: "Exif.GPSInfo.GPSDestLongitudeRef", description: "Indicates whether the longitude of the destination point is east or west longitude. ASCII \"E\" indicates east longitude, and \"W\" is west longitude.", },
    { tag: 22, name: "Exif.GPSInfo.GPSDestLongitude", description: "Indicates the longitude of the destination point. The longitude is expressed as three RATIONAL values giving the degrees, minutes, and seconds, respectively. If longitude is expressed as degrees, minutes and seconds, a typical format would be ddd/1,mm/1,ss/1. When degrees and minutes are used and, for example, fractions of minutes are given up to two decimal places, the format would be ddd/1,mmmm/100,0/1.", },
    { tag: 23, name: "Exif.GPSInfo.GPSDestBearingRef", description: "Indicates the reference used for giving the bearing to the destination point. \"T\" denotes true direction and \"M\" is magnetic direction.", },
    { tag: 24, name: "Exif.GPSInfo.GPSDestBearing", description: "Indicates the bearing to the destination point. The range of values is from 0.00 to 359.99.", },
    { tag: 25, name: "Exif.GPSInfo.GPSDestDistanceRef", description: "Indicates the unit used to express the distance to the destination point. \"K\", \"M\" and \"N\" represent kilometers, miles and nautical miles.", },
    { tag: 26, name: "Exif.GPSInfo.GPSDestDistance", description: "Indicates the distance to the destination point.", },
    { tag: 27, name: "Exif.GPSInfo.GPSProcessingMethod", description: "A character string recording the name of the method used for location finding. The string encoding is defined using the same scheme as UserComment.", },
    { tag: 28, name: "Exif.GPSInfo.GPSAreaInformation", description: "A character string recording the name of the GPS area.The string encoding is defined using the same scheme as UserComment.", },
    { tag: 29, name: "Exif.GPSInfo.GPSDateStamp", description: "A character string recording date and time information relative to UTC (Coordinated Universal Time). The format is \"YYYY: MM: DD.\".", },
    { tag: 30, name: "Exif.GPSInfo.GPSDifferential", description: "Indicates whether differential correction is applied to the GPS receiver.", },
    { tag: 31, name: "Exif.GPSInfo.GPSHPositioningError", description: "This tag indicates horizontal positioning errors in meters.", },
    { tag: 45056, name: "Exif.MpfInfo.MPFVersion", description: "MPF Version", },
    { tag: 45057, name: "Exif.MpfInfo.MPFNumberOfImages", description: "MPF Number of Images", },
    { tag: 45058, name: "Exif.MpfInfo.MPFImageList", description: "MPF Image List", },
    { tag: 45059, name: "Exif.MpfInfo.MPFImageUIDList", description: "MPF Image UID List", },
    { tag: 45060, name: "Exif.MpfInfo.MPFTotalFrames", description: "MPF Total Frames", },
    { tag: 45313, name: "Exif.MpfInfo.MPFIndividualNum", description: "MPF Individual Num", },
    { tag: 45569, name: "Exif.MpfInfo.MPFPanOrientation", description: "MPFPanOrientation", },
    { tag: 45570, name: "Exif.MpfInfo.MPFPanOverlapH", description: "MPF Pan Overlap Horizontal", },
    { tag: 45571, name: "Exif.MpfInfo.MPFPanOverlapV", description: "MPF Pan Overlap Vertical", },
    { tag: 45572, name: "Exif.MpfInfo.MPFBaseViewpointNum", description: "MPF Base Viewpoint Number", },
    { tag: 45573, name: "Exif.MpfInfo.MPFConvergenceAngle", description: "MPF Convergence Angle", },
    { tag: 45574, name: "Exif.MpfInfo.MPFBaselineLength", description: "MPF Baseline Length", },
    { tag: 45575, name: "Exif.MpfInfo.MPFVerticalDivergence", description: "MPF Vertical Divergence", },
    { tag: 45576, name: "Exif.MpfInfo.MPFAxisDistanceX", description: "MPF Axis Distance X", },
    { tag: 45577, name: "Exif.MpfInfo.MPFAxisDistanceY", description: "MPF Axis Distance Y", },
    { tag: 45578, name: "Exif.MpfInfo.MPFAxisDistanceZ", description: "MPF Axis Distance Z", },
    { tag: 45579, name: "Exif.MpfInfo.MPFYawAngle", description: "MPF Yaw Angle", },
    { tag: 45580, name: "Exif.MpfInfo.MPFPitchAngle", description: "MPF Pitch Angle", },
    { tag: 45581, name: "Exif.MpfInfo.MPFRollAngle", description: "MPF Roll Angle", },
];