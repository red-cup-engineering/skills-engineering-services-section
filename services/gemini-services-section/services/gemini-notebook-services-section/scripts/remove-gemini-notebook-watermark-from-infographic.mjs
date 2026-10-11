import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";

const MASK_WIDTH = 180;
const MASK_HEIGHT = 80;
const PADDING = 10;

function usage() {
  return [
    "Usage: node scripts/remove-gemini-notebook-watermark-from-infographic.mjs [input_pngs] [output_pngs]",
    "",
    "Reconstructs the lower-right 180x80 watermark area of every .png in the input directory.",
    "Defaults: input_pngs and output_pngs.",
  ].join("\n");
}

function watermarkBounds(width, height) {
  const left = Math.max(0, width - MASK_WIDTH - PADDING);
  const top = Math.max(0, height - MASK_HEIGHT - PADDING);
  const right = Math.max(left, width - PADDING);
  const bottom = Math.max(top, height - PADDING);
  return { left, top, width: right - left, height: bottom - top };
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), data.length + 8);
  return chunk;
}

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
    ? left : aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function decodePng(png) {
  if (!png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("Input is not a PNG image.");
  }
  let offset = PNG_SIGNATURE.length;
  let header;
  const compressedData = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") header = data;
    if (type === "IDAT") compressedData.push(data);
    offset += length + 12;
  }
  if (!header || header[8] !== 8 || header[12] !== 0 || ![2, 6].includes(header[9])) {
    throw new Error("Only non-interlaced 8-bit RGB and RGBA PNG images are supported.");
  }
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const sourceChannels = header[9] === 6 ? 4 : 3;
  const rowLength = width * sourceChannels;
  const filtered = inflateSync(Buffer.concat(compressedData));
  if (filtered.length !== height * (rowLength + 1)) throw new Error("Malformed PNG pixel data.");

  const source = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[y * (rowLength + 1)];
    const inputOffset = y * (rowLength + 1) + 1;
    const outputOffset = y * rowLength;
    for (let x = 0; x < rowLength; x += 1) {
      const value = filtered[inputOffset + x];
      const left = x >= sourceChannels ? source[outputOffset + x - sourceChannels] : 0;
      const above = y > 0 ? source[outputOffset + x - rowLength] : 0;
      const upperLeft = y > 0 && x >= sourceChannels ? source[outputOffset + x - rowLength - sourceChannels] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? above
        : filter === 3 ? Math.floor((left + above) / 2) : filter === 4 ? paeth(left, above, upperLeft) : NaN;
      if (Number.isNaN(predictor)) throw new Error(`Unsupported PNG filter type: ${filter}.`);
      source[outputOffset + x] = (value + predictor) & 0xff;
    }
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    source.copy(rgba, pixel * 4, pixel * sourceChannels, pixel * sourceChannels + sourceChannels);
    if (sourceChannels === 3) rgba[pixel * 4 + 3] = 255;
  }
  return { data: rgba, width, height };
}

function encodePng({ data, width, height }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const scanlineOffset = y * (width * 4 + 1);
    scanlines[scanlineOffset] = 0;
    data.copy(scanlines, scanlineOffset + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Reconstruct a rectangular overlay from the adjacent image field.
 *
 * Each target pixel is bilinearly interpolated between the unmasked pixels at
 * the same horizontal and vertical positions. This preserves surrounding
 * gradients while eliminating the watermark glyphs, without retaining the
 * OpenCV/Python runtime used by the previous script.
 */
function inpaintRectangle(data, imageWidth, bounds, channels) {
  const { left, top, width, height } = bounds;
  if (width === 0 || height === 0) return;

  const right = left + width;
  const bottom = top + height;
  const index = (x, y, channel) => (y * imageWidth + x) * channels + channel;

  for (let y = top; y < bottom; y += 1) {
    const verticalRatio = (y - top + 1) / (height + 1);
    for (let x = left; x < right; x += 1) {
      const horizontalRatio = (x - left + 1) / (width + 1);
      for (let channel = 0; channel < channels; channel += 1) {
        const horizontal = data[index(left - 1, y, channel)] * (1 - horizontalRatio)
          + data[index(right, y, channel)] * horizontalRatio;
        const vertical = data[index(x, top - 1, channel)] * (1 - verticalRatio)
          + data[index(x, bottom, channel)] * verticalRatio;
        data[index(x, y, channel)] = Math.round((horizontal + vertical) / 2);
      }
    }
  }
}

export async function removeWatermark(inputPath, outputPath) {
  const image = decodePng(await readFile(inputPath));
  const bounds = watermarkBounds(image.width, image.height);

  // Tiny images do not have an unmasked pixel on every side to interpolate.
  if (bounds.left > 0 && bounds.top > 0
    && bounds.left + bounds.width < image.width
    && bounds.top + bounds.height < image.height) {
    inpaintRectangle(image.data, image.width, bounds, 4);
  }
  await writeFile(outputPath, encodePng(image));
}

async function main(arguments_) {
  if (arguments_.includes("--help") || arguments_.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (arguments_.length > 2) throw new Error(usage());

  const [inputDirectory = "input_pngs", outputDirectory = "output_pngs"] = arguments_;
  await mkdir(outputDirectory, { recursive: true });
  const entries = await readdir(inputDirectory, { withFileTypes: true });
  const inputFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".png"))
    .map((entry) => join(inputDirectory, entry.name));

  await Promise.all(inputFiles.map((inputPath) => removeWatermark(
    inputPath,
    join(outputDirectory, basename(inputPath)),
  )));
  process.stdout.write(`Processed ${inputFiles.length} PNG image${inputFiles.length === 1 ? "" : "s"}.\n`);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
