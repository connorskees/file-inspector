import React from 'react'
import { Gif, GlobalColorTable, LogicalScreenDescriptor } from './gif'
import { ColorPreview, HiddenBuffer } from './display';

function ColorArrayDisplayer({ colors }: { colors: number[][] }) {
    const colorElements = colors.map(([red, green, blue]) =>
        <ColorPreview
            color={`rgb(${red}, ${green}, ${blue})`}
            name={`${red}, ${green}, ${blue}`}
        />
    )

    if (colors.length > 15) {
        return <HiddenBuffer buffer={colors} />
    }

    return colors;
}

// const GIF_CHUNK_DEFINITIONS = {
//     global_color_table: (gif: Gif) => ({
//         title: "Global Color Table",
//         span: gif.globalColorTable?.span,
//         body: <>{gif.globalColorTable && <ColorArrayDisplayer colors={gif.globalColorTable.colors} />}</>
//     }),
//     logical_screen_descriptor: (gif: Gif) => ({
//         title: "Logical Screen Descriptor",
//         span: gif.logicalScreenDescriptor.span,
//         body: <>{gif.globalColorTable && <ColorArrayDisplayer colors={gif.globalColorTable.colors} />}</>
//     }),
// }


function GifChunkRow({ })

function GlobalColorTableDisplayer({ gct }: { gct: GlobalColorTable }) {
    const colors = gct.colors.map(([red, green, blue]) =>
        <ColorPreview
            color={`rgb(${red}, ${green}, ${blue})`}
            name={`${red}, ${green}, ${blue}`}
        />
    );

    return <tr>
        <td style={{ verticalAlign: 'top', textAlign: 'left' }}>Global Color Table</td>
        <td style={{ verticalAlign: 'top', textAlign: 'right', paddingRight: 16 }}>{gct.span.end - gct.span.start}</td>
        <td style={{ verticalAlign: 'top', textAlign: 'left', width: '80ch' }}>{colors.length > 15 ? <HiddenBuffer buffer={colors} /> : colors}</td>
    </tr>
}

export function GifDisplayer({ gif }: { gif: Gif }) {
    return <>
        <div>
            <table>
                <thead>
                    <tr>
                        <th style={{ textAlign: 'left' }}>Chunk</th>
                        <th style={{ textAlign: 'right', paddingRight: 16 }}>Size</th>
                        <th style={{ textAlign: 'left' }}>Data</th>
                    </tr>
                </thead>
                <tbody>
                    {gif.globalColorTable && <GlobalColorTableDisplayer gct={gif.globalColorTable} />}
                    {/* {chunks?.map(chunk => {
            const isSingle = false; // Object.keys(chunk.parsedData ?? {}).length === 1
            const verticalAlign = isSingle ? 'middle' : "top";
            return <tr>
              <td style={{ verticalAlign, textAlign: 'left' }}>{chunk.name()}</td>
              <td style={{ verticalAlign, textAlign: 'right', paddingRight: 16 }}>{chunk.size()} bytes</td>
              <td style={{ verticalAlign, textAlign: 'left', width: '80ch' }}>{Object.entries(chunk.parsedData ?? {}).map(([key, value]) => {
                return <ChunkDataField png={png} chunk={chunk} fieldName={key} data={value} />
              })}</td>
            </tr>
          })} */}
                    {/* {idatChunks && idatChunks?.length > 3 && <tr>
            <td colSpan={3} style={{ verticalAlign: "top", textAlign: 'center', padding: 32 }}><button onClick={() => setIdatExpanded(v => !v)}>{idatExpanded ? 'Hide' : 'Show'} IDAT</button></td>
          </tr>} */}
                    {/* {idatChunks && idatChunks?.length > 3 && idatExpanded && idatChunks?.map(chunk => {
            return <tr>
              <td style={{ verticalAlign: "top", textAlign: 'left' }}>{chunk.name()}</td>
              <td style={{ verticalAlign: "top", textAlign: 'right', paddingRight: 16 }}>{chunk.size()} bytes</td>
              <td style={{ verticalAlign: "top", textAlign: 'left', width: '80ch' }}>{Object.entries(chunk.parsedData ?? {}).map(([key, value]) => {
                return <ChunkDataField png={png} chunk={chunk} fieldName={key} data={value} />
              })}</td>
            </tr>
          })} */}
                </tbody>
            </table>
        </div>
        {/* {gif.buffer.stringForSpan(gif.header)} */}
    </>
}
