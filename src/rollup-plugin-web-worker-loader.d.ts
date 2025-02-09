// rollup-plugin-web-worker-loader.d.ts

declare module "rollup-plugin-web-worker-loader" {
	import { Plugin } from "rollup";

	// 옵션 타입을 상세하게 작성하고 싶다면 아래처럼 확장할 수 있습니다.
	export interface WorkerLoaderOptions {
		// 예시: target 옵션 (문서에 따라 다를 수 있습니다)
		target?: "browser" | "node";
		// 기타 옵션이 있다면 추가하세요.
		[key: string]: any;
	}

	// 기본적으로 default export로 함수가 제공되는 경우
	export default function workerLoader(options?: WorkerLoaderOptions): Plugin;
}
