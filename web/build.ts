import { SveltePlugin } from "bun-plugin-svelte";
import tailwind from "bun-plugin-tailwind";

const result = await Bun.build({
  entrypoints: ["web/index.html"],
  outdir: "web/dist",
  target: "browser",
  minify: true,
  plugins: [SveltePlugin({ development: false }), tailwind],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log("SPA built ->", "web/dist");
