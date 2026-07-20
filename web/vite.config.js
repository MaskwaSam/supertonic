import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootAssetsDir = path.resolve(__dirname, '../assets');
const supertonicOnnxRuntimeDistDir = path.resolve(__dirname, 'node_modules/onnxruntime-web/dist');

function appBuildId() {
  const inputs = [
    'helper.js',
    'index.html',
    'main.js',
    'runtime-policy.js',
    'speech-normalizer.js',
    'style.css',
    'voices.css',
    'voices.html',
    'voices.js',
    'public/sw.js',
    'package-lock.json'
  ];
  const hash = createHash('sha256');
  for (const input of inputs) {
    hash.update(input);
    hash.update('\0');
    hash.update(readFileSync(path.join(__dirname, input)));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}

function serveFiles(route, sourceDir) {
  return {
    name: `serve-${route.replace(/\W+/g, '-')}`,
    configureServer(server) {
      server.middlewares.use(route, (req, res, next) => {
        const urlPath = decodeURIComponent((req.url || '').split('?')[0]);
        const filePath = path.resolve(sourceDir, `.${urlPath}`);

        if (!filePath.startsWith(sourceDir) || !existsSync(filePath)) {
          next();
          return;
        }

        const stat = statSync(filePath);
        if (!stat.isFile()) {
          next();
          return;
        }

        const extension = path.extname(filePath);
        const contentTypes = {
          '.json': 'application/json',
          '.mjs': 'text/javascript',
          '.onnx': 'application/octet-stream',
          '.wasm': 'application/wasm'
        };
        if (contentTypes[extension]) {
          res.setHeader('Content-Type', contentTypes[extension]);
        }

        createReadStream(filePath).pipe(res);
      });
    }
  };
}

function serviceWorkerManifest() {
  return {
    name: 'supertonic-service-worker-manifest',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = new Set(['./', './index.html', './voices.html']);

      for (const output of Object.values(bundle)) {
        if (!output.fileName || output.fileName === 'sw.js') {
          continue;
        }
        if (!/\.(?:js|css|html|svg|png|jpe?g|webp|ico|woff2?)$/i.test(output.fileName)) {
          continue;
        }

        files.add(`./${output.fileName}`);
      }

      this.emitFile({
        type: 'asset',
        fileName: 'app-shell-manifest.json',
        source: `${JSON.stringify({ files: [...files].sort() }, null, 2)}\n`
      });
    }
  };
}

export default defineConfig({
  base: './',
  define: {
    __SUPERTONIC_BUILD_ID__: JSON.stringify(appBuildId())
  },
  plugins: [
    serveFiles('/assets', rootAssetsDir),
    serveFiles('/onnx-runtime', supertonicOnnxRuntimeDistDir),
    serviceWorkerManifest()
  ],
  server: {
    port: 3000,
    open: false
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'index.html'),
        voices: path.resolve(__dirname, 'voices.html')
      }
    }
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web']
  }
});
