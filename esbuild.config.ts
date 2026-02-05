import * as esbuild from "esbuild";
import { mkdirSync, copyFileSync, readdirSync } from "fs";

mkdirSync("dist/public/assets", { recursive: true });
copyFileSync("src/client/index.html", "dist/public/index.html");

// Copy static assets
for (const file of readdirSync("src/client/assets")) {
  copyFileSync(`src/client/assets/${file}`, `dist/public/assets/${file}`);
}

const isWatch = !process.argv.includes("--once");

const ctx = await esbuild.context({
  entryPoints: ["src/client/main.tsx"],
  bundle: true,
  outfile: "dist/public/app.js",
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  jsxImportSource: "react",
  sourcemap: true,
  define: {
    "process.env.NODE_ENV": isWatch ? '"development"' : '"production"',
  },
  loader: {
    ".tsx": "tsx",
    ".ts": "ts",
  },
  logLevel: "info",
});

if (isWatch) {
  await ctx.watch();
  console.log("[esbuild] watching for changes...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log("[esbuild] build complete.");
}
