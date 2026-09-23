const fs = require("fs");
const http = require("http");
const path = require("path");

const root = path.join(__dirname, "..", "..", "frontend");
const port = Number(process.env.FRONTEND_PORT || 4174);
const host = process.env.FRONTEND_HOST || "127.0.0.1";
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

http
  .createServer((req, res) => {
    const requestUrl = new URL(req.url, "http://localhost");
    const pathname = decodeURIComponent(requestUrl.pathname);
    if (pathname === "/index.html" || (pathname.endsWith(".html") && pathname !== "/")) {
      const destination = pathname === "/index.html" ? "/" : pathname.slice(0, -5);
      res.writeHead(308, { Location: `${destination}${requestUrl.search}` });
      return res.end();
    }

    const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const directFile = path.resolve(root, requested);
    const extensionlessFile = path.resolve(root, `${requested}.html`);
    const file = (path.extname(requested) || fs.existsSync(directFile)) ? directFile : extensionlessFile;

    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }

    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    return fs.createReadStream(file).pipe(res);
  })
  .listen(port, host, () => {
    console.log(`CaReMind frontend available at http://${host}:${port}`);
  });
