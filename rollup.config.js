import typescript from "rollup-plugin-typescript2";
import workerLoader from "rollup-plugin-web-worker-loader";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import resolve from "@rollup/plugin-node-resolve";
import { swc } from "rollup-plugin-swc3";

const bundle = {
	input: "src/index.ts",
	output: {
		dir: "dist",
		format: "esm",
		preserveModules: true, // 모듈 구조 유지
		preserveModulesRoot: "src",
		entryFileNames: "[name].js", // 파일명 유지
	},
	plugins: [
		resolve(), // Node 모듈 해석
		commonjs(), // CommonJS 모듈 변환 (필요 시)
		workerLoader(),
		swc({
			jsc: {
				parser: {
					syntax: "typescript",
					tsx: false,
					decorators: true,
					dynamicImport: true,
				},
				target: "esnext",
			},
			isModule: true,
			module: {
				type: "es6",
			},
			sourceMaps: true,
			minify: true,
			inlineSourcesContent: true,
		}),
	],
};

export default bundle;
