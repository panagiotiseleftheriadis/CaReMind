const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const frontendDirectory = path.join(__dirname, "..", "..", "frontend");

function jpegDimensions(buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3].includes(marker)) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  throw new Error("JPEG dimensions could not be read");
}

test("homepage exposes a valid 1200x630 social sharing preview", () => {
  const html = fs.readFileSync(path.join(frontendDirectory, "index.html"), "utf8");
  const imagePath = path.join(frontendDirectory, "assets", "caremind-social-preview.jpg");
  const image = fs.readFileSync(imagePath);

  assert.match(html, /property="og:title" content="CaReMind · Mind your Car\."/);
  assert.match(html, /property="og:image:width" content="1200"/);
  assert.match(html, /property="og:image:height" content="630"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /https:\/\/www\.car-remind\.gr\/assets\/caremind-social-preview\.jpg\?v=1/);
  assert.deepEqual(jpegDimensions(image), { width: 1200, height: 630 });
  assert.ok(image.length > 50_000, "social preview should not be an empty placeholder");
});
