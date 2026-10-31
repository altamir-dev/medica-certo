/**
 * Remove APP1 (EXIF, inclusive GPS) e comentários COM de um JPEG.
 * O restante do arquivo, inclusive a imagem, permanece.
 * @param {Buffer} buffer
 */
export function stripJpegMetadata(buffer) {
  if (!buffer || buffer.length < 4) return buffer;
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return buffer;

  /** @type {Buffer[]} */
  const parts = [buffer.subarray(0, 2)];
  let i = 2;
  while (i + 1 < buffer.length) {
    if (buffer[i] !== 0xff) {
      parts.push(buffer.subarray(i));
      break;
    }
    const marker = buffer[i + 1];
    if (marker === 0xd8) {
      i += 2;
      continue;
    }
    if (marker === 0xd9) {
      parts.push(buffer.subarray(i, i + 2));
      break;
    }
    if (marker === 0xda) {
      parts.push(buffer.subarray(i));
      break;
    }
    if (i + 3 >= buffer.length) {
      parts.push(buffer.subarray(i));
      break;
    }
    const segmentLength = buffer.readUInt16BE(i + 2);
    if (segmentLength < 2 || i + 2 + segmentLength > buffer.length) {
      parts.push(buffer.subarray(i));
      break;
    }
    const drop = marker === 0xe1 || marker === 0xfe;
    if (!drop) parts.push(buffer.subarray(i, i + 2 + segmentLength));
    i += 2 + segmentLength;
  }
  return Buffer.concat(parts);
}

/**
 * @param {Buffer} buffer
 */
export function containsExifGps(buffer) {
  const asText = buffer.toString('latin1');
  return asText.includes('GPS') || asText.includes('Exif');
}
